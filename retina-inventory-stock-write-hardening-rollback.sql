-- ============================================================================
-- RETINA MARKETING SOLUTION: ROLLBACK STOCK WRITE HARDENING
-- Restores the pre-hardening grants, policies, function settings, and receive
-- function behavior. Running this intentionally reopens direct stock writes.
-- ============================================================================

BEGIN;

-- Restore the pre-migration direct grants.
GRANT INSERT, UPDATE ON TABLE public.medicine_batches TO authenticated;
GRANT INSERT ON TABLE public.stock_movements TO authenticated;

-- Restore the pre-migration write policies.
CREATE POLICY "Inventory staff can add batches"
ON public.medicine_batches
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('owner', 'manager', 'inventory_manager')
    )
);

CREATE POLICY "Inventory staff can update batches"
ON public.medicine_batches
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('owner', 'manager', 'inventory_manager')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('owner', 'manager', 'inventory_manager')
    )
);

CREATE POLICY "Inventory staff can record stock movements"
ON public.stock_movements
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role IN ('owner', 'manager', 'inventory_manager')
    )
);

-- Restore the prior SECURITY INVOKER attributes and search paths.
ALTER FUNCTION public.add_opening_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, TEXT)
    SECURITY INVOKER;
ALTER FUNCTION public.add_opening_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, TEXT)
    SET search_path = public;

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
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
    v_role TEXT;
    v_batch_id UUID;
BEGIN
    SELECT role INTO v_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF v_role NOT IN ('owner', 'manager', 'inventory_manager') THEN
        RAISE EXCEPTION 'You are not authorized to receive stock';
    END IF;

    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Quantity must be greater than zero';
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
        'purchase',
        p_quantity,
        p_notes,
        auth.uid()
    );

    RETURN v_batch_id;
END;
$function$;

ALTER FUNCTION public.adjust_batch_stock_count(UUID, INTEGER, TEXT, TEXT)
    SET search_path = public;
ALTER FUNCTION public.verify_stock_adjustment_password(TEXT)
    SET search_path = public;
ALTER FUNCTION public.create_sales_invoice(UUID, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT)
    SET search_path = public, auth;

-- Restore the original function execution exposure: three of these functions
-- were executable by PUBLIC; adjustment and password verification were auth-only.
GRANT EXECUTE ON FUNCTION public.add_opening_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_medicine_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, UUID, TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sales_invoice(UUID, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO PUBLIC;

REVOKE ALL ON FUNCTION public.adjust_batch_stock_count(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_stock_adjustment_password(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_batch_stock_count(UUID, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_stock_adjustment_password(TEXT) TO authenticated;

COMMIT;
