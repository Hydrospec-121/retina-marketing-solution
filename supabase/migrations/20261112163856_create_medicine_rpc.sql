-- Create catalogue entries without granting browser clients access to stock
-- or weighted-average cost columns. Requires medicine-wise inventory columns.
CREATE FUNCTION public.create_medicine(
  p_name TEXT,
  p_generic_name TEXT,
  p_strength TEXT,
  p_dosage_form TEXT,
  p_pack_size TEXT,
  p_category TEXT,
  p_purchase_price NUMERIC,
  p_selling_price NUMERIC,
  p_min_stock_level INTEGER,
  p_requires_prescription BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_medicine_id UUID;
  v_name TEXT := pg_catalog.btrim(COALESCE(p_name, ''));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT profile.role INTO v_role
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id;

  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'inventory_manager') THEN
    RAISE EXCEPTION 'You are not authorized to add medicines';
  END IF;
  IF pg_catalog.char_length(v_name) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'Medicine name must be between 1 and 150 characters';
  END IF;
  IF p_purchase_price IS NULL
     OR p_purchase_price::TEXT IN ('NaN', 'Infinity', '-Infinity')
     OR p_purchase_price < 0
     OR p_purchase_price > 999999999999.99
     OR p_purchase_price <> pg_catalog.round(p_purchase_price, 2) THEN
    RAISE EXCEPTION 'Purchase price must be finite, nonnegative, and have at most two decimal places';
  END IF;
  IF p_selling_price IS NULL
     OR p_selling_price::TEXT IN ('NaN', 'Infinity', '-Infinity')
     OR p_selling_price < 0
     OR p_selling_price > 999999999999.99
     OR p_selling_price <> pg_catalog.round(p_selling_price, 2) THEN
    RAISE EXCEPTION 'Selling price must be finite, nonnegative, and have at most two decimal places';
  END IF;
  IF p_min_stock_level IS NULL OR p_min_stock_level < 0 THEN
    RAISE EXCEPTION 'Minimum stock level must be a nonnegative whole number';
  END IF;

  INSERT INTO public.medicines (
    name, generic_name, strength, dosage_form, pack_size, category,
    purchase_cost_avg, selling_price, min_stock_level,
    requires_prescription, is_active, stock_quantity
  ) VALUES (
    v_name,
    NULLIF(pg_catalog.btrim(COALESCE(p_generic_name, '')), ''),
    NULLIF(pg_catalog.btrim(COALESCE(p_strength, '')), ''),
    NULLIF(pg_catalog.btrim(COALESCE(p_dosage_form, '')), ''),
    NULLIF(pg_catalog.btrim(COALESCE(p_pack_size, '')), ''),
    NULLIF(pg_catalog.btrim(COALESCE(p_category, '')), ''),
    pg_catalog.round(p_purchase_price, 4),
    p_selling_price,
    p_min_stock_level,
    COALESCE(p_requires_prescription, FALSE),
    TRUE,
    0
  )
  RETURNING id INTO v_medicine_id;

  RETURN v_medicine_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_medicine(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_medicine(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, BOOLEAN)
  TO authenticated;
