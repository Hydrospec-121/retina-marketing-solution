-- Restore the exact direct TRUNCATE grants found before the hardening
-- migration. Pre-migration inspection found grants to anon and authenticated
-- (without grant option) and no direct grant to PUBLIC on these tables.
-- Applying this rollback reopens the prior TRUNCATE access.

BEGIN;

GRANT TRUNCATE ON TABLE
  public.manufacturers,
  public.medicines,
  public.medicine_batches,
  public.stock_movements,
  public.invoice_items,
  public.invoice_batch_allocations
TO anon, authenticated;

COMMIT;
