-- RECONSTRUCTED EQUIVALENT; this is not the recovered original SQL.
-- Remove TRUNCATE access only on the six verified medicine-management tables.
-- PUBLIC is included to prevent inherited TRUNCATE grants; other privileges
-- and unrelated tables are not changed.

BEGIN;

REVOKE TRUNCATE ON TABLE
  public.invoice_batch_allocations,
  public.invoice_items,
  public.manufacturers,
  public.medicine_batches,
  public.medicines,
  public.stock_movements
FROM PUBLIC, anon, authenticated;

COMMIT;