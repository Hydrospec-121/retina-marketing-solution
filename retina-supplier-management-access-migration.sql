-- ============================================================================
-- RETINA MARKETING SOLUTION: SUPPLIER MANAGEMENT ACCESS
-- Repeatable Supabase PostgreSQL migration
-- Grants supplier table access only to authenticated users with owner profiles.
-- ============================================================================

BEGIN;

-- The suppliers table has no client grants or policies yet. Clear existing
-- client-role grants first, then grant only the required operations.
REVOKE ALL ON TABLE public.suppliers FROM PUBLIC, anon, authenticated;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.suppliers TO authenticated;

-- Remove only this migration's policies so it can be safely re-applied.
DROP POLICY IF EXISTS "Owners can select suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Owners can insert suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Owners can update suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Owners can delete suppliers" ON public.suppliers;

CREATE POLICY "Owners can select suppliers"
ON public.suppliers
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = auth.uid()
          AND p.role = 'owner'
    )
);

CREATE POLICY "Owners can insert suppliers"
ON public.suppliers
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = auth.uid()
          AND p.role = 'owner'
    )
);

CREATE POLICY "Owners can update suppliers"
ON public.suppliers
FOR UPDATE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = auth.uid()
          AND p.role = 'owner'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = auth.uid()
          AND p.role = 'owner'
    )
);

CREATE POLICY "Owners can delete suppliers"
ON public.suppliers
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = auth.uid()
          AND p.role = 'owner'
    )
);

COMMIT;
