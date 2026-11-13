-- Remove the public order-request feature objects created by
-- retina-public-order-requests-migration.sql.
-- This rollback intentionally stops if any order data exists, so it cannot
-- silently delete submitted customer information or request history.

BEGIN;

-- Lock in parent-to-child order and block concurrent DML until this transaction ends.
LOCK TABLE public.order_requests IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.order_request_items IN SHARE ROW EXCLUSIVE MODE;

DO $rollback_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.order_requests)
     OR EXISTS (SELECT 1 FROM public.order_request_items) THEN
    RAISE EXCEPTION
      'Rollback stopped: order request data exists. Export or explicitly resolve that data before removing these tables.';
  END IF;
END;
$rollback_guard$;

REVOKE ALL ON FUNCTION public.review_order_request(uuid,text,uuid,jsonb,numeric,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_order_request(text,text,text,jsonb,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_medicine_catalogue()
  FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.review_order_request(uuid,text,uuid,jsonb,numeric,text);
DROP FUNCTION public.submit_order_request(text,text,text,jsonb,uuid);
DROP FUNCTION public.get_public_medicine_catalogue();

DROP POLICY "Owners and managers can view order request items"
  ON public.order_request_items;
DROP POLICY "Owners and managers can view order requests"
  ON public.order_requests;

DROP TABLE public.order_request_items;
DROP TABLE public.order_requests;

COMMIT;
