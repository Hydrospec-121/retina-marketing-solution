-- Depends on 20261112064056_medicine_wise_inventory.sql.
-- Existing medicine cost can be initialized only before medicine-level stock activity.

DO $dependency_guard$
BEGIN
  IF to_regclass('public.medicine_stock_movements') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'medicines'
         AND column_name = 'stock_quantity'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'medicines'
         AND column_name = 'purchase_cost_avg'
     ) THEN
    RAISE EXCEPTION 'Apply 20261112064056_medicine_wise_inventory before setting initial medicine cost.';
  END IF;
END;
$dependency_guard$;

CREATE TABLE public.medicine_initial_cost_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE RESTRICT,
  previous_average_cost NUMERIC(16,4) NOT NULL CHECK (
    previous_average_cost >= 0
    AND previous_average_cost::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
  ),
  new_average_cost NUMERIC(16,4) NOT NULL CHECK (
    new_average_cost >= 0
    AND new_average_cost::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
  ),
  reason TEXT NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(reason)) BETWEEN 1 AND 500),
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX medicine_initial_cost_changes_medicine_created_idx
  ON public.medicine_initial_cost_changes (medicine_id, created_at DESC, id DESC);

ALTER TABLE public.medicine_initial_cost_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.medicine_initial_cost_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.medicine_initial_cost_changes TO authenticated;
CREATE POLICY "Authorized staff can view medicine initial cost changes"
  ON public.medicine_initial_cost_changes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.id = (SELECT auth.uid())
        AND profile.role IN ('owner', 'manager', 'inventory_manager')
    )
  );

CREATE FUNCTION public.set_medicine_initial_cost(
  p_medicine_id UUID,
  p_purchase_cost NUMERIC,
  p_reason TEXT
)
RETURNS NUMERIC(16,4)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_previous_cost NUMERIC(16,4);
  v_new_cost NUMERIC(16,4);
  v_is_active BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT profile.role INTO v_role
  FROM public.profiles AS profile
  WHERE profile.id = v_user_id;

  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'inventory_manager') THEN
    RAISE EXCEPTION 'You are not authorized to initialize medicine cost';
  END IF;

  IF p_purchase_cost IS NULL
     OR p_purchase_cost::TEXT IN ('NaN', 'Infinity', '-Infinity')
     OR p_purchase_cost < 0
     OR p_purchase_cost > 999999999999.9999
     OR p_purchase_cost <> pg_catalog.round(p_purchase_cost, 4) THEN
    RAISE EXCEPTION 'Purchase cost must be finite, nonnegative, and have at most four decimal places';
  END IF;
  IF p_reason IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'A reason of 1 to 500 characters is required';
  END IF;

  -- All medicine-wise stock RPCs lock this same medicine row before changing
  -- stock or recording a movement, so concurrent stock activity serializes here.
  SELECT medicine.purchase_cost_avg, medicine.is_active
  INTO v_previous_cost, v_is_active
  FROM public.medicines AS medicine
  WHERE medicine.id = p_medicine_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medicine not found';
  END IF;
  IF v_is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Only active medicines can have their initial cost set';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.medicines AS medicine
    WHERE medicine.id = p_medicine_id AND medicine.stock_quantity <> 0
  ) OR EXISTS (
    SELECT 1 FROM public.medicine_stock_movements AS movement
    WHERE movement.medicine_id = p_medicine_id
  ) THEN
    RAISE EXCEPTION 'Purchase cost can only be initialized before stock activity begins';
  END IF;

  UPDATE public.medicines
  SET purchase_cost_avg = p_purchase_cost,
      updated_at = now()
  WHERE id = p_medicine_id
  RETURNING purchase_cost_avg INTO v_new_cost;

  INSERT INTO public.medicine_initial_cost_changes (
    medicine_id, previous_average_cost, new_average_cost, reason, actor_id
  ) VALUES (
    p_medicine_id, v_previous_cost, v_new_cost, pg_catalog.btrim(p_reason), v_user_id
  );

  RETURN v_new_cost;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_medicine_initial_cost(UUID, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_medicine_initial_cost(UUID, NUMERIC, TEXT)
  TO authenticated;
