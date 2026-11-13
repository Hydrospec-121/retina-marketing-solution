-- Move active stock operations to one quantity and weighted-average cost per medicine.
-- Legacy batch, movement, allocation, invoice, and payment rows are deliberately retained.
-- The pending 20261111120000_invoice_customer_name_snapshot migration must run first.

DO $migration_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'customer_name'
  ) THEN
    RAISE EXCEPTION 'Apply 20261111120000_invoice_customer_name_snapshot before medicine-wise inventory.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.medicine_batches
    WHERE (expiry_date IS NULL OR expiry_date < CURRENT_DATE)
      AND current_quantity > 0
  ) THEN
    RAISE EXCEPTION 'Medicine-wise inventory cutover paused: positive expired or undated batch stock requires an explicit owner disposition before migration.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.medicine_batches
    WHERE expiry_date >= CURRENT_DATE AND current_quantity > 0
    GROUP BY medicine_id
    HAVING SUM(current_quantity::BIGINT) > 2147483647
  ) THEN
    RAISE EXCEPTION 'Medicine-wise inventory cutover paused: a medicine total exceeds the supported integer stock range.';
  END IF;
END;
$migration_guard$;

ALTER TABLE public.medicines
  ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 0
    CHECK (stock_quantity >= 0),
  ADD COLUMN purchase_cost_avg NUMERIC(16,4) NOT NULL DEFAULT 0
    CHECK (
      purchase_cost_avg >= 0
      AND purchase_cost_avg::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
    );

-- Seed only stock eligible for use. The guard above prevents silently dropping
-- positive expired stock; zero-balance expired batches remain historical only.
WITH eligible_stock AS (
  SELECT medicine_id,
         SUM(current_quantity)::INTEGER AS quantity,
         ROUND(SUM(current_quantity::NUMERIC * purchase_price) / NULLIF(SUM(current_quantity), 0), 4) AS average_cost
  FROM public.medicine_batches
  WHERE expiry_date >= CURRENT_DATE
    AND current_quantity > 0
  GROUP BY medicine_id
)
UPDATE public.medicines AS medicine
SET stock_quantity = eligible_stock.quantity,
    purchase_cost_avg = eligible_stock.average_cost
FROM eligible_stock
WHERE medicine.id = eligible_stock.medicine_id;

ALTER TABLE public.invoice_items
  ADD COLUMN unit_cost_snapshot NUMERIC(16,4)
    CHECK (
      unit_cost_snapshot IS NULL OR
      (unit_cost_snapshot >= 0 AND unit_cost_snapshot::TEXT NOT IN ('NaN', 'Infinity', '-Infinity'))
    );

-- Preserve recoverable historical cost. Leave incomplete allocations NULL rather
-- than inventing a cost for a previously posted invoice.
WITH allocation_cost AS (
  SELECT allocation.invoice_item_id,
         SUM(allocation.quantity)::INTEGER AS allocated_quantity,
         SUM(allocation.quantity::NUMERIC * allocation.unit_cost) AS extended_cost
  FROM public.invoice_batch_allocations AS allocation
  GROUP BY allocation.invoice_item_id
)
UPDATE public.invoice_items AS item
SET unit_cost_snapshot = ROUND(allocation_cost.extended_cost / item.quantity, 4)
FROM allocation_cost
WHERE allocation_cost.invoice_item_id = item.id
  AND allocation_cost.allocated_quantity = item.quantity
  AND item.unit_cost_snapshot IS NULL;

-- Invoice-item cost snapshots are initialized during this migration or invoice
-- creation only. Existing invoice-item reads remain available to authorized staff.
CREATE FUNCTION public.prevent_invoice_item_cost_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.unit_cost_snapshot IS DISTINCT FROM OLD.unit_cost_snapshot THEN
    RAISE EXCEPTION 'Invoice item cost snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_invoice_item_cost_snapshot_update()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER invoice_items_unit_cost_snapshot_immutable
  BEFORE UPDATE OF unit_cost_snapshot ON public.invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_invoice_item_cost_snapshot_update();

-- Invoice items are created through the role-checked SECURITY DEFINER invoice
-- RPC. Browser roles retain SELECT only; updates to other item fields are not
-- an existing authenticated workflow and remain unavailable directly.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.invoice_items
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, invoice_id, medicine_id, quantity, unit_price, line_discount, line_total, created_at, unit_cost_snapshot),
       UPDATE (id, invoice_id, medicine_id, quantity, unit_price, line_discount, line_total, created_at, unit_cost_snapshot)
  ON TABLE public.invoice_items FROM PUBLIC, anon, authenticated;

