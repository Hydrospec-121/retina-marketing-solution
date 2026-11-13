-- Retina Marketing Solution: public medicine catalogue and order requests.
-- This migration adds read-only catalogue access and pending request capture.
-- Public submission does not create invoices, reserve stock, or touch batches.

BEGIN;

CREATE TABLE public.order_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name text NOT NULL,
  phone text NOT NULL,
  delivery_address text NOT NULL,
  status text NOT NULL DEFAULT 'pending_verification',
  submitted_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  verified_at timestamptz,
  verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verification_notes text,
  accepted_discount numeric(14,2) NOT NULL DEFAULT 0,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  invoice_id uuid UNIQUE REFERENCES public.invoices(id) ON DELETE RESTRICT,
  submission_key uuid NOT NULL UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT order_requests_customer_name_check
    CHECK (pg_catalog.char_length(pg_catalog.btrim(customer_name)) BETWEEN 1 AND 150),
  CONSTRAINT order_requests_phone_check
    CHECK (pg_catalog.char_length(pg_catalog.btrim(phone)) BETWEEN 1 AND 40),
  CONSTRAINT order_requests_delivery_address_check
    CHECK (pg_catalog.char_length(pg_catalog.btrim(delivery_address)) BETWEEN 1 AND 1000),
  CONSTRAINT order_requests_verification_notes_check
    CHECK (verification_notes IS NULL OR pg_catalog.char_length(verification_notes) <= 4000),
  CONSTRAINT order_requests_accepted_discount_check CHECK (accepted_discount >= 0),
  CONSTRAINT order_requests_status_check
    CHECK (status = ANY (ARRAY['pending_verification','verified','declined','invoiced']::text[])),
  CONSTRAINT order_requests_verification_state_check
    CHECK (
      (status IN ('verified','invoiced') AND verified_at IS NOT NULL)
      OR (status IN ('pending_verification','declined') AND verified_at IS NULL)
    ),
  CONSTRAINT order_requests_verified_actor_state_check
    CHECK (verified_by IS NULL OR status IN ('verified','invoiced')),
  CONSTRAINT order_requests_invoice_state_check
    CHECK ((status = 'invoiced') = (invoice_id IS NOT NULL))
);

CREATE TABLE public.order_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_request_id uuid NOT NULL
    REFERENCES public.order_requests(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL
    REFERENCES public.medicines(id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  medicine_name_at_submission text NOT NULL,
  unit_price_at_submission numeric(14,2) NOT NULL,
  accepted_unit_price numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT order_request_items_quantity_check CHECK (quantity BETWEEN 1 AND 999),
  CONSTRAINT order_request_items_price_check CHECK (unit_price_at_submission >= 0),
  CONSTRAINT order_request_items_accepted_price_check
    CHECK (accepted_unit_price IS NULL OR accepted_unit_price >= 0),
  CONSTRAINT order_request_items_request_medicine_key UNIQUE (order_request_id, medicine_id)
);

CREATE INDEX order_requests_status_submitted_at_idx
  ON public.order_requests (status, submitted_at DESC);
CREATE INDEX order_requests_submitted_at_idx
  ON public.order_requests (submitted_at DESC);
CREATE INDEX order_requests_phone_idx
  ON public.order_requests (phone);
CREATE INDEX order_request_items_request_id_idx
  ON public.order_request_items (order_request_id);
CREATE INDEX order_request_items_medicine_id_idx
  ON public.order_request_items (medicine_id);

ALTER TABLE public.order_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_request_items ENABLE ROW LEVEL SECURITY;

-- New tables receive no direct browser write/read access by default, even if
-- project default privileges are broader than expected.
REVOKE ALL PRIVILEGES ON TABLE public.order_requests, public.order_request_items
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.order_requests, public.order_request_items
  TO authenticated;

CREATE POLICY "Owners and managers can view order requests"
  ON public.order_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role IN ('owner','manager')
    )
  );

CREATE POLICY "Owners and managers can view order request items"
  ON public.order_request_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.role IN ('owner','manager')
    )
  );

