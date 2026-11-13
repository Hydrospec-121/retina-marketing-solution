BEGIN;

ALTER TABLE public.medicine_batches
  DROP CONSTRAINT IF EXISTS medicine_batches_purchase_price_check;

ALTER TABLE public.medicine_batches
  ADD CONSTRAINT medicine_batches_purchase_price_check
  CHECK (
    purchase_price >= 0
    AND purchase_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
  );

CREATE OR REPLACE FUNCTION public.receive_medicine_stock(
    p_medicine_id UUID,
    p_batch_number TEXT,
    p_expiry_date DATE,
    p_purchase_price NUMERIC,
    p_quantity INTEGER,
    p_manufacture_date DATE DEFAULT NULL,
    p_supplier_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role TEXT;
    v_batch_id UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    SELECT p.role
    INTO v_role
    FROM public.profiles AS p
    WHERE p.id = auth.uid();

    IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'inventory_manager') THEN
        RAISE EXCEPTION 'You are not authorized to receive stock';
    END IF;

    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero';
    END IF;

    IF p_purchase_price IS NULL THEN
        RAISE EXCEPTION 'Purchase price cannot be NULL';
    END IF;

    IF p_purchase_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Purchase price must be finite';
    END IF;

    IF p_purchase_price < 0 THEN
        RAISE EXCEPTION 'Purchase price cannot be negative';
    END IF;

    IF p_batch_number IS NULL OR pg_catalog.btrim(p_batch_number) = '' THEN
        RAISE EXCEPTION 'Batch number is required';
    END IF;

    IF p_expiry_date IS NULL THEN
        RAISE EXCEPTION 'Expiry date is required';
    END IF;

    INSERT INTO public.medicine_batches (
        medicine_id,
        supplier_id,
        batch_number,
        manufacture_date,
        expiry_date,
        purchase_price,
        quantity_received,
        current_quantity
    )
    VALUES (
        p_medicine_id,
        p_supplier_id,
        pg_catalog.btrim(p_batch_number),
        p_manufacture_date,
        p_expiry_date,
        p_purchase_price,
        p_quantity,
        p_quantity
    )
    RETURNING id INTO v_batch_id;

    INSERT INTO public.stock_movements (
        batch_id,
        movement_type,
        quantity,
        notes,
        created_by
    )
    VALUES (
        v_batch_id,
        'purchase',
        p_quantity,
        p_notes,
        auth.uid()
    );

    RETURN v_batch_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.add_opening_stock(
    p_medicine_id UUID,
    p_batch_number TEXT,
    p_expiry_date DATE,
    p_purchase_price NUMERIC,
    p_quantity INTEGER,
    p_manufacture_date DATE DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role TEXT;
  v_batch_id UUID;
BEGIN
  SELECT role
  INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF COALESCE(v_role, '') <> 'owner' THEN
    RAISE EXCEPTION 'Only the owner can enter opening stock';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_purchase_price IS NULL THEN
    RAISE EXCEPTION 'Purchase price cannot be NULL';
  END IF;

  IF p_purchase_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Purchase price must be finite';
  END IF;

  IF p_purchase_price < 0 THEN
    RAISE EXCEPTION 'Purchase price cannot be negative';
  END IF;

  IF p_batch_number IS NULL OR trim(p_batch_number) = '' THEN
    RAISE EXCEPTION 'Batch number is required';
  END IF;

  IF p_expiry_date IS NULL THEN
    RAISE EXCEPTION 'Expiry date is required';
  END IF;

  INSERT INTO public.medicine_batches (
    medicine_id,
    batch_number,
    manufacture_date,
    expiry_date,
    purchase_price,
    quantity_received,
    current_quantity
  )
  VALUES (
    p_medicine_id,
    trim(p_batch_number),
    p_manufacture_date,
    p_expiry_date,
    p_purchase_price,
    p_quantity,
    p_quantity
  )
  RETURNING id INTO v_batch_id;

  INSERT INTO public.stock_movements (
    batch_id,
    movement_type,
    quantity,
    notes,
    created_by
  )
  VALUES (
    v_batch_id,
    'opening_stock',
    p_quantity,
    COALESCE(p_notes, 'Initial opening inventory'),
    auth.uid()
  );

  RETURN v_batch_id;
END;
$function$;

COMMIT;