CREATE TABLE public.medicine_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('PURCHASE', 'SALE', 'OPENING_STOCK', 'ADJUSTMENT')),
  quantity_delta INTEGER NOT NULL CHECK (
    quantity_delta <> 0 OR
    (movement_type = 'OPENING_STOCK' AND previous_quantity = 0 AND resulting_quantity = 0)
  ),
  previous_quantity INTEGER NOT NULL CHECK (previous_quantity >= 0),
  resulting_quantity INTEGER NOT NULL CHECK (resulting_quantity >= 0),
  purchase_cost NUMERIC(16,4),
  reason TEXT,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  related_invoice_id UUID REFERENCES public.invoices(id) ON DELETE RESTRICT,
  invoice_item_id UUID REFERENCES public.invoice_items(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT medicine_stock_movements_balance_check
    CHECK (previous_quantity + quantity_delta = resulting_quantity),
  CONSTRAINT medicine_stock_movements_cost_check
    CHECK (purchase_cost IS NULL OR (purchase_cost >= 0 AND purchase_cost::TEXT NOT IN ('NaN', 'Infinity', '-Infinity'))),
  CONSTRAINT medicine_stock_movements_invoice_check
    CHECK ((related_invoice_id IS NULL) = (invoice_item_id IS NULL))
);

CREATE INDEX medicine_stock_movements_medicine_created_idx
  ON public.medicine_stock_movements (medicine_id, created_at DESC, id DESC);
CREATE INDEX medicine_stock_movements_invoice_idx
  ON public.medicine_stock_movements (related_invoice_id)
  WHERE related_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX medicine_stock_movements_one_opening_per_medicine_idx
  ON public.medicine_stock_movements (medicine_id)
  WHERE movement_type = 'OPENING_STOCK';

ALTER TABLE public.medicine_stock_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.medicine_stock_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.medicine_stock_movements TO authenticated;
CREATE POLICY "Authorized staff can view medicine stock movements"
  ON public.medicine_stock_movements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.role IN ('owner', 'manager', 'inventory_manager', 'accountant', 'sales')
    )
  );

-- Stock and cost may only be changed by the inventory RPCs, never by browser table writes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.medicines FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, name, generic_name, manufacturer_id, strength, dosage_form, pack_size, category, barcode, registration_number, selling_price, requires_prescription, is_active, created_at, updated_at, min_stock_level, stock_quantity, purchase_cost_avg)
  ON TABLE public.medicines FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (id, name, generic_name, manufacturer_id, strength, dosage_form, pack_size, category, barcode, registration_number, selling_price, requires_prescription, is_active, created_at, updated_at, min_stock_level, stock_quantity, purchase_cost_avg)
  ON TABLE public.medicines FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  name, generic_name, manufacturer_id, strength, dosage_form, pack_size, category,
  barcode, registration_number, selling_price, requires_prescription, is_active, min_stock_level
) ON TABLE public.medicines TO authenticated;
GRANT UPDATE (
  name, generic_name, manufacturer_id, strength, dosage_form, pack_size, category,
  barcode, registration_number, selling_price, requires_prescription, is_active, min_stock_level
) ON TABLE public.medicines TO authenticated;

