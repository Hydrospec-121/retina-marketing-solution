-- Preserve the customer name used on each invoice and permit walk-in sales.
-- Existing invoice names are copied from their linked customer before the
-- customer reference becomes nullable.
ALTER TABLE public.invoices
  ADD COLUMN customer_name text;

-- Keep existing registered-customer RPC inserts compatible while ensuring
-- the database, rather than client input, captures the registered name.
CREATE OR REPLACE FUNCTION public.set_invoice_customer_name_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    SELECT customer.name
    INTO NEW.customer_name
    FROM public.customers AS customer
    WHERE customer.id = NEW.customer_id;

    IF NEW.customer_name IS NULL THEN
      RAISE EXCEPTION 'Selected customer does not exist';
    END IF;
  END IF;

  IF NEW.customer_name IS NULL OR pg_catalog.btrim(NEW.customer_name) = '' THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_invoice_customer_name_snapshot() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER invoices_set_customer_name_snapshot
BEFORE INSERT ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.set_invoice_customer_name_snapshot();

UPDATE public.invoices AS invoice
SET customer_name = customer.name
FROM public.customers AS customer
WHERE customer.id = invoice.customer_id
  AND invoice.customer_name IS NULL;

ALTER TABLE public.invoices
  ALTER COLUMN customer_id DROP NOT NULL,
  ALTER COLUMN customer_name SET NOT NULL,
  ADD CONSTRAINT invoices_customer_name_check
    CHECK (pg_catalog.char_length(pg_catalog.btrim(customer_name)) BETWEEN 1 AND 150);
