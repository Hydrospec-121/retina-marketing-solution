-- Remove only unintended TRUNCATE privileges from browser roles on medicine-
-- linked catalogue, inventory, and invoice-detail tables.
-- Pre-migration ACL inspection found direct TRUNCATE grants to anon and
-- authenticated, with no direct PUBLIC TRUNCATE grant on these tables.
-- All other table privileges, RLS policies, and data remain unchanged.

BEGIN;

REVOKE TRUNCATE ON TABLE
  public.manufacturers,
  public.medicines,
  public.medicine_batches,
  public.stock_movements,
  public.invoice_items,
  public.invoice_batch_allocations
FROM PUBLIC, anon, authenticated;

COMMIT;