CREATE OR REPLACE FUNCTION public.receive_medicine_stock(
  p_medicine_id UUID,
  p_quantity INTEGER,
  p_purchase_price NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_old_quantity INTEGER;
  v_new_quantity INTEGER;
  v_old_cost NUMERIC(16,4);
  v_new_cost NUMERIC(16,4);
  v_movement_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT profile.role INTO v_role FROM public.profiles AS profile WHERE profile.id = v_user_id;
  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'inventory_manager') THEN
    RAISE EXCEPTION 'You are not authorized to receive stock';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero'; END IF;
  IF p_purchase_price IS NULL OR p_purchase_price::TEXT IN ('NaN', 'Infinity', '-Infinity') OR p_purchase_price < 0 THEN
    RAISE EXCEPTION 'Purchase price must be a finite nonnegative amount';
  END IF;

  SELECT medicine.stock_quantity, medicine.purchase_cost_avg
    INTO v_old_quantity, v_old_cost
  FROM public.medicines AS medicine
  WHERE medicine.id = p_medicine_id AND medicine.is_active = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selected medicine is unavailable'; END IF;
  IF v_old_quantity > 2147483647 - p_quantity THEN RAISE EXCEPTION 'Stock quantity exceeds the supported range'; END IF;

  v_new_quantity := v_old_quantity + p_quantity;
  v_new_cost := ROUND(
    (v_old_quantity::NUMERIC * v_old_cost + p_quantity::NUMERIC * p_purchase_price) / v_new_quantity,
    4
  );
  UPDATE public.medicines
  SET stock_quantity = v_new_quantity, purchase_cost_avg = v_new_cost, updated_at = now()
  WHERE id = p_medicine_id;
  INSERT INTO public.medicine_stock_movements (
    medicine_id, movement_type, quantity_delta, previous_quantity, resulting_quantity,
    purchase_cost, reason, actor_id
  ) VALUES (
    p_medicine_id, 'PURCHASE', p_quantity, v_old_quantity, v_new_quantity,
    ROUND(p_purchase_price, 4), NULLIF(pg_catalog.btrim(p_notes), ''), v_user_id
  ) RETURNING id INTO v_movement_id;
  RETURN v_movement_id;
END;
$function$;

DROP FUNCTION IF EXISTS public.add_medicine_opening_stock(UUID, INTEGER, NUMERIC, TEXT);
CREATE FUNCTION public.add_medicine_opening_stock(
  p_medicine_id UUID,
  p_quantity INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_old_quantity INTEGER;
  v_movement_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT profile.role INTO v_role FROM public.profiles AS profile WHERE profile.id = v_user_id;
  IF COALESCE(v_role, '') <> 'owner' THEN RAISE EXCEPTION 'Only the owner can enter opening stock'; END IF;
  IF p_quantity IS NULL OR p_quantity < 0 THEN RAISE EXCEPTION 'Opening quantity must be a nonnegative whole number'; END IF;
  SELECT stock_quantity INTO v_old_quantity FROM public.medicines
  WHERE id = p_medicine_id AND is_active = TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selected medicine is unavailable'; END IF;
  IF v_old_quantity <> 0 THEN RAISE EXCEPTION 'Opening stock can only be set when current stock is zero'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.medicine_stock_movements AS movement
    WHERE movement.medicine_id = p_medicine_id AND movement.movement_type = 'OPENING_STOCK'
  ) THEN RAISE EXCEPTION 'Opening stock has already been initialized for this medicine'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.medicine_stock_movements AS movement
    WHERE movement.medicine_id = p_medicine_id
  ) THEN RAISE EXCEPTION 'Opening stock can only be initialized before any other stock movement'; END IF;
  UPDATE public.medicines SET stock_quantity = p_quantity, updated_at = now()
  WHERE id = p_medicine_id;
  INSERT INTO public.medicine_stock_movements (
    medicine_id, movement_type, quantity_delta, previous_quantity, resulting_quantity,
    purchase_cost, reason, actor_id
  ) VALUES (
    p_medicine_id, 'OPENING_STOCK', p_quantity, 0, p_quantity,
    NULL, 'Initial opening stock', v_user_id
  ) RETURNING id INTO v_movement_id;
  RETURN v_movement_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_medicine_stock(
  p_medicine_id UUID,
  p_new_quantity INTEGER,
  p_reason TEXT,
  p_password TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_old_quantity INTEGER;
  v_cost NUMERIC(16,4);
  v_delta INTEGER;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT profile.role INTO v_role FROM public.profiles AS profile WHERE profile.id = v_user_id;
  IF COALESCE(v_role, '') <> 'owner' THEN RAISE EXCEPTION 'Only the owner can adjust stock'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.stock_adjustment_settings AS settings
    WHERE settings.id = 1
      AND settings.password_hash = extensions.crypt(COALESCE(p_password, ''), settings.password_hash)
  ) THEN RAISE EXCEPTION 'Incorrect stock adjustment password'; END IF;
  IF p_new_quantity IS NULL OR p_new_quantity < 0 THEN RAISE EXCEPTION 'Stock quantity cannot be negative'; END IF;
  IF p_reason IS NULL OR pg_catalog.btrim(p_reason) = '' THEN RAISE EXCEPTION 'Adjustment reason is required'; END IF;
  SELECT medicine.stock_quantity, medicine.purchase_cost_avg INTO v_old_quantity, v_cost
  FROM public.medicines AS medicine WHERE medicine.id = p_medicine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medicine not found'; END IF;
  v_delta := p_new_quantity - v_old_quantity;
  IF v_delta = 0 THEN RAISE EXCEPTION 'The corrected quantity is unchanged'; END IF;
  UPDATE public.medicines SET stock_quantity = p_new_quantity, updated_at = now() WHERE id = p_medicine_id;
  INSERT INTO public.medicine_stock_movements (
    medicine_id, movement_type, quantity_delta, previous_quantity, resulting_quantity,
    purchase_cost, reason, actor_id
  ) VALUES (
    p_medicine_id, 'ADJUSTMENT', v_delta, v_old_quantity, p_new_quantity,
    CASE WHEN v_delta > 0 THEN v_cost ELSE NULL END, pg_catalog.btrim(p_reason), v_user_id
  );
  RETURN p_new_quantity;
