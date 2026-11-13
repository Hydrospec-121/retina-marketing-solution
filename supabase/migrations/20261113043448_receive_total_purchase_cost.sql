-- Replace the per-unit receipt input with the total amount spent for this receipt.
-- Stock quantity, weighted average cost, and the movement ledger update in one transaction.
REVOKE ALL ON FUNCTION public.receive_medicine_stock(UUID, INTEGER, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.receive_medicine_stock(UUID, INTEGER, NUMERIC, TEXT);

CREATE FUNCTION public.receive_medicine_stock(
  p_medicine_id UUID,
  p_quantity INTEGER,
  p_total_purchase_cost NUMERIC,
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
  v_unit_cost NUMERIC(16,4);
  v_movement_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT profile.role INTO v_role
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id;
  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'inventory_manager') THEN
    RAISE EXCEPTION 'You are not authorized to receive stock';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;
  IF p_total_purchase_cost IS NULL
     OR p_total_purchase_cost::TEXT IN ('NaN', 'Infinity', '-Infinity')
     OR p_total_purchase_cost < 0
     OR p_total_purchase_cost > 999999999999.99
     OR p_total_purchase_cost <> pg_catalog.round(p_total_purchase_cost, 2) THEN
    RAISE EXCEPTION 'Total purchase cost must be finite, nonnegative, and have at most two decimal places';
  END IF;

  SELECT medicine.stock_quantity, medicine.purchase_cost_avg
  INTO v_old_quantity, v_old_cost
  FROM public.medicines AS medicine
  WHERE medicine.id = p_medicine_id AND medicine.is_active = TRUE
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected medicine is unavailable';
  END IF;
  IF v_old_quantity > 2147483647 - p_quantity THEN
    RAISE EXCEPTION 'Stock quantity exceeds the supported range';
  END IF;

  v_new_quantity := v_old_quantity + p_quantity;
  v_unit_cost := pg_catalog.round(p_total_purchase_cost / p_quantity, 4);
  v_new_cost := pg_catalog.round(
    (v_old_quantity::NUMERIC * v_old_cost + p_total_purchase_cost) / v_new_quantity,
    4
  );

  UPDATE public.medicines
  SET stock_quantity = v_new_quantity,
      purchase_cost_avg = v_new_cost,
      updated_at = now()
  WHERE id = p_medicine_id;

  INSERT INTO public.medicine_stock_movements (
    medicine_id, movement_type, quantity_delta, previous_quantity, resulting_quantity,
    purchase_cost, reason, actor_id
  ) VALUES (
    p_medicine_id, 'PURCHASE', p_quantity, v_old_quantity, v_new_quantity,
    v_unit_cost, NULLIF(pg_catalog.btrim(p_notes), ''), v_user_id
  ) RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_medicine_stock(UUID, INTEGER, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_medicine_stock(UUID, INTEGER, NUMERIC, TEXT)
  TO authenticated;
