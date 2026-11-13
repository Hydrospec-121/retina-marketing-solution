-- ============================================================================
-- RETINA MARKETING SOLUTION: INVENTORY STOCK WRITE HARDENING
-- Reversible Supabase PostgreSQL migration
-- Direct authenticated writes are removed from stock tables. Stock changes
-- remain available through role-checked, atomic database functions.
-- ============================================================================

BEGIN;

-- Remove direct client write privileges while preserving existing SELECT access.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.medicine_batches FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.stock_movements FROM PUBLIC, anon, authenticated;

-- Write policies are no longer needed for browser clients. Keep the existing
-- SELECT policies intact; SECURITY DEFINER stock functions are owned by the
-- postgres table owner and perform their own explicit role checks.
DROP POLICY IF EXISTS "Inventory staff can add batches" ON public.medicine_batches;
DROP POLICY IF EXISTS "Inventory staff can update batches" ON public.medicine_batches;
DROP POLICY IF EXISTS "Inventory staff can record stock movements" ON public.stock_movements;

-- Opening-stock workflow: preserve owner-only authorization while allowing
-- the function to write atomically after direct client INSERT is revoked.
ALTER FUNCTION public.add_opening_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, TEXT)
    SECURITY DEFINER;
ALTER FUNCTION public.add_opening_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, TEXT)
    SET search_path = '';

-- Existing receive function relied on direct table privileges and its NULL
-- role check could pass when a caller had no profile. Replace it with a
-- SECURITY DEFINER function that explicitly requires an authenticated profile.
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

    IF p_purchase_price IS NULL OR p_purchase_price < 0 THEN
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

-- Existing correction logic already locks the batch, updates current_quantity,
-- and inserts its adjustment movement in one function transaction. Pin its
-- search path to prevent object-shadowing attacks.
ALTER FUNCTION public.adjust_batch_stock_count(UUID, INTEGER, TEXT, TEXT)
    SECURITY DEFINER;
ALTER FUNCTION public.adjust_batch_stock_count(UUID, INTEGER, TEXT, TEXT)
    SET search_path = '';

-- Keep the password verifier's owner check and private settings lookup, with a
-- fixed search path for its SECURITY DEFINER execution.
ALTER FUNCTION public.verify_stock_adjustment_password(TEXT)
    SECURITY DEFINER;
ALTER FUNCTION public.verify_stock_adjustment_password(TEXT)
    SET search_path = '';

-- Invoice creation already validates owner/manager/sales, locks batches in
-- FEFO order, and atomically writes invoice allocations, quantities, and sale
-- movements. Preserve its body and behavior while pinning its search path.
ALTER FUNCTION public.create_sales_invoice(UUID, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT)
    SECURITY DEFINER;
ALTER FUNCTION public.create_sales_invoice(UUID, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT)
    SET search_path = '';

-- Revoke inherited/default execution and explicitly allow authenticated callers.
REVOKE ALL ON FUNCTION public.add_opening_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receive_medicine_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.adjust_batch_stock_count(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_stock_adjustment_password(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_sales_invoice(UUID, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_opening_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_medicine_stock(UUID, TEXT, DATE, NUMERIC, INTEGER, DATE, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_batch_stock_count(UUID, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_stock_adjustment_password(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sales_invoice(UUID, JSONB, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;
