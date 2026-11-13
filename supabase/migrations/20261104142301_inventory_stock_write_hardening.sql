-- RECONSTRUCTED EQUIVALENT; this is not the recovered original SQL.
-- Scope is limited to direct write privileges on the verified stock tables.
-- Read privileges and existing role-checked SECURITY DEFINER RPCs are preserved.

BEGIN;

REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.medicine_batches,
  public.stock_movements
FROM PUBLIC, anon, authenticated;

COMMIT;