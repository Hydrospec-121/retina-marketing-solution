-- Record a staff-entered collection against a posted invoice.
-- The invoice row lock serializes collectors so concurrent payments cannot
-- both spend the same outstanding balance.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  p_invoice_id UUID,
  p_amount NUMERIC,
  p_payment_method TEXT,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_payment_date DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role TEXT;
  v_invoice_total NUMERIC;
  v_invoice_status TEXT;
  v_total_paid NUMERIC;
  v_amount NUMERIC;
  v_outstanding NUMERIC;
  v_payment_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role
  INTO v_role
  FROM public.profiles AS p
  WHERE p.id = auth.uid();

  IF COALESCE(v_role, '') NOT IN ('owner', 'manager', 'sales', 'accountant') THEN
    RAISE EXCEPTION 'You are not authorized to record invoice payments';
  END IF;

  IF p_amount IS NULL
     OR p_amount::TEXT IN ('NaN', 'Infinity', '-Infinity')
     OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be a finite value greater than zero';
  END IF;

  v_amount := ROUND(p_amount, 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be at least 0.01';
  END IF;

  IF COALESCE(p_payment_method, '') NOT IN (
    'cash', 'bank_transfer', 'mobile_banking', 'cheque', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid payment method';
  END IF;

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;

  SELECT i.total, i.status
  INTO v_invoice_total, v_invoice_status
  FROM public.invoices AS i
  WHERE i.id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_invoice_status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'Only posted invoices can receive payments';
  END IF;

  SELECT COALESCE(SUM(pay.amount), 0)
  INTO v_total_paid
  FROM public.payments AS pay
  WHERE pay.invoice_id = p_invoice_id;

  v_outstanding := v_invoice_total - v_total_paid;
  IF v_outstanding <= 0 THEN
    RAISE EXCEPTION 'Invoice has no outstanding balance';
  END IF;

  IF v_amount > v_outstanding THEN
    RAISE EXCEPTION 'Payment exceeds the outstanding invoice balance';
  END IF;

  INSERT INTO public.payments (
    invoice_id,
    amount,
    payment_method,
    reference,
    notes,
    payment_date,
    received_by
  )
  VALUES (
    p_invoice_id,
    v_amount,
    p_payment_method,
    NULLIF(pg_catalog.btrim(p_reference), ''),
    NULLIF(pg_catalog.btrim(p_notes), ''),
    p_payment_date::TIMESTAMP AT TIME ZONE 'Asia/Dhaka',
    auth.uid()
  )
  RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END;
$function$;

REVOKE INSERT ON TABLE public.payments FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.record_invoice_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, DATE)
  TO authenticated;

COMMIT;