END;
$function$;

-- The old invoice function is replaced because its allocation loop is the batch
-- deduction path. This signature also supports the pending walk-in snapshot migration.
DROP FUNCTION public.create_sales_invoice(UUID, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT);
CREATE FUNCTION public.create_sales_invoice(
  p_customer_id UUID,
  p_items JSONB,
  p_discount NUMERIC DEFAULT 0,
  p_initial_payment NUMERIC DEFAULT 0,
  p_payment_method TEXT DEFAULT 'cash',
  p_payment_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_customer_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_item JSONB;
  v_medicine_id UUID;
  v_quantity_numeric NUMERIC;
  v_quantity INTEGER;
  v_selling_price NUMERIC(14,2);
  v_cost NUMERIC(16,4);
  v_subtotal NUMERIC(14,2) := 0;
  v_total NUMERIC(14,2);
  v_invoice_id UUID;
  v_invoice_number TEXT;
  v_item_id UUID;
  v_payment_method TEXT;
  v_old_quantity INTEGER;
  v_new_quantity INTEGER;
  v_lines JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT profile.role INTO v_role FROM public.profiles AS profile WHERE profile.id = v_user_id;
  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'sales') THEN RAISE EXCEPTION 'You are not authorized to create invoices'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one medicine to the invoice';
  END IF;
  IF p_discount IS NULL OR p_initial_payment IS NULL
     OR p_discount::TEXT IN ('NaN', 'Infinity', '-Infinity')
     OR p_initial_payment::TEXT IN ('NaN', 'Infinity', '-Infinity')
     OR p_discount < 0 OR p_initial_payment < 0 THEN
    RAISE EXCEPTION 'Discount and payment must be finite nonnegative amounts';
  END IF;
  IF p_customer_id IS NULL THEN
    IF p_customer_name IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_customer_name)) NOT BETWEEN 1 AND 150 THEN
      RAISE EXCEPTION 'Customer name is required';
    END IF;
  ELSE
    PERFORM 1 FROM public.customers AS customer
    WHERE customer.id = p_customer_id AND customer.is_active = TRUE FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Select an active customer'; END IF;
  END IF;
  v_payment_method := COALESCE(p_payment_method, 'cash');
  IF v_payment_method NOT IN ('cash', 'bank_transfer', 'mobile_banking', 'cheque', 'other') THEN
    RAISE EXCEPTION 'Invalid payment method';
  END IF;

  -- Validate client rows before casting, then aggregate duplicate medicines.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item->'medicine_id') IS DISTINCT FROM 'string'
       OR (jsonb_typeof(v_item->'quantity') IS DISTINCT FROM 'number'
           AND jsonb_typeof(v_item->'quantity') IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'Every invoice line must include a medicine UUID and quantity';
    END IF;
    BEGIN
      v_medicine_id := (v_item->>'medicine_id')::UUID;
      v_quantity_numeric := (v_item->>'quantity')::NUMERIC;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Medicine ID or quantity is invalid';
    END;
    IF v_quantity_numeric::TEXT IN ('NaN', 'Infinity', '-Infinity')
       OR v_quantity_numeric <= 0 OR v_quantity_numeric <> pg_catalog.trunc(v_quantity_numeric)
       OR v_quantity_numeric > 2147483647 THEN
      RAISE EXCEPTION 'Medicine quantity must be a positive whole number';
    END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('medicine_id', grouped.medicine_id, 'quantity', grouped.quantity) ORDER BY grouped.medicine_id)
  INTO v_lines
  FROM (
    SELECT (value->>'medicine_id')::UUID AS medicine_id,
           SUM((value->>'quantity')::NUMERIC) AS quantity
    FROM jsonb_array_elements(p_items)
    GROUP BY (value->>'medicine_id')::UUID
  ) AS grouped;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_lines) AS line(value)
    WHERE (value->>'quantity')::NUMERIC > 2147483647
  ) THEN RAISE EXCEPTION 'Combined medicine quantity exceeds the supported range'; END IF;

  -- Lock medicine rows in stable ID order, then validate total stock and prices.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_lines) ORDER BY value->>'medicine_id'
  LOOP
    v_medicine_id := (v_item->>'medicine_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    SELECT medicine.stock_quantity, medicine.selling_price, medicine.purchase_cost_avg
    INTO v_old_quantity, v_selling_price, v_cost
    FROM public.medicines AS medicine
    WHERE medicine.id = v_medicine_id AND medicine.is_active = TRUE
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A selected medicine is unavailable'; END IF;
    IF v_old_quantity < v_quantity THEN RAISE EXCEPTION 'Insufficient stock for medicine %', v_medicine_id; END IF;
    v_subtotal := v_subtotal + (v_selling_price * v_quantity);
  END LOOP;
  IF p_discount > v_subtotal THEN RAISE EXCEPTION 'Discount cannot exceed the invoice subtotal'; END IF;
  v_total := v_subtotal - p_discount;
  IF p_initial_payment > v_total THEN RAISE EXCEPTION 'Initial payment cannot exceed the invoice total'; END IF;

  v_invoice_number := 'RMS-' || pg_catalog.lpad(nextval('public.invoice_number_seq')::TEXT, 6, '0');
  INSERT INTO public.invoices (
    invoice_number, customer_id, customer_name, subtotal, discount, total, status, notes, created_by
  ) VALUES (
    v_invoice_number, p_customer_id, NULLIF(pg_catalog.btrim(p_customer_name), ''),
    v_subtotal, p_discount, v_total, 'posted', NULLIF(pg_catalog.btrim(p_notes), ''), v_user_id
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_lines) ORDER BY value->>'medicine_id'
  LOOP
    v_medicine_id := (v_item->>'medicine_id')::UUID;
    v_quantity := (v_item->>'quantity')::INTEGER;
    SELECT medicine.stock_quantity, medicine.selling_price, medicine.purchase_cost_avg
    INTO v_old_quantity, v_selling_price, v_cost
    FROM public.medicines AS medicine WHERE medicine.id = v_medicine_id;
    v_new_quantity := v_old_quantity - v_quantity;
    INSERT INTO public.invoice_items (
      invoice_id, medicine_id, quantity, unit_price, line_discount, line_total, unit_cost_snapshot
    ) VALUES (
      v_invoice_id, v_medicine_id, v_quantity, v_selling_price, 0,
      v_selling_price * v_quantity, v_cost
    ) RETURNING id INTO v_item_id;
    UPDATE public.medicines SET stock_quantity = v_new_quantity, updated_at = now() WHERE id = v_medicine_id;
    INSERT INTO public.medicine_stock_movements (
      medicine_id, movement_type, quantity_delta, previous_quantity, resulting_quantity,
      purchase_cost, reason, actor_id, related_invoice_id, invoice_item_id
    ) VALUES (
      v_medicine_id, 'SALE', -v_quantity, v_old_quantity, v_new_quantity,
      v_cost, 'Invoice ' || v_invoice_number, v_user_id, v_invoice_id, v_item_id
    );
  END LOOP;
  IF p_initial_payment > 0 THEN
    INSERT INTO public.payments (invoice_id, amount, payment_method, reference, received_by)
    VALUES (v_invoice_id, p_initial_payment, v_payment_method, NULLIF(pg_catalog.btrim(p_payment_reference), ''), v_user_id);
  END IF;
  RETURN v_invoice_id;
END;
$function$;

-- Old batch RPCs remain in the database for historical compatibility but can no longer mutate stock.
REVOKE ALL ON FUNCTION public.receive_medicine_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, UUID, TEXT) FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.receive_medicine_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, UUID, TEXT);
REVOKE ALL ON FUNCTION public.add_opening_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_batch_stock_count(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.receive_medicine_stock(UUID, INTEGER, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_medicine_opening_stock(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_medicine_stock(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_sales_invoice(UUID, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_medicine_stock(UUID, INTEGER, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_medicine_opening_stock(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_medicine_stock(UUID, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_invoice(UUID, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;