-- Public catalogue: only explicitly selected, customer-facing fields for
-- active medicines are exposed. Direct anon access to public.medicines is not
-- granted or changed by this migration.
CREATE FUNCTION public.get_public_medicine_catalogue()
RETURNS TABLE (
  id uuid,
  name text,
  generic_name text,
  strength text,
  dosage_form text,
  pack_size text,
  category text,
  selling_price numeric,
  requires_prescription boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    m.id,
    m.name,
    m.generic_name,
    m.strength,
    m.dosage_form,
    m.pack_size,
    m.category,
    m.selling_price::numeric(14,2),
    m.requires_prescription
  FROM public.medicines AS m
  WHERE m.is_active IS TRUE
  ORDER BY m.name, m.id;
$function$;

REVOKE ALL ON FUNCTION public.get_public_medicine_catalogue()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_medicine_catalogue()
  TO anon, authenticated;

-- Public submission accepts identifiers and quantities only. Prices, names,
-- status, staff identity, invoices, and stock changes are determined here or
-- remain outside this function.
CREATE FUNCTION public.submit_order_request(
  p_customer_name text,
  p_phone text,
  p_delivery_address text,
  p_items jsonb,
  p_submission_key uuid
)
RETURNS TABLE (request_id uuid, request_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_customer_name text;
  v_phone text;
  v_delivery_address text;
  v_item jsonb;
  v_medicine_id uuid;
  v_medicine_id_text text;
  v_quantity_numeric numeric;
  v_quantity integer;
  v_existing_quantity integer;
  v_distinct_count integer := 0;
  v_quantities jsonb := '{}'::jsonb;
  v_request_id uuid;
  v_existing_request public.order_requests%ROWTYPE;
  v_existing_item_count integer;
  v_medicine_entry record;
  v_medicine_name text;
  v_unit_price numeric(14,2);
BEGIN
  IF p_submission_key IS NULL THEN
    RAISE EXCEPTION 'A submission key is required';
  END IF;

  v_customer_name := pg_catalog.btrim(COALESCE(p_customer_name, ''));
  v_phone := pg_catalog.btrim(COALESCE(p_phone, ''));
  v_delivery_address := pg_catalog.btrim(COALESCE(p_delivery_address, ''));

  IF pg_catalog.char_length(v_customer_name) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'Customer name must be between 1 and 150 characters';
  END IF;
  IF pg_catalog.char_length(v_phone) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Phone must be between 1 and 40 characters';
  END IF;
  IF pg_catalog.char_length(v_delivery_address) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Delivery address must be between 1 and 1000 characters';
  END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Cart items must be a JSON array';
  END IF;
  IF pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one medicine to the request';
  END IF;
  IF pg_catalog.jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'A cart can contain at most 100 entries';
  END IF;

  -- Normalize duplicate medicine IDs into one quantity per medicine.
  FOR v_item IN
    SELECT element.value
    FROM pg_catalog.jsonb_array_elements(p_items) AS element(value)
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR NOT (v_item ? 'medicine_id')
       OR NOT (v_item ? 'quantity')
       OR (v_item - ARRAY['medicine_id','quantity']::text[]) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Each cart item must contain only medicine_id and quantity';
    END IF;

    IF pg_catalog.jsonb_typeof(v_item -> 'medicine_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_item -> 'quantity') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Each cart item needs a medicine ID and numeric quantity';
    END IF;

    BEGIN
      v_medicine_id := (v_item ->> 'medicine_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'A cart item has an invalid medicine ID';
    END;
    v_medicine_id_text := v_medicine_id::text;

    BEGIN
      v_quantity_numeric := (v_item ->> 'quantity')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Medicine quantities must be whole numbers from 1 to 999';
    END;

    IF v_quantity_numeric::text IN ('NaN','Infinity','-Infinity')
       OR v_quantity_numeric < 1
       OR v_quantity_numeric <> pg_catalog.trunc(v_quantity_numeric)
       OR v_quantity_numeric > 999 THEN
      RAISE EXCEPTION 'Medicine quantities must be whole numbers from 1 to 999';
    END IF;
    v_quantity := v_quantity_numeric::integer;

    v_existing_quantity := COALESCE((v_quantities ->> v_medicine_id_text)::integer, 0);
    IF v_existing_quantity = 0 THEN
      v_distinct_count := v_distinct_count + 1;
      IF v_distinct_count > 30 THEN
        RAISE EXCEPTION 'A request may contain at most 30 distinct medicines';
      END IF;
    END IF;
    IF v_existing_quantity + v_quantity > 999 THEN
      RAISE EXCEPTION 'Combined quantity for a medicine cannot exceed 999';
    END IF;

    v_quantities := v_quantities || pg_catalog.jsonb_build_object(
      v_medicine_id_text,
      v_existing_quantity + v_quantity
    );
  END LOOP;

  -- A repeated key is idempotent only for the same normalized customer data
  -- and the same combined medicine quantities. It returns no personal data.
  INSERT INTO public.order_requests (
    customer_name, phone, delivery_address, submission_key
  ) VALUES (
    v_customer_name, v_phone, v_delivery_address, p_submission_key
  )
  ON CONFLICT (submission_key) DO NOTHING
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    SELECT r.*
    INTO v_existing_request
    FROM public.order_requests AS r
    WHERE r.submission_key = p_submission_key
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Could not confirm this submission key';
    END IF;
    IF v_existing_request.customer_name IS DISTINCT FROM v_customer_name
       OR v_existing_request.phone IS DISTINCT FROM v_phone
       OR v_existing_request.delivery_address IS DISTINCT FROM v_delivery_address THEN
      RAISE EXCEPTION 'This submission key has already been used';
    END IF;

    SELECT pg_catalog.count(*)::integer
    INTO v_existing_item_count
    FROM public.order_request_items AS i
    WHERE i.order_request_id = v_existing_request.id;

    IF v_existing_item_count <> v_distinct_count
       OR EXISTS (
         SELECT 1
         FROM public.order_request_items AS i
         WHERE i.order_request_id = v_existing_request.id
           AND (
             NOT (v_quantities ? i.medicine_id::text)
             OR i.quantity <> (v_quantities ->> i.medicine_id::text)::integer
           )
       ) THEN
      RAISE EXCEPTION 'This submission key has already been used';
    END IF;

    RETURN QUERY SELECT v_existing_request.id, v_existing_request.status;
    RETURN;
  END IF;

  -- Lock active medicine rows while taking price/name snapshots. This does
  -- not read or write batch quantities and does not reserve any stock.
  FOR v_medicine_entry IN
    SELECT entry.key AS medicine_id_text, entry.value AS quantity_text
    FROM pg_catalog.jsonb_each_text(v_quantities) AS entry
    ORDER BY entry.key
  LOOP
    SELECT m.name, m.selling_price::numeric(14,2)
    INTO v_medicine_name, v_unit_price
    FROM public.medicines AS m
    WHERE m.id = v_medicine_entry.medicine_id_text::uuid
      AND m.is_active IS TRUE
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A selected medicine is unavailable';
    END IF;

    INSERT INTO public.order_request_items (
      order_request_id,
      medicine_id,
      quantity,
      medicine_name_at_submission,
      unit_price_at_submission
    ) VALUES (
      v_request_id,
      v_medicine_entry.medicine_id_text::uuid,
      v_medicine_entry.quantity_text::integer,
      v_medicine_name,
      v_unit_price
    );
  END LOOP;

  RETURN QUERY
  SELECT v_request_id, 'pending_verification'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_order_request(text,text,text,jsonb,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order_request(text,text,text,jsonb,uuid)
  TO anon, authenticated;

-- Owner/manager-only status review. No invoice is created here; invoiced is
-- reserved for a later conversion RPC and cannot be set by this function.
CREATE FUNCTION public.review_order_request(
  p_request_id uuid,
  p_new_status text,
  p_customer_id uuid DEFAULT NULL,
  p_accepted_prices jsonb DEFAULT NULL,
  p_accepted_discount numeric DEFAULT 0,
  p_verification_notes text DEFAULT NULL
)
RETURNS TABLE (request_id uuid, request_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_role text;
  v_request public.order_requests%ROWTYPE;
  v_effective_customer_id uuid;
  v_accepted_prices jsonb := '{}'::jsonb;
  v_price_item jsonb;
  v_price_medicine_id uuid;
  v_price_numeric numeric;
  v_accepted_price numeric(14,2);
  v_current_price numeric(14,2);
  v_accepted_discount numeric(14,2);
  v_quote_subtotal numeric := 0;
  v_request_item record;
  v_request_item_count integer;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.role
  INTO v_role
  FROM public.profiles AS p
  WHERE p.id = v_actor_id;

  IF COALESCE(v_role, '') NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'Only owners and managers can review order requests';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'An order request is required';
  END IF;
  IF p_verification_notes IS NOT NULL
     AND pg_catalog.char_length(p_verification_notes) > 4000 THEN
    RAISE EXCEPTION 'Review notes cannot exceed 4000 characters';
  END IF;

  SELECT r.*
  INTO v_request
  FROM public.order_requests AS r
  WHERE r.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order request not found';
  END IF;

  IF p_new_status = 'verified' AND v_request.status = 'pending_verification' THEN
    IF p_accepted_prices IS NULL
       OR pg_catalog.jsonb_typeof(p_accepted_prices) IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(p_accepted_prices) = 0 THEN
      RAISE EXCEPTION 'Accepted prices are required to verify the request';
    END IF;
    IF pg_catalog.jsonb_array_length(p_accepted_prices) > 30 THEN
      RAISE EXCEPTION 'Accepted prices can contain at most 30 entries';
    END IF;
    IF p_accepted_discount IS NULL
       OR p_accepted_discount::text IN ('NaN','Infinity','-Infinity')
       OR p_accepted_discount < 0 THEN
      RAISE EXCEPTION 'Accepted invoice discount must be zero or greater';
    END IF;
    BEGIN
      v_accepted_discount := p_accepted_discount::numeric(14,2);
    EXCEPTION WHEN numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Accepted invoice discount is outside the supported range';
    END;
    IF v_accepted_discount <> p_accepted_discount THEN
      RAISE EXCEPTION 'Accepted invoice discount may have at most two decimal places';
    END IF;

    SELECT pg_catalog.count(*)::integer
    INTO v_request_item_count
    FROM public.order_request_items AS i
    WHERE i.order_request_id = p_request_id;

    FOR v_price_item IN
      SELECT element.value
      FROM pg_catalog.jsonb_array_elements(p_accepted_prices) AS element(value)
    LOOP
      IF pg_catalog.jsonb_typeof(v_price_item) IS DISTINCT FROM 'object'
         OR NOT (v_price_item ? 'medicine_id')
         OR NOT (v_price_item ? 'unit_price')
         OR (v_price_item - ARRAY['medicine_id','unit_price']::text[]) <> '{}'::jsonb
         OR pg_catalog.jsonb_typeof(v_price_item -> 'medicine_id') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(v_price_item -> 'unit_price') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Each accepted price must contain only medicine_id and unit_price';
      END IF;

      BEGIN
        v_price_medicine_id := (v_price_item ->> 'medicine_id')::uuid;
        v_price_numeric := (v_price_item ->> 'unit_price')::numeric;
      EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'An accepted price entry is invalid';
      END;
      IF v_price_numeric::text IN ('NaN','Infinity','-Infinity') OR v_price_numeric < 0 THEN
        RAISE EXCEPTION 'Accepted unit prices must be finite and nonnegative';
      END IF;
      BEGIN
        v_accepted_price := v_price_numeric::numeric(14,2);
      EXCEPTION WHEN numeric_value_out_of_range THEN
        RAISE EXCEPTION 'An accepted unit price is outside the supported range';
      END;
      IF v_accepted_price <> v_price_numeric THEN
        RAISE EXCEPTION 'Accepted unit prices may have at most two decimal places';
      END IF;
      IF v_accepted_prices ? v_price_medicine_id::text THEN
        RAISE EXCEPTION 'Accepted prices must contain each medicine only once';
      END IF;

      v_accepted_prices := v_accepted_prices || pg_catalog.jsonb_build_object(
        v_price_medicine_id::text, v_accepted_price
      );
    END LOOP;

    IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_accepted_prices)) <> v_request_item_count THEN
      RAISE EXCEPTION 'Accepted prices must include every requested medicine exactly once';
    END IF;

    FOR v_request_item IN
      SELECT i.medicine_id, i.quantity
      FROM public.order_request_items AS i
      WHERE i.order_request_id = p_request_id
      ORDER BY i.medicine_id
    LOOP
      IF NOT (v_accepted_prices ? v_request_item.medicine_id::text) THEN
        RAISE EXCEPTION 'Accepted prices must include every requested medicine';
      END IF;

      SELECT m.selling_price::numeric(14,2)
      INTO v_current_price
      FROM public.medicines AS m
      WHERE m.id = v_request_item.medicine_id
        AND m.is_active IS TRUE
      FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'A requested medicine is no longer active';
      END IF;

      v_accepted_price := (v_accepted_prices ->> v_request_item.medicine_id::text)::numeric(14,2);
      IF v_current_price IS DISTINCT FROM v_accepted_price THEN
        RAISE EXCEPTION 'A medicine price changed. Reconfirm the current price with the customer';
      END IF;

      v_quote_subtotal := v_quote_subtotal + (v_accepted_price * v_request_item.quantity);
      UPDATE public.order_request_items AS i
      SET accepted_unit_price = v_accepted_price
      WHERE i.order_request_id = p_request_id
        AND i.medicine_id = v_request_item.medicine_id;
    END LOOP;

    IF v_accepted_discount > v_quote_subtotal THEN
      RAISE EXCEPTION 'Accepted discount cannot exceed the accepted subtotal';
    END IF;

    v_effective_customer_id := COALESCE(p_customer_id, v_request.customer_id);
    IF v_effective_customer_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.customers AS c
      WHERE c.id = v_effective_customer_id AND c.is_active IS TRUE
    ) THEN
      RAISE EXCEPTION 'Select an active customer or leave the customer link empty';
    END IF;

    UPDATE public.order_requests AS r
    SET status = 'verified',
        verified_at = pg_catalog.now(),
        verified_by = v_actor_id,
        accepted_discount = v_accepted_discount,
        customer_id = v_effective_customer_id,
        verification_notes = COALESCE(
          NULLIF(pg_catalog.btrim(p_verification_notes), ''),
          v_request.verification_notes
        ),
        updated_at = pg_catalog.now()
    WHERE r.id = p_request_id;
  ELSIF p_new_status = 'declined' AND v_request.status = 'pending_verification' THEN
    IF p_customer_id IS NOT NULL OR p_accepted_prices IS NOT NULL
       OR COALESCE(p_accepted_discount, 0) <> 0 THEN
      RAISE EXCEPTION 'Customer and accepted price details are only allowed when verifying';
    END IF;

    UPDATE public.order_requests AS r
    SET status = 'declined',
        verification_notes = COALESCE(
          NULLIF(pg_catalog.btrim(p_verification_notes), ''),
          v_request.verification_notes
        ),
        updated_at = pg_catalog.now()
    WHERE r.id = p_request_id;
  ELSIF p_new_status = 'pending_verification' AND v_request.status = 'verified' THEN
    IF p_customer_id IS NOT NULL OR p_accepted_prices IS NOT NULL
       OR COALESCE(p_accepted_discount, 0) <> 0 THEN
      RAISE EXCEPTION 'Customer and accepted price details cannot be changed while returning to verification';
    END IF;

    UPDATE public.order_requests AS r
    SET status = 'pending_verification',
        verified_at = NULL,
        verified_by = NULL,
        accepted_discount = 0,
        verification_notes = COALESCE(
          NULLIF(pg_catalog.btrim(p_verification_notes), ''),
          v_request.verification_notes
        ),
        updated_at = pg_catalog.now()
    WHERE r.id = p_request_id;
    UPDATE public.order_request_items AS i
    SET accepted_unit_price = NULL
    WHERE i.order_request_id = p_request_id;
  ELSE
    RAISE EXCEPTION 'This order request status transition is not allowed';
  END IF;

  RETURN QUERY SELECT p_request_id, p_new_status;
END;
$function$;

REVOKE ALL ON FUNCTION public.review_order_request(uuid,text,uuid,jsonb,numeric,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_order_request(uuid,text,uuid,jsonb,numeric,text)
  TO authenticated;

COMMIT;
