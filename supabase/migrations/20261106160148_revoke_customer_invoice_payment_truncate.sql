-- Revoke only direct TRUNCATE privileges identified in the read-only audit.
-- Other privileges, RLS policies, and unrelated tables are unchanged.

BEGIN;

REVOKE TRUNCATE ON TABLE
  public.customers,
  public.invoices,
  public.payments
FROM anon, authenticated;

COMMIT;