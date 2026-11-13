-- ============================================================================
-- RETINA MARKETING SOLUTION: SALES, ACCOUNTING & CASH MANAGEMENT FOUNDATION
-- Migration Version: 2026-11-01-002 (Syntax, Search Path & Policy Cleanup Fixes)
-- Safe, Repeatable DDL for Supabase PostgreSQL
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. PHONE NUMBER NORMALIZATION HELPER FUNCTION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone TEXT)
RETURNS TEXT 
LANGUAGE plpgsql 
IMMUTABLE 
PARALLEL SAFE
SET search_path = ''
AS $$
BEGIN
    IF p_phone IS NULL THEN
        RETURN NULL;
    END IF;
    -- Strip non-digit characters except leading plus
    -- Normalize common Bangladesh prefixes:
    -- "+8801XXXXXXXXX" or "8801XXXXXXXXX" -> "01XXXXXXXXX"
    RETURN regexp_replace(
        regexp_replace(trim(p_phone), '[^\d+]', '', 'g'),
        '^(\+?88)?(01[3-9]\d{8})$',
        '\2'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. CUSTOMERS TABLE (Non-unique phone; multiple customers/addresses supported)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safely drop legacy unique constraint/index on phone if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'customers_phone_key' AND conrelid = 'public.customers'::regclass
    ) THEN
        ALTER TABLE public.customers DROP CONSTRAINT customers_phone_key;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' AND indexname = 'customers_phone_key'
    ) THEN
        DROP INDEX public.customers_phone_key;
    END IF;
END $$;

-- Functional index on normalized phone for rapid customer lookup
CREATE INDEX IF NOT EXISTS idx_customers_phone_normalized 
ON public.customers (public.normalize_phone(phone));

CREATE INDEX IF NOT EXISTS idx_customers_phone 
ON public.customers (phone);

-- ----------------------------------------------------------------------------
-- 2. ORDERS TABLE (With Delivery Assignment Mechanism)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number TEXT NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    assigned_delivery_staff_id UUID REFERENCES public.profiles(id),
    order_status TEXT NOT NULL DEFAULT 'Pending' 
        CHECK (order_status IN ('Pending', 'Confirmed', 'Processing', 'Dispatched', 'Delivered', 'Cancelled')),
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0),
    discount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (discount >= 0),
    delivery_charge NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (delivery_charge >= 0),
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
    notes TEXT,
    cancelled_reason TEXT,
    confirmed_at TIMESTAMPTZ,
    dispatched_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add column if orders table was already created in earlier draft
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'orders' 
          AND column_name = 'assigned_delivery_staff_id'
    ) THEN
        ALTER TABLE public.orders 
        ADD COLUMN assigned_delivery_staff_id UUID REFERENCES public.profiles(id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON public.orders(delivered_at);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_staff ON public.orders(assigned_delivery_staff_id);

-- ----------------------------------------------------------------------------
-- 3. ORDER ITEMS TABLE (Preserves historical selling prices & descriptions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE RESTRICT,
    medicine_name TEXT NOT NULL,
    strength TEXT,
    dosage_form TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(12,2) NOT NULL CHECK (total_price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_medicine_id ON public.order_items(medicine_id);

-- Order Item Validation Trigger Function (Financial Integrity & State Machine Lock)
CREATE OR REPLACE FUNCTION public.validate_order_item()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_order_status TEXT;
    v_order_number TEXT;
BEGIN
    -- Explicit NULL-safe authentication and profile check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Order item operations must be performed by an authenticated staff member';
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: Profile or role not found for user %', auth.uid();
    END IF;

    IF TG_OP = 'DELETE' THEN
        SELECT order_status, order_number INTO v_order_status, v_order_number
        FROM public.orders
        WHERE id = OLD.order_id;

        IF NOT FOUND OR v_order_status IS NULL OR v_order_status <> 'Pending' THEN
            RAISE EXCEPTION 'Cannot delete items from order %: Current status is "%" (items can only be deleted on Pending orders)',
                COALESCE(v_order_number, 'unknown'), COALESCE(v_order_status, 'unknown');
        END IF;

        IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'sales') THEN
            RAISE EXCEPTION 'Access denied: Staff with role "%" are not authorized to delete order items', COALESCE(v_role, 'unknown');
        END IF;

        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Order items cannot be updated directly. Remove and re-insert items on Pending orders to preserve pricing audit integrity';
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT order_status, order_number INTO v_order_status, v_order_number
        FROM public.orders
        WHERE id = NEW.order_id;

        IF NOT FOUND OR v_order_status IS NULL OR v_order_status <> 'Pending' THEN
            RAISE EXCEPTION 'Cannot add items to order %: Current status is "%" (items can only be added to Pending orders)',
                COALESCE(v_order_number, 'unknown'), COALESCE(v_order_status, 'unknown');
        END IF;

        IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'sales') THEN
            RAISE EXCEPTION 'Access denied: Staff with role "%" are not authorized to add order items', COALESCE(v_role, 'unknown');
        END IF;

        -- Validate arithmetic: total_price = quantity * unit_price
        IF NEW.quantity <= 0 THEN
            RAISE EXCEPTION 'Order item quantity must be greater than zero';
        END IF;

        IF NEW.unit_price < 0 THEN
            RAISE EXCEPTION 'Order item unit_price cannot be negative';
        END IF;

        IF NEW.total_price <> ROUND(NEW.quantity * NEW.unit_price, 2) THEN
            RAISE EXCEPTION 'Order item total_price (৳%) does not match quantity (%) * unit_price (৳%). Expected: ৳%',
                NEW.total_price, NEW.quantity, NEW.unit_price, ROUND(NEW.quantity * NEW.unit_price, 2);
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_order_item ON public.order_items;
CREATE TRIGGER trg_validate_order_item
BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_item();

-- ----------------------------------------------------------------------------
-- 4. ORDER BATCH ALLOCATIONS TABLE & CONCURRENCY-SAFE INTEGRITY
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_batch_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
    batch_id UUID NOT NULL REFERENCES public.medicine_batches(id) ON DELETE RESTRICT,
    allocated_quantity INTEGER NOT NULL CHECK (allocated_quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_batch_allocations_item_batch
ON public.order_batch_allocations (order_item_id, batch_id);

CREATE INDEX IF NOT EXISTS idx_allocations_batch ON public.order_batch_allocations(batch_id);
CREATE INDEX IF NOT EXISTS idx_allocations_item ON public.order_batch_allocations(order_item_id);

-- Concurrency-Safe Stock Reservation & Allocation Validation Trigger
CREATE OR REPLACE FUNCTION public.validate_batch_allocation()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_item RECORD;
    v_batch RECORD;
    v_total_active_reserved INTEGER;
    v_available_stock INTEGER;
    v_total_item_allocated INTEGER;
BEGIN
    -- Explicit NULL-safe authentication and profile check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Batch allocations must be managed by an authenticated staff member';
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: Profile or role not found for user %', auth.uid();
    END IF;

    IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'inventory_manager') THEN
        RAISE EXCEPTION 'Access denied: Staff with role "%" are not authorized to manage batch allocations', COALESCE(v_role, 'unknown');
    END IF;

    -- 1. Concurrency Lock: Lock the parent order_item row and join orders to inspect order status
    SELECT oi.id, oi.order_id, oi.medicine_id, oi.quantity, o.order_status, o.order_number
    INTO v_item
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = NEW.order_item_id
    FOR UPDATE OF oi;

    IF NOT FOUND OR v_item.order_status IS NULL OR v_item.order_status <> 'Pending' THEN
        RAISE EXCEPTION 'Cannot modify allocations for order %: Current status is "%". Batch allocations can only be modified while an order is Pending.',
            COALESCE(v_item.order_number, 'unknown'), COALESCE(v_item.order_status, 'unknown');
    END IF;

    -- 3. Concurrency Lock: Lock the target medicine_batches row using SELECT ... FOR UPDATE
    -- This enforces strict serialization for concurrent allocation requests targeting the same batch
    SELECT id, medicine_id, current_quantity, expiry_date, batch_number
    INTO v_batch
    FROM public.medicine_batches
    WHERE id = NEW.batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Medicine batch % not found', NEW.batch_id;
    END IF;

    -- 4. Integrity Check: Allocated batch must belong to the exact medicine referenced by the order item
    IF v_batch.medicine_id <> v_item.medicine_id THEN
        RAISE EXCEPTION 'Batch medicine mismatch. Batch % belongs to medicine %, but order item references medicine %',
            NEW.batch_id, v_batch.medicine_id, v_item.medicine_id;
    END IF;

    -- 5. Expiry Check: Do not treat expired batches as usable stock
    IF v_batch.expiry_date < CURRENT_DATE THEN
        RAISE EXCEPTION 'Cannot allocate from expired batch % (Expiry: %)',
            v_batch.batch_number, v_batch.expiry_date;
    END IF;

    -- 6. Concurrency-Safe Active Reservation Calculation across ALL orders:
    -- - Pending and Cancelled orders DO NOT reserve stock.
    -- - Confirmed and Processing orders DO reserve stock.
    -- - Dispatched and Delivered orders already deducted physical batch quantities at dispatch.
    SELECT COALESCE(SUM(oba.allocated_quantity), 0)
    INTO v_total_active_reserved
    FROM public.order_batch_allocations oba
    JOIN public.order_items oi ON oba.order_item_id = oi.id
    JOIN public.orders o ON oi.order_id = o.id
    WHERE oba.batch_id = NEW.batch_id
      AND o.order_status IN ('Confirmed', 'Processing')
      AND oba.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    -- Available stock is physical current_quantity minus active reservations
    v_available_stock := v_batch.current_quantity - v_total_active_reserved;

    -- 7. Prevent overselling against available stock
    IF NEW.allocated_quantity > v_available_stock THEN
        RAISE EXCEPTION 'Insufficient stock in batch % (Expiry: %). Physical current stock: %, Active reservations: %, Available: %, Requested: %',
            v_batch.batch_number, v_batch.expiry_date, v_batch.current_quantity, v_total_active_reserved, v_available_stock, NEW.allocated_quantity;
    END IF;

    -- 8. Quantity Limit per Order Item: Allocations across batches cannot exceed item quantity
    SELECT COALESCE(SUM(allocated_quantity), 0)
    INTO v_total_item_allocated
    FROM public.order_batch_allocations
    WHERE order_item_id = NEW.order_item_id
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF (v_total_item_allocated + NEW.allocated_quantity) > v_item.quantity THEN
        RAISE EXCEPTION 'Allocation exceeds order item quantity. Item requested: %, Already allocated: %, Attempted to add: %',
            v_item.quantity, v_total_item_allocated, NEW.allocated_quantity;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_batch_allocation ON public.order_batch_allocations;
CREATE TRIGGER trg_validate_batch_allocation
BEFORE INSERT OR UPDATE ON public.order_batch_allocations
FOR EACH ROW
EXECUTE FUNCTION public.validate_batch_allocation();

-- Allocation Deletion Guard Trigger (Protect historical allocations on non-Pending orders)
CREATE OR REPLACE FUNCTION public.validate_batch_allocation_delete()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_order_status TEXT;
    v_order_number TEXT;
BEGIN
    -- Explicit NULL-safe authentication and profile check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Batch allocation deletion must be performed by an authenticated staff member';
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: Profile or role not found for user %', auth.uid();
    END IF;

    IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'inventory_manager') THEN
        RAISE EXCEPTION 'Access denied: Staff with role "%" are not authorized to delete batch allocations', COALESCE(v_role, 'unknown');
    END IF;

    SELECT o.order_status, o.order_number 
    INTO v_order_status, v_order_number
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = OLD.order_item_id;

    -- Allocations can ONLY be deleted while the order is strictly Pending (Requirement 3 & 4)
    IF NOT FOUND OR v_order_status IS NULL OR v_order_status <> 'Pending' THEN
        RAISE EXCEPTION 'Cannot delete allocations for order %: Current status is "%". Batch allocations can only be deleted while an order is Pending.',
            COALESCE(v_order_number, 'unknown'), COALESCE(v_order_status, 'unknown');
    END IF;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_batch_allocation_delete ON public.order_batch_allocations;
CREATE TRIGGER trg_validate_batch_allocation_delete
BEFORE DELETE ON public.order_batch_allocations
FOR EACH ROW
EXECUTE FUNCTION public.validate_batch_allocation_delete();

-- ----------------------------------------------------------------------------
-- 5. PAYMENTS TABLE & UNIVERSAL OWNERSHIP / REVERSAL VALIDATION
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number TEXT NOT NULL UNIQUE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_type TEXT NOT NULL DEFAULT 'Collection' CHECK (payment_type IN ('Collection', 'Reversal')),
    reversal_of_payment_id UUID REFERENCES public.payments(id) ON DELETE RESTRICT,
    payment_method TEXT NOT NULL DEFAULT 'Cash' CHECK (payment_method IN ('Cash', 'Direct Bank Deposit', 'Manual MFS')),
    payment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_by UUID REFERENCES public.profiles(id),
    receipt_reference TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Reversal reference constraint
    CONSTRAINT check_reversal_reference CHECK (
        (payment_type = 'Reversal' AND reversal_of_payment_id IS NOT NULL) OR
        (payment_type = 'Collection' AND reversal_of_payment_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON public.payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_reversal_ref ON public.payments(reversal_of_payment_id);

-- Universal Payment Validation Trigger Function (Audit Integrity, Immutability & Reversal Concurrency)
CREATE OR REPLACE FUNCTION public.validate_payment()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_order RECORD;
    v_orig RECORD;
    v_total_reversed NUMERIC(12,2);
BEGIN
    -- 1. Immutability Check: Payment records are strictly immutable financial ledger entries
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Payment records are strictly immutable and cannot be updated. Use a Reversal transaction instead';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Payment records are strictly immutable and cannot be deleted from the financial audit log';
    END IF;

    -- 2. Audit Trail Integrity & Explicit NULL-safe authorization check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Payments must be recorded by an authenticated staff member';
    END IF;
    NEW.received_by := auth.uid();

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: Profile or role not found for user %', auth.uid();
    END IF;

    IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'accountant') THEN
        RAISE EXCEPTION 'Access denied: Staff with role "%" are not authorized to record payments', COALESCE(v_role, 'unknown');
    END IF;

    -- 3. Prevent Payment Date Manipulation / Unauthorized Backdating
    -- Non-managers (accountants) cannot backdate; payment_date is forced to now()
    -- Owners/managers may specify payment_date within at most 7 days past and never in future
    IF v_role = 'accountant' THEN
        NEW.payment_date := now();
    ELSIF v_role IN ('owner', 'manager') THEN
        IF NEW.payment_date IS NULL THEN
            NEW.payment_date := now();
        ELSIF NEW.payment_date > (now() + INTERVAL '5 minutes') THEN
            RAISE EXCEPTION 'Payment date cannot be in the future';
        ELSIF NEW.payment_date < (now() - INTERVAL '7 days') THEN
            RAISE EXCEPTION 'Payment backdating is restricted to at most 7 days';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unauthorized role for payment date processing';
    END IF;

    -- 4. Universal Ownership Check (Applies to ALL payments: Collection and Reversal)
    SELECT id, customer_id, order_status, order_number 
    INTO v_order
    FROM public.orders
    WHERE id = NEW.order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found for payment', NEW.order_id;
    END IF;

    IF NEW.customer_id <> v_order.customer_id THEN
        RAISE EXCEPTION 'Payment customer ID (%) does not match order customer ID (%)',
            NEW.customer_id, v_order.customer_id;
    END IF;

    -- Block recording new collections for cancelled orders (reversals/refunds remain permitted)
    IF v_order.order_status = 'Cancelled' AND NEW.payment_type = 'Collection' THEN
        RAISE EXCEPTION 'Cannot record new collections for cancelled order %', v_order.order_number;
    END IF;

    -- 5. Reversal-Specific Validations
    IF NEW.payment_type = 'Reversal' THEN
        -- Concurrency Lock: Lock the original payment row FOR UPDATE
        SELECT id, payment_type, amount, order_id, customer_id 
        INTO v_orig
        FROM public.payments
        WHERE id = NEW.reversal_of_payment_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Target payment for reversal not found (ID: %)', NEW.reversal_of_payment_id;
        END IF;

        -- Target payment must be a Collection (reversals of reversals strictly forbidden)
        IF v_orig.payment_type = 'Reversal' THEN
            RAISE EXCEPTION 'Cannot reverse a reversal transaction. Target payment % is already a Reversal', v_orig.id;
        END IF;

        IF v_orig.payment_type <> 'Collection' THEN
            RAISE EXCEPTION 'Invalid reversal target. Only Collection payments can be reversed. Target payment % has type %',
                v_orig.id, v_orig.payment_type;
        END IF;

        -- Order and Customer matching
        IF v_orig.order_id <> NEW.order_id THEN
            RAISE EXCEPTION 'Reversal order ID (%) does not match original payment order ID (%)',
                NEW.order_id, v_orig.order_id;
        END IF;

        IF v_orig.customer_id <> NEW.customer_id THEN
            RAISE EXCEPTION 'Reversal customer ID (%) does not match original payment customer ID (%)',
                NEW.customer_id, v_orig.customer_id;
        END IF;

        -- Cumulative partial reversals check (SELECT ... FOR UPDATE lock on target prevents race conditions)
        SELECT COALESCE(SUM(amount), 0.00)
        INTO v_total_reversed
        FROM public.payments
        WHERE reversal_of_payment_id = NEW.reversal_of_payment_id
          AND payment_type = 'Reversal'
          AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

        IF (v_total_reversed + NEW.amount) > v_orig.amount THEN
            RAISE EXCEPTION 'Cumulative reversals (৳%) cannot exceed original collection amount (৳%). Already reversed: ৳%, Attempted: ৳%',
                (v_total_reversed + NEW.amount), v_orig.amount, v_total_reversed, NEW.amount;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_payment ON public.payments;
CREATE TRIGGER trg_validate_payment
BEFORE INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.validate_payment();

-- ----------------------------------------------------------------------------
-- 6. ORDER INTEGRITY, STOCK DEDUCTION & VALIDATION TRIGGERS
-- ----------------------------------------------------------------------------

-- Helper: Verify that all batch allocations for an order have available stock (Pending -> Confirmed)
-- Requires COMPLETE allocation across all items before confirmation is permitted (Requirement 3)
CREATE OR REPLACE FUNCTION public.check_order_allocations_availability(p_order_id UUID)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_item_count INTEGER;
    r_item RECORD;
    r_check RECORD;
    r_alloc RECORD;
    v_batch RECORD;
    v_active_reserved INTEGER;
    v_available_stock INTEGER;
BEGIN
    -- 1. Ensure order contains at least one item
    SELECT COUNT(*) INTO v_item_count 
    FROM public.order_items 
    WHERE order_id = p_order_id;

    IF v_item_count = 0 THEN
        RAISE EXCEPTION 'Cannot confirm order %: Order must contain at least one item', p_order_id;
    END IF;

    -- 2. Verify EVERY order item has batch allocations and total allocated equals item quantity exactly
    FOR r_item IN (
        SELECT oi.id, oi.medicine_id, oi.medicine_name, oi.quantity,
               COALESCE(SUM(oba.allocated_quantity), 0) AS total_allocated,
               COUNT(oba.id) AS allocation_count
        FROM public.order_items oi
        LEFT JOIN public.order_batch_allocations oba ON oba.order_item_id = oi.id
        WHERE oi.order_id = p_order_id
        GROUP BY oi.id, oi.medicine_id, oi.medicine_name, oi.quantity
    ) LOOP
        IF r_item.allocation_count = 0 OR r_item.total_allocated = 0 THEN
            RAISE EXCEPTION 'Cannot confirm order: Item "%" has no batch allocations. Complete stock allocation is required before confirmation.',
                r_item.medicine_name;
        END IF;

        IF r_item.total_allocated <> r_item.quantity THEN
            RAISE EXCEPTION 'Cannot confirm order: Incomplete allocation for item "%". Required: % units, Allocated: % units. Complete allocation is required.',
                r_item.medicine_name, r_item.quantity, r_item.total_allocated;
        END IF;
    END LOOP;

    -- 3. Verify every allocated batch belongs to the correct medicine and has not expired
    FOR r_check IN (
        SELECT oba.id, oba.batch_id, mb.medicine_id AS batch_med_id, oi.medicine_id AS item_med_id,
               mb.batch_number, mb.expiry_date, oi.medicine_name
        FROM public.order_batch_allocations oba
        JOIN public.order_items oi ON oba.order_item_id = oi.id
        JOIN public.medicine_batches mb ON oba.batch_id = mb.id
        WHERE oi.order_id = p_order_id
    ) LOOP
        IF r_check.batch_med_id <> r_check.item_med_id THEN
            RAISE EXCEPTION 'Cannot confirm order: Batch % does not match medicine "%"',
                r_check.batch_number, r_check.medicine_name;
        END IF;

        IF r_check.expiry_date < CURRENT_DATE THEN
            RAISE EXCEPTION 'Cannot confirm order: Allocated batch % for item "%" has expired (%)',
                r_check.batch_number, r_check.medicine_name, r_check.expiry_date;
        END IF;
    END LOOP;

    -- 4. Deterministic batch lock order (ORDER BY oba.batch_id) & concurrency-safe stock check against active reservations
    FOR r_alloc IN (
        SELECT oba.batch_id, SUM(oba.allocated_quantity) AS needed_qty
        FROM public.order_batch_allocations oba
        JOIN public.order_items oi ON oba.order_item_id = oi.id
        WHERE oi.order_id = p_order_id
        GROUP BY oba.batch_id
        ORDER BY oba.batch_id  -- Deterministic lock order to prevent deadlocks across concurrent orders
    ) LOOP
        -- Concurrency lock: lock batch row FOR UPDATE
        SELECT id, current_quantity, expiry_date, batch_number
        INTO v_batch
        FROM public.medicine_batches
        WHERE id = r_alloc.batch_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Medicine batch % not found during order validation', r_alloc.batch_id;
        END IF;

        IF v_batch.expiry_date < CURRENT_DATE THEN
            RAISE EXCEPTION 'Cannot confirm order: Allocated batch % has expired (%)',
                v_batch.batch_number, v_batch.expiry_date;
        END IF;

        -- Sum active reservations on this batch from other Confirmed/Processing orders
        SELECT COALESCE(SUM(oba.allocated_quantity), 0)
        INTO v_active_reserved
        FROM public.order_batch_allocations oba
        JOIN public.order_items oi ON oba.order_item_id = oi.id
        JOIN public.orders o ON oi.order_id = o.id
        WHERE oba.batch_id = r_alloc.batch_id
          AND o.order_status IN ('Confirmed', 'Processing')
          AND o.id <> p_order_id;

        v_available_stock := v_batch.current_quantity - v_active_reserved;

        IF r_alloc.needed_qty > v_available_stock THEN
            RAISE EXCEPTION 'Cannot confirm order: Batch % has insufficient available stock (Physical: %, Active reservations: %, Available: %, Needed: %)',
                v_batch.batch_number, v_batch.current_quantity, v_active_reserved, v_available_stock, r_alloc.needed_qty;
        END IF;
    END LOOP;
END;
$$;

-- Revoke direct execution from client roles immediately upon definition (Requirement 1)
REVOKE ALL ON FUNCTION public.check_order_allocations_availability(UUID) FROM PUBLIC, anon, authenticated;

-- Helper: Atomic Batch Quantity Deduction and Stock Movement Audit on Dispatch
-- Re-validates medicine identity, expiry, and stock availability immediately before physical deduction (Requirement 5)
CREATE OR REPLACE FUNCTION public.execute_order_dispatch_stock_deduction(p_order_id UUID, p_order_number TEXT)
RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r_item RECORD;
    r_alloc RECORD;
    v_total_item_alloc INTEGER;
    v_batch RECORD;
BEGIN
    -- 1. Ensure all order items are still fully allocated
    FOR r_item IN (
        SELECT id, medicine_name, quantity 
        FROM public.order_items 
        WHERE order_id = p_order_id
    ) LOOP
        SELECT COALESCE(SUM(allocated_quantity), 0)
        INTO v_total_item_alloc
        FROM public.order_batch_allocations
        WHERE order_item_id = r_item.id;

        IF v_total_item_alloc <> r_item.quantity THEN
            RAISE EXCEPTION 'Cannot dispatch order %: Item "%" requires % units but has % units allocated across batches',
                p_order_number, r_item.medicine_name, r_item.quantity, v_total_item_alloc;
        END IF;
    END LOOP;

    -- 2. Atomically lock each batch in deterministic order, recheck medicine and expiry, deduct physical stock, and record 'sale' in stock_movements
    FOR r_alloc IN (
        SELECT oba.id, oba.batch_id, oba.allocated_quantity, oi.medicine_id AS item_medicine_id, oi.medicine_name
        FROM public.order_batch_allocations oba
        JOIN public.order_items oi ON oba.order_item_id = oi.id
        WHERE oi.order_id = p_order_id
        ORDER BY oba.batch_id  -- Deterministic lock order
    ) LOOP
        -- Concurrency Lock: Lock batch row FOR UPDATE
        SELECT id, medicine_id, current_quantity, expiry_date, batch_number
        INTO v_batch
        FROM public.medicine_batches
        WHERE id = r_alloc.batch_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Batch % not found during dispatch deduction for order %', r_alloc.batch_id, p_order_number;
        END IF;

        -- Recheck medicine integrity at dispatch time
        IF v_batch.medicine_id <> r_alloc.item_medicine_id THEN
            RAISE EXCEPTION 'Cannot dispatch order %: Batch % medicine mismatch for item "%"',
                p_order_number, v_batch.batch_number, r_alloc.medicine_name;
        END IF;

        -- Recheck expiry at dispatch time: do NOT allow batches that expired after confirmation to be dispatched
        IF v_batch.expiry_date < CURRENT_DATE THEN
            RAISE EXCEPTION 'Cannot dispatch order %: Batch % for item "%" has expired (Expiry: %)',
                p_order_number, v_batch.batch_number, r_alloc.medicine_name, v_batch.expiry_date;
        END IF;

        -- Physical stock sufficiency check
        IF v_batch.current_quantity < r_alloc.allocated_quantity THEN
            RAISE EXCEPTION 'Cannot dispatch order %: Insufficient physical stock in batch % (Current: %, Needed: %)',
                p_order_number, v_batch.batch_number, v_batch.current_quantity, r_alloc.allocated_quantity;
        END IF;

        -- Atomically deduct physical batch stock (guaranteed >= 0)
        UPDATE public.medicine_batches
        SET current_quantity = current_quantity - r_alloc.allocated_quantity
        WHERE id = r_alloc.batch_id;

        -- Record 'sale' stock movement in the audit log
        INSERT INTO public.stock_movements (
            batch_id,
            movement_type,
            quantity,
            notes,
            created_at,
            created_by
        ) VALUES (
            r_alloc.batch_id,
            'sale',
            r_alloc.allocated_quantity,
            'Order ' || p_order_number || ' dispatched (' || r_alloc.allocated_quantity || ' units)',
            now(),
            auth.uid()
        );
    END LOOP;
END;
$$;

-- Revoke direct execution from client roles immediately upon definition (Requirement 1)
REVOKE ALL ON FUNCTION public.execute_order_dispatch_stock_deduction(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Trigger: Validate Order Creation (Prevent direct illegal inserts & enforce financial integrity)
CREATE OR REPLACE FUNCTION public.validate_order_insert()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_staff_role TEXT;
BEGIN
    -- Explicit NULL-safe authentication and profile check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Orders must be created by an authenticated staff member';
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: Profile or role not found for user %', auth.uid();
    END IF;

    -- Role-based creation restriction: only owner, manager, sales can create orders
    IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'sales') THEN
        RAISE EXCEPTION 'Access denied: Staff with role "%" are not authorized to create orders', COALESCE(v_role, 'unknown');
    END IF;

    -- Financial arithmetic and sanity checks on creation
    IF NEW.subtotal < 0 OR NEW.discount < 0 OR NEW.delivery_charge < 0 OR NEW.total_amount < 0 THEN
        RAISE EXCEPTION 'Order financial amounts cannot be negative';
    END IF;

    IF NEW.discount > NEW.subtotal THEN
        RAISE EXCEPTION 'Discount (৳%) cannot exceed subtotal (৳%)', NEW.discount, NEW.subtotal;
    END IF;

    IF NEW.total_amount <> (NEW.subtotal - NEW.discount + NEW.delivery_charge) THEN
        RAISE EXCEPTION 'Order total_amount (৳%) must equal subtotal (৳%) - discount (৳%) + delivery_charge (৳%). Expected: ৳%',
            NEW.total_amount, NEW.subtotal, NEW.discount, NEW.delivery_charge,
            (NEW.subtotal - NEW.discount + NEW.delivery_charge);
    END IF;

    -- Check delivery staff assignment on insert
    IF NEW.assigned_delivery_staff_id IS NOT NULL THEN
        IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Access denied: Only owners and managers can assign delivery staff';
        END IF;

        SELECT role INTO v_staff_role
        FROM public.profiles
        WHERE id = NEW.assigned_delivery_staff_id;

        IF NOT FOUND OR v_staff_role IS NULL THEN
            RAISE EXCEPTION 'Assigned delivery staff profile % does not exist', NEW.assigned_delivery_staff_id;
        END IF;

        IF v_staff_role <> 'delivery' THEN
            RAISE EXCEPTION 'User % has role "%" and cannot be assigned as delivery staff (must have role "delivery")',
                NEW.assigned_delivery_staff_id, v_staff_role;
        END IF;
    END IF;

    -- Orders must start exclusively in Pending status (Requirement 3)
    IF NEW.order_status <> 'Pending' THEN
        RAISE EXCEPTION 'New orders must start in status "Pending". Direct creation in status "%" is not permitted. Confirmation must proceed via the order confirmation workflow.',
            NEW.order_status;
    END IF;

    -- Ensure lifecycle timestamps are strictly clean on insertion (Requirement 6)
    NEW.confirmed_at := NULL;
    NEW.dispatched_at := NULL;
    NEW.delivered_at := NULL;
    NEW.cancelled_at := NULL;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_order_insert ON public.orders;
CREATE TRIGGER trg_validate_order_insert
BEFORE INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_insert();

-- Trigger: Comprehensive Order Update Validation (Financial Protection, State Machine & Delivery Staff Restrictions)
-- Declared SECURITY DEFINER so that internal stock helper functions can execute safely without granting direct EXECUTE to authenticated (Requirement 1)
CREATE OR REPLACE FUNCTION public.validate_order_update()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_staff_role TEXT;
    v_items_total NUMERIC(12,2);
    v_items_count INTEGER;
BEGIN
    -- Explicit NULL-safe authentication and profile check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Orders can only be updated by authenticated staff members';
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: Profile or role not found for user %', auth.uid();
    END IF;

    -- 1. Terminal State Check: Delivered and Cancelled orders are final and immutable
    IF OLD.order_status IN ('Delivered', 'Cancelled') THEN
        RAISE EXCEPTION 'Order % is in terminal state "%" and cannot be modified',
            OLD.order_number, OLD.order_status;
    END IF;

    -- 2. Core Identity Immutability
    IF NEW.id <> OLD.id OR
       NEW.order_number <> OLD.order_number OR
       NEW.customer_id <> OLD.customer_id OR
       NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'Protected order identity fields (id, order_number, customer_id, created_at) cannot be modified';
    END IF;

    -- 3. Financial Integrity & Arithmetic Validation (Defense-in-depth across all updates)
    IF NEW.subtotal < 0 OR NEW.discount < 0 OR NEW.delivery_charge < 0 OR NEW.total_amount < 0 THEN
        RAISE EXCEPTION 'Order financial amounts cannot be negative';
    END IF;

    IF NEW.discount > NEW.subtotal THEN
        RAISE EXCEPTION 'Discount (৳%) cannot exceed subtotal (৳%)', NEW.discount, NEW.subtotal;
    END IF;

    IF NEW.total_amount <> (NEW.subtotal - NEW.discount + NEW.delivery_charge) THEN
        RAISE EXCEPTION 'Order total_amount (৳%) must equal subtotal (৳%) - discount (৳%) + delivery_charge (৳%). Expected: ৳%',
            NEW.total_amount, NEW.subtotal, NEW.discount, NEW.delivery_charge,
            (NEW.subtotal - NEW.discount + NEW.delivery_charge);
    END IF;

    -- Financial pricing modification while Pending requires authorized role (owner, manager, sales)
    IF (NEW.subtotal <> OLD.subtotal OR NEW.discount <> OLD.discount OR 
        NEW.delivery_charge <> OLD.delivery_charge OR NEW.total_amount <> OLD.total_amount) THEN
        IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'sales') THEN
            RAISE EXCEPTION 'Access denied: Staff with role "%" are not authorized to modify order pricing', COALESCE(v_role, 'unknown');
        END IF;
    END IF;

    -- 4. Delivery Staff Assignment Validation (Requirement 4)
    IF NEW.assigned_delivery_staff_id IS DISTINCT FROM OLD.assigned_delivery_staff_id THEN
        IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
            RAISE EXCEPTION 'Access denied: Only owners and managers can assign or reassign delivery staff';
        END IF;

        IF NEW.assigned_delivery_staff_id IS NOT NULL THEN
            SELECT role INTO v_staff_role
            FROM public.profiles
            WHERE id = NEW.assigned_delivery_staff_id;

            IF NOT FOUND OR v_staff_role IS NULL THEN
                RAISE EXCEPTION 'Assigned delivery staff profile % does not exist', NEW.assigned_delivery_staff_id;
            END IF;

            IF v_staff_role <> 'delivery' THEN
                RAISE EXCEPTION 'User % has role "%" and cannot be assigned as delivery staff (must have role "delivery")',
                    NEW.assigned_delivery_staff_id, v_staff_role;
            END IF;
        END IF;
    END IF;

    -- 5. Strict Delivery-Staff Role Constraints (Requirement 6 & 7)
    IF v_role = 'delivery' THEN
        -- Delivery staff must only update orders assigned to their own user ID
        IF OLD.assigned_delivery_staff_id IS NULL OR OLD.assigned_delivery_staff_id <> auth.uid() THEN
            RAISE EXCEPTION 'Access denied: Delivery staff can only update orders assigned to them';
        END IF;

        -- They may only transition Dispatched -> Delivered
        IF NOT (OLD.order_status = 'Dispatched' AND NEW.order_status = 'Delivered') THEN
            RAISE EXCEPTION 'Delivery staff can only transition assigned orders from Dispatched to Delivered';
        END IF;

        -- Explicit column-by-column comparison: every protected column between OLD and NEW must match
        IF NEW.id <> OLD.id OR
           NEW.order_number <> OLD.order_number OR
           NEW.customer_id <> OLD.customer_id OR
           NEW.customer_name <> OLD.customer_name OR
           NEW.customer_phone <> OLD.customer_phone OR
           NEW.delivery_address <> OLD.delivery_address OR
           (NEW.assigned_delivery_staff_id IS DISTINCT FROM OLD.assigned_delivery_staff_id) OR
           NEW.subtotal <> OLD.subtotal OR
           NEW.discount <> OLD.discount OR
           NEW.delivery_charge <> OLD.delivery_charge OR
           NEW.total_amount <> OLD.total_amount OR
           (NEW.cancelled_reason IS DISTINCT FROM OLD.cancelled_reason) OR
           (NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) OR
           (NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at) OR
           (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at) OR
           NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'Delivery staff are forbidden from modifying pricing, financial totals, customer details, timestamps, or staff assignments';
        END IF;

        -- Force delivered_at to current timestamp; delivery staff cannot forge delivered_at
        NEW.delivered_at := now();
        NEW.updated_at := now();
        RETURN NEW;
    END IF;

    -- 6. Financial & Customer Snapshot Protection for Non-Pending Orders
    IF OLD.order_status <> 'Pending' THEN
        IF NEW.subtotal <> OLD.subtotal OR
           NEW.discount <> OLD.discount OR
           NEW.delivery_charge <> OLD.delivery_charge OR
           NEW.total_amount <> OLD.total_amount OR
           NEW.customer_name <> OLD.customer_name OR
           NEW.customer_phone <> OLD.customer_phone OR
           NEW.delivery_address <> OLD.delivery_address THEN
            RAISE EXCEPTION 'Financial totals and customer details are locked once an order is % (Order %)',
                OLD.order_status, OLD.order_number;
        END IF;
    END IF;

    -- 7. Enforce Valid Order Status Transition State Machine (Requirement 6)
    IF OLD.order_status <> NEW.order_status THEN
        IF OLD.order_status = 'Pending' AND NEW.order_status NOT IN ('Confirmed', 'Cancelled') THEN
            RAISE EXCEPTION 'Invalid status transition: Pending orders can only transition to Confirmed or Cancelled';
        ELSIF OLD.order_status = 'Confirmed' AND NEW.order_status NOT IN ('Processing', 'Dispatched', 'Cancelled') THEN
            RAISE EXCEPTION 'Invalid status transition: Confirmed orders can only transition to Processing, Dispatched, or Cancelled';
        ELSIF OLD.order_status = 'Processing' AND NEW.order_status NOT IN ('Dispatched', 'Cancelled') THEN
            RAISE EXCEPTION 'Invalid status transition: Processing orders can only transition to Dispatched or Cancelled';
        ELSIF OLD.order_status = 'Dispatched' AND NEW.order_status NOT IN ('Delivered') THEN
            RAISE EXCEPTION 'Invalid status transition: Dispatched orders can only transition to Delivered';
        ELSIF OLD.order_status IN ('Delivered', 'Cancelled') THEN
            RAISE EXCEPTION 'Terminal state: Orders in status "%" cannot change status', OLD.order_status;
        ELSE
            RAISE EXCEPTION 'Invalid status transition from "%" to "%"', OLD.order_status, NEW.order_status;
        END IF;

        -- Transition-specific authorizations and atomic actions:
        IF NEW.order_status = 'Confirmed' THEN
            IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'sales') THEN
                RAISE EXCEPTION 'Access denied: You do not have permission to confirm orders';
            END IF;
            -- Anti-forgery: force confirmed_at to now()
            NEW.confirmed_at := now();

            -- Validate that order contains at least one item and subtotal equals sum of items (Requirement 5)
            SELECT COALESCE(SUM(total_price), 0.00), COUNT(*)
            INTO v_items_total, v_items_count
            FROM public.order_items
            WHERE order_id = NEW.id;

            IF v_items_count = 0 THEN
                RAISE EXCEPTION 'Cannot confirm order %: Order must contain at least one item', NEW.order_number;
            END IF;

            IF NEW.subtotal <> v_items_total THEN
                RAISE EXCEPTION 'Cannot confirm order %: Order subtotal (৳%) does not match sum of item prices (৳%)',
                    NEW.order_number, NEW.subtotal, v_items_total;
            END IF;

            -- Concurrency-Safe Stock Reservation & Complete Allocation Check (Pending -> Confirmed)
            PERFORM public.check_order_allocations_availability(NEW.id);
        END IF;

        IF NEW.order_status = 'Processing' THEN
            IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'sales') THEN
                RAISE EXCEPTION 'Access denied: You do not have permission to transition orders to Processing';
            END IF;
        END IF;

        IF NEW.order_status = 'Dispatched' THEN
            IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
                RAISE EXCEPTION 'Access denied: Only owners and managers can dispatch orders';
            END IF;
            -- Anti-forgery: force dispatched_at to now()
            NEW.dispatched_at := now();

            -- Atomic physical batch deduction, sale stock movements creation, and reservation release (Requirement 1 & 5)
            PERFORM public.execute_order_dispatch_stock_deduction(NEW.id, NEW.order_number);
        END IF;

        IF NEW.order_status = 'Cancelled' THEN
            IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'sales') THEN
                RAISE EXCEPTION 'Access denied: You do not have permission to cancel orders';
            END IF;
            -- Anti-forgery: force cancelled_at to now()
            NEW.cancelled_at := now();
            -- Cancellation automatically releases reservations without touching physical stock
        END IF;

        IF NEW.order_status = 'Delivered' THEN
            IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'delivery') THEN
                RAISE EXCEPTION 'Access denied: You do not have permission to confirm order delivery';
            END IF;
            -- Anti-forgery: force delivered_at to now()
            NEW.delivered_at := now();
        END IF;
    ELSE
        -- If order status did NOT change, protect lifecycle timestamps against manual manipulation
        IF NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at OR
           NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at OR
           NEW.delivered_at IS DISTINCT FROM OLD.delivered_at OR
           NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
            RAISE EXCEPTION 'Lifecycle timestamps (confirmed_at, dispatched_at, delivered_at, cancelled_at) cannot be manually modified';
        END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_order_update ON public.orders;
CREATE TRIGGER trg_validate_order_update
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.validate_order_update();

-- ----------------------------------------------------------------------------
-- 7. TRANSACTIONAL ORDER WORKFLOW RPC FUNCTIONS
-- ----------------------------------------------------------------------------

-- 7.1. Confirm Order RPC (Pending -> Confirmed)
CREATE OR REPLACE FUNCTION public.confirm_order(p_order_id UUID)
RETURNS VOID 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_order RECORD;
BEGIN
    -- Explicit NULL-safe authentication and profile check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Must be logged in to confirm orders';
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: Profile or role not found for user %', auth.uid();
    END IF;

    IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'sales') THEN
        RAISE EXCEPTION 'Access denied: Staff with role "%" are not authorized to confirm orders', COALESCE(v_role, 'unknown');
    END IF;

    SELECT id, order_status INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id;
    END IF;

    IF v_order.order_status <> 'Pending' THEN
        RAISE EXCEPTION 'Only Pending orders can be confirmed. Current status: %', v_order.order_status;
    END IF;

    -- Concurrency-Safe Stock Reservation & Complete Allocation Check (Pending -> Confirmed)
    PERFORM public.check_order_allocations_availability(p_order_id);

    UPDATE public.orders 
    SET order_status = 'Confirmed',
        confirmed_at = now(),
        updated_at = now()
    WHERE id = p_order_id;
END;
$$;

-- 7.2. Dispatch Order RPC (Confirmed/Processing -> Dispatched)
CREATE OR REPLACE FUNCTION public.dispatch_order(
    p_order_id UUID, 
    p_delivery_staff_id UUID DEFAULT NULL, 
    p_notes TEXT DEFAULT NULL
)
RETURNS VOID 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_order RECORD;
    v_staff_role TEXT;
BEGIN
    -- Explicit NULL-safe authentication and profile check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Must be logged in to dispatch orders';
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: Profile or role not found for user %', auth.uid();
    END IF;

    IF v_role IS NULL OR v_role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'Access denied: Only owners and managers can dispatch orders';
    END IF;

    SELECT id, order_status, assigned_delivery_staff_id, notes 
    INTO v_order 
    FROM public.orders 
    WHERE id = p_order_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id;
    END IF;

    IF v_order.order_status NOT IN ('Confirmed', 'Processing') THEN
        RAISE EXCEPTION 'Order cannot be dispatched. Current status is % (must be Confirmed or Processing)', v_order.order_status;
    END IF;

    IF p_delivery_staff_id IS NOT NULL THEN
        SELECT role INTO v_staff_role FROM public.profiles WHERE id = p_delivery_staff_id;
        IF NOT FOUND OR v_staff_role IS NULL THEN
            RAISE EXCEPTION 'Delivery staff profile % not found', p_delivery_staff_id;
        END IF;
        IF v_staff_role <> 'delivery' THEN
            RAISE EXCEPTION 'User % has role "%" and cannot be assigned as delivery staff (must have role "delivery")',
                p_delivery_staff_id, v_staff_role;
        END IF;
    END IF;

    UPDATE public.orders 
    SET order_status = 'Dispatched',
        dispatched_at = now(),
        assigned_delivery_staff_id = COALESCE(p_delivery_staff_id, assigned_delivery_staff_id),
        notes = CASE WHEN p_notes IS NOT NULL THEN COALESCE(notes || E'\n', '') || p_notes ELSE notes END,
        updated_at = now()
    WHERE id = p_order_id;
END;
$$;

-- 7.3. Confirm Delivery RPC (Dispatched -> Delivered)
CREATE OR REPLACE FUNCTION public.confirm_order_delivery(p_order_id UUID, p_notes TEXT DEFAULT NULL)
RETURNS VOID 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_order RECORD;
BEGIN
    -- Explicit NULL-safe authentication and profile check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Must be logged in to confirm deliveries';
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: Profile or role not found for user %', auth.uid();
    END IF;
    
    IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'delivery') THEN
        RAISE EXCEPTION 'Access denied: You do not have permission to confirm deliveries';
    END IF;

    SELECT id, order_status, assigned_delivery_staff_id 
    INTO v_order 
    FROM public.orders 
    WHERE id = p_order_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id;
    END IF;

    IF v_role = 'delivery' AND (v_order.assigned_delivery_staff_id IS NULL OR v_order.assigned_delivery_staff_id <> auth.uid()) THEN
        RAISE EXCEPTION 'Access denied: You can only confirm delivery for orders assigned to you';
    END IF;

    IF v_order.order_status <> 'Dispatched' THEN
        RAISE EXCEPTION 'Order cannot be marked delivered. Current status is % (must be Dispatched)', v_order.order_status;
    END IF;

    UPDATE public.orders 
    SET order_status = 'Delivered',
        delivered_at = now(),
        notes = CASE WHEN p_notes IS NOT NULL THEN COALESCE(notes || E'\n', '') || p_notes ELSE notes END,
        updated_at = now()
    WHERE id = p_order_id;
END;
$$;

-- 7.4. Cancel Order RPC (Pending/Confirmed/Processing -> Cancelled)
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id UUID, p_reason TEXT)
RETURNS VOID 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_order RECORD;
BEGIN
    -- Explicit NULL-safe authentication and profile check
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Must be logged in to cancel orders';
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Access denied: Profile or role not found for user %', auth.uid();
    END IF;

    IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'sales') THEN
        RAISE EXCEPTION 'Access denied: Staff with role "%" are not authorized to cancel orders', COALESCE(v_role, 'unknown');
    END IF;

    SELECT id, order_status INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id;
    END IF;

    IF v_order.order_status IN ('Dispatched', 'Delivered') THEN
        RAISE EXCEPTION 'Cannot cancel order: Order has already been %', v_order.order_status;
    END IF;

    IF v_order.order_status = 'Cancelled' THEN
        RAISE EXCEPTION 'Order is already cancelled';
    END IF;

    UPDATE public.orders 
    SET order_status = 'Cancelled',
        cancelled_at = now(),
        cancelled_reason = p_reason,
        updated_at = now()
    WHERE id = p_order_id;
END;
$$;

-- 7.5. Secure Delivery Staff Access (Non-Financial RPCs & Views - Requirement 7)
CREATE OR REPLACE FUNCTION public.get_my_assigned_deliveries()
RETURNS TABLE (
    order_id UUID,
    order_number TEXT,
    order_status TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    delivery_address TEXT,
    notes TEXT,
    dispatched_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ
)
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Must be logged in';
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Profile or role not found for user %', auth.uid();
    END IF;

    IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'delivery') THEN
        RAISE EXCEPTION 'Access denied: Deliveries list is restricted to delivery staff, managers, and owners';
    END IF;

    RETURN QUERY
    SELECT 
        o.id AS order_id,
        o.order_number,
        o.order_status,
        o.customer_name,
        o.customer_phone,
        o.delivery_address,
        o.notes,
        o.dispatched_at,
        o.delivered_at
    FROM public.orders o
    WHERE (v_role IN ('owner', 'manager') OR o.assigned_delivery_staff_id = auth.uid())
      AND o.order_status IN ('Processing', 'Dispatched', 'Delivered');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_delivery_order_items(p_order_id UUID)
RETURNS TABLE (
    item_id UUID,
    order_id UUID,
    medicine_name TEXT,
    strength TEXT,
    dosage_form TEXT,
    quantity INTEGER
)
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_assigned UUID;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Must be logged in';
    END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'Profile or role not found for user %', auth.uid();
    END IF;

    IF v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'delivery') THEN
        RAISE EXCEPTION 'Access denied: Delivery order items restricted to delivery staff, managers, and owners';
    END IF;

    IF v_role = 'delivery' THEN
        SELECT assigned_delivery_staff_id INTO v_assigned
        FROM public.orders
        WHERE id = p_order_id;

        IF v_assigned IS NULL OR v_assigned <> auth.uid() THEN
            RAISE EXCEPTION 'Access denied: Order % is not assigned to you', p_order_id;
        END IF;
    END IF;

    RETURN QUERY
    SELECT 
        oi.id AS item_id,
        oi.order_id,
        oi.medicine_name,
        oi.strength,
        oi.dosage_form,
        oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id;
END;
$$;

-- Secure Views for Delivery Staff (Zero financial column exposure - Requirement 7)
CREATE OR REPLACE VIEW public.view_delivery_assigned_orders AS
SELECT 
    o.id AS order_id,
    o.order_number,
    o.order_status,
    o.customer_name,
    o.customer_phone,
    o.delivery_address,
    o.notes AS delivery_notes,
    o.dispatched_at,
    o.delivered_at,
    o.assigned_delivery_staff_id
FROM public.orders o
WHERE (
    (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'delivery')
     AND o.assigned_delivery_staff_id = auth.uid()
     AND o.order_status IN ('Processing', 'Dispatched', 'Delivered'))
    OR
    (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('owner', 'manager')))
);

CREATE OR REPLACE VIEW public.view_delivery_order_items AS
SELECT 
    oi.id AS item_id,
    oi.order_id,
    oi.medicine_name,
    oi.strength,
    oi.dosage_form,
    oi.quantity
FROM public.order_items oi
JOIN public.orders o ON oi.order_id = o.id
WHERE (
    (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'delivery')
     AND o.assigned_delivery_staff_id = auth.uid()
     AND o.order_status IN ('Processing', 'Dispatched', 'Delivered'))
    OR
    (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('owner', 'manager')))
);

-- ----------------------------------------------------------------------------
-- 8. SECURE FINANCIAL REPORTING VIEWS (security_invoker = true)
-- ----------------------------------------------------------------------------

-- View A: Order-Level Financials
CREATE OR REPLACE VIEW public.view_order_financials
WITH (security_invoker = true) AS
WITH payment_summary AS (
    SELECT 
        order_id,
        COALESCE(SUM(CASE WHEN payment_type = 'Collection' THEN amount 
                          WHEN payment_type = 'Reversal' THEN -amount 
                          ELSE 0.00 END), 0.00) AS net_collected
    FROM public.payments
    GROUP BY order_id
)
SELECT 
    o.id AS order_id,
    o.order_number,
    o.customer_id,
    o.customer_name,
    o.customer_phone,
    o.order_status,
    o.total_amount AS order_total,
    COALESCE(ps.net_collected, 0.00) AS net_collected,
    
    -- Payments on pending/confirmed/processing orders are advances held
    CASE 
        WHEN o.order_status IN ('Pending', 'Confirmed', 'Processing', 'Dispatched') 
             THEN GREATEST(0.00, COALESCE(ps.net_collected, 0.00))
        ELSE 0.00
    END AS advance_held,

    -- Payments on cancelled orders remain visible as refundable customer credit
    CASE 
        WHEN o.order_status = 'Cancelled' 
             THEN GREATEST(0.00, COALESCE(ps.net_collected, 0.00))
        ELSE 0.00
    END AS refundable_credit,

    -- Payments on delivered orders contribute to settlement of that specific order
    CASE 
        WHEN o.order_status = 'Delivered' 
             THEN GREATEST(0.00, o.total_amount - COALESCE(ps.net_collected, 0.00))
        ELSE 0.00
    END AS outstanding_due,

    -- Overpayments separately identified
    CASE 
        WHEN o.order_status = 'Delivered' 
             THEN GREATEST(0.00, COALESCE(ps.net_collected, 0.00) - o.total_amount)
        ELSE 0.00
    END AS overpayment_credit,

    -- Payment status badge
    CASE 
        WHEN o.order_status = 'Cancelled' THEN 'Cancelled'
        WHEN COALESCE(ps.net_collected, 0.00) >= o.total_amount AND o.total_amount > 0 THEN 'Paid'
        WHEN COALESCE(ps.net_collected, 0.00) > 0 THEN 'Partially Paid'
        ELSE 'Unpaid'
    END AS payment_status,

    o.delivered_at,
    o.created_at AS order_created_at
FROM public.orders o
LEFT JOIN payment_summary ps ON o.id = ps.order_id
WHERE EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'accountant')
);

-- View B: Customer-Level Balances
CREATE OR REPLACE VIEW public.view_customer_balances
WITH (security_invoker = true) AS
WITH cust_orders AS (
    SELECT 
        customer_id,
        COUNT(id) FILTER (WHERE order_status = 'Delivered') AS count_delivered_orders,
        COALESCE(SUM(total_amount) FILTER (WHERE order_status = 'Delivered'), 0.00) AS total_delivered_sales,
        COUNT(id) FILTER (WHERE order_status IN ('Pending', 'Confirmed', 'Processing', 'Dispatched')) AS count_pending_orders,
        COUNT(id) FILTER (WHERE order_status = 'Cancelled') AS count_cancelled_orders
    FROM public.orders
    GROUP BY customer_id
),
cust_payments AS (
    SELECT 
        customer_id,
        COALESCE(SUM(CASE WHEN payment_type = 'Collection' THEN amount 
                          WHEN payment_type = 'Reversal' THEN -amount 
                          ELSE 0.00 END), 0.00) AS total_net_payments
    FROM public.payments
    GROUP BY customer_id
),
order_dues AS (
    SELECT 
        customer_id,
        COALESCE(SUM(outstanding_due), 0.00) AS total_outstanding_due,
        COALESCE(SUM(advance_held), 0.00) AS total_advance_held,
        COALESCE(SUM(refundable_credit), 0.00) AS total_cancelled_credit,
        COALESCE(SUM(overpayment_credit), 0.00) AS total_overpayment_credit
    FROM public.view_order_financials
    GROUP BY customer_id
)
SELECT 
    c.id AS customer_id,
    c.name AS customer_name,
    c.phone AS customer_phone,
    c.delivery_address,
    COALESCE(co.count_delivered_orders, 0) AS total_delivered_orders,
    COALESCE(co.total_delivered_sales, 0.00) AS total_delivered_sales,
    COALESCE(cp.total_net_payments, 0.00) AS total_net_collections,
    COALESCE(od.total_outstanding_due, 0.00) AS total_outstanding_due,
    COALESCE(od.total_advance_held, 0.00) AS total_advance_held,
    COALESCE(od.total_cancelled_credit, 0.00) AS total_cancelled_credit,
    COALESCE(od.total_overpayment_credit, 0.00) AS total_overpayment_credit,
    (COALESCE(od.total_advance_held, 0.00) + 
     COALESCE(od.total_cancelled_credit, 0.00) + 
     COALESCE(od.total_overpayment_credit, 0.00)) AS total_customer_credit,
    -- Net position: positive = customer owes money; negative = customer in credit
    COALESCE(od.total_outstanding_due, 0.00) - 
    (COALESCE(od.total_advance_held, 0.00) + 
     COALESCE(od.total_cancelled_credit, 0.00) + 
     COALESCE(od.total_overpayment_credit, 0.00)) AS net_balance
FROM public.customers c
LEFT JOIN cust_orders co ON c.id = co.customer_id
LEFT JOIN cust_payments cp ON c.id = cp.customer_id
LEFT JOIN order_dues od ON c.id = od.customer_id
WHERE EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'accountant')
);

-- View C: Periodic Accounting KPIs (With Fixed Comma & Uninflated Collection Rate)
CREATE OR REPLACE VIEW public.view_accounting_kpis
WITH (security_invoker = true) AS
WITH sales_calc AS (
    SELECT 
        COALESCE(SUM(total_amount), 0.00) AS total_completed_sales
    FROM public.orders
    WHERE order_status = 'Delivered'
),
collections_calc AS (
    SELECT 
        -- Total net cash physically collected across all orders
        COALESCE(SUM(CASE WHEN payment_type = 'Collection' THEN amount 
                          WHEN payment_type = 'Reversal' THEN -amount 
                          ELSE 0.00 END), 0.00) AS total_net_collections
    FROM public.payments
),
dues_calc AS (
    SELECT 
        COALESCE(SUM(outstanding_due), 0.00) AS total_outstanding_dues,
        COALESCE(SUM(advance_held), 0.00) AS total_advances_held,
        COALESCE(SUM(refundable_credit), 0.00) AS total_refundable_cancelled_credit,
        COALESCE(SUM(overpayment_credit), 0.00) AS total_overpayment_credit
    FROM public.view_order_financials
),
delivered_collections_calc AS (
    SELECT 
        -- Collections specifically applied against delivered sales (capped at order total to prevent overpayment inflation)
        COALESCE(SUM(LEAST(order_total, GREATEST(0.00, net_collected))), 0.00) AS collections_on_delivered_sales
    FROM public.view_order_financials
    WHERE order_status = 'Delivered'
)
SELECT 
    s.total_completed_sales,
    c.total_net_collections,
    d.total_outstanding_dues,
    d.total_advances_held,
    d.total_refundable_cancelled_credit,
    d.total_overpayment_credit,
    -- Accurate collection rate: compares cash collected against delivered sales to total delivered sales
    -- Advances on undelivered orders and refundable cancelled credits do NOT inflate this percentage
    CASE 
        WHEN s.total_completed_sales > 0 
        THEN ROUND((dc.collections_on_delivered_sales / s.total_completed_sales) * 100, 2)
        ELSE 0.00
    END AS collection_rate_percentage
FROM sales_calc s, collections_calc c, dues_calc d, delivered_collections_calc dc
WHERE EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'accountant')
);

-- ----------------------------------------------------------------------------
-- 9. SECURE FINANCIAL REPORTING RPC FUNCTIONS (Access Gated to Owner/Manager/Accountant)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_accounting_kpis()
RETURNS TABLE (
    total_completed_sales NUMERIC(12,2),
    total_net_collections NUMERIC(12,2),
    total_outstanding_dues NUMERIC(12,2),
    total_advances_held NUMERIC(12,2),
    total_refundable_cancelled_credit NUMERIC(12,2),
    total_overpayment_credit NUMERIC(12,2),
    collection_rate_percentage NUMERIC(5,2)
) 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Must be logged in';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() 
          AND profiles.role IN ('owner', 'manager', 'accountant')
    ) THEN
        RAISE EXCEPTION 'Access denied: Accounting KPIs restricted to owner, manager, and accountant';
    END IF;

    RETURN QUERY SELECT * FROM public.view_accounting_kpis;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_balances()
RETURNS SETOF public.view_customer_balances 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Must be logged in';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() 
          AND profiles.role IN ('owner', 'manager', 'accountant')
    ) THEN
        RAISE EXCEPTION 'Access denied: Customer balances restricted to owner, manager, and accountant';
    END IF;

    RETURN QUERY SELECT * FROM public.view_customer_balances;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_order_financials()
RETURNS SETOF public.view_order_financials 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required: Must be logged in';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() 
          AND profiles.role IN ('owner', 'manager', 'accountant')
    ) THEN
        RAISE EXCEPTION 'Access denied: Order financials restricted to owner, manager, and accountant';
    END IF;

    RETURN QUERY SELECT * FROM public.view_order_financials;
END;
$$;

-- ----------------------------------------------------------------------------
-- 10. SECURITY & ACCESS REVOCATIONS (Revoke all from PUBLIC and anon)
-- ----------------------------------------------------------------------------

-- Explicitly revoke all privileges from PUBLIC and anon
REVOKE ALL ON public.customers FROM PUBLIC, anon;
REVOKE ALL ON public.orders FROM PUBLIC, anon;
REVOKE ALL ON public.order_items FROM PUBLIC, anon;
REVOKE ALL ON public.order_batch_allocations FROM PUBLIC, anon;
REVOKE ALL ON public.payments FROM PUBLIC, anon;
REVOKE ALL ON public.view_order_financials FROM PUBLIC, anon;
REVOKE ALL ON public.view_customer_balances FROM PUBLIC, anon;
REVOKE ALL ON public.view_accounting_kpis FROM PUBLIC, anon;
REVOKE ALL ON public.view_delivery_assigned_orders FROM PUBLIC, anon;
REVOKE ALL ON public.view_delivery_order_items FROM PUBLIC, anon;

-- Enable RLS on all accounting tables
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_batch_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Revoke all table-level privileges on orders and order_items from authenticated (Requirement 4)
-- This eliminates table-level SELECT on orders and order_items for authenticated clients!
REVOKE ALL ON public.orders FROM authenticated;
REVOKE ALL ON public.order_items FROM authenticated;

-- Grant table modification privileges to authenticated
GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
GRANT INSERT, UPDATE ON public.orders TO authenticated;
GRANT INSERT, DELETE ON public.order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_batch_allocations TO authenticated;
GRANT SELECT, INSERT ON public.payments TO authenticated;

-- Column-level SELECT on orders (CRITICAL: EXCLUDES financial columns: subtotal, discount, delivery_charge, total_amount)
-- Prevents delivery staff and non-financial staff from accessing financial fields directly via orders table (Requirement 4)
GRANT SELECT (
    id,
    order_number,
    customer_id,
    customer_name,
    customer_phone,
    delivery_address,
    assigned_delivery_staff_id,
    order_status,
    notes,
    cancelled_reason,
    confirmed_at,
    dispatched_at,
    delivered_at,
    cancelled_at,
    created_at,
    updated_at
) ON public.orders TO authenticated;

-- Column-level SELECT on order_items (CRITICAL: EXCLUDES financial columns: unit_price, total_price)
-- Prevents delivery staff and non-financial staff from accessing pricing fields directly via order_items table (Requirement 4)
GRANT SELECT (
    id,
    order_id,
    medicine_id,
    medicine_name,
    strength,
    dosage_form,
    quantity,
    created_at
) ON public.order_items TO authenticated;

-- Reporting views access: Revoke from authenticated as well (Requirement 2 & 4)
-- Reporting views and KPIs are restricted to owner, manager, accountant via get_order_financials(), get_customer_balances(), get_accounting_kpis()
REVOKE ALL ON public.view_order_financials FROM authenticated;
REVOKE ALL ON public.view_customer_balances FROM authenticated;
REVOKE ALL ON public.view_accounting_kpis FROM authenticated;

-- Grant non-financial delivery views to authenticated (Requirement 7)
GRANT SELECT ON public.view_delivery_assigned_orders TO authenticated;
GRANT SELECT ON public.view_delivery_order_items TO authenticated;

-- Explicitly revoke function execution privileges from PUBLIC and anon
REVOKE ALL ON FUNCTION public.confirm_order_delivery(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_order(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dispatch_order(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_order(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_accounting_kpis() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_customer_balances() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_order_financials() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_assigned_deliveries() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_delivery_order_items(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalize_phone(TEXT) FROM PUBLIC, anon;

-- CRITICAL: Internal stock helpers revoked from PUBLIC, anon, AND authenticated (Requirement 1)
-- Only trusted internal SECURITY DEFINER triggers and workflows can invoke these helpers!
REVOKE ALL ON FUNCTION public.check_order_allocations_availability(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_order_dispatch_stock_deduction(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Grant secure RPC functions to authenticated (functions enforce internal role verification)
GRANT EXECUTE ON FUNCTION public.confirm_order_delivery(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_order(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_accounting_kpis() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_order_financials() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_assigned_deliveries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_delivery_order_items(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_phone(TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 11. REPEATABLE RLS POLICIES (Role-Specific Matrix & Delivery Gating)
-- ----------------------------------------------------------------------------

-- Drop only policies owned by this migration. Never remove unrelated application policies.
DROP POLICY IF EXISTS "Staff view customers" ON public.customers;
DROP POLICY IF EXISTS "Delivery staff view assigned customers" ON public.customers;
DROP POLICY IF EXISTS "Staff insert customers" ON public.customers;
DROP POLICY IF EXISTS "Staff update customers" ON public.customers;

DROP POLICY IF EXISTS "Staff view orders" ON public.orders;
DROP POLICY IF EXISTS "Delivery staff view assigned orders" ON public.orders;
DROP POLICY IF EXISTS "Staff insert orders" ON public.orders;
DROP POLICY IF EXISTS "Staff update orders" ON public.orders;
DROP POLICY IF EXISTS "Delivery staff update assigned orders" ON public.orders;

DROP POLICY IF EXISTS "Staff view order items" ON public.order_items;
DROP POLICY IF EXISTS "Delivery staff view assigned order items" ON public.order_items;
DROP POLICY IF EXISTS "Staff insert order items" ON public.order_items;
DROP POLICY IF EXISTS "Staff delete order items" ON public.order_items;

DROP POLICY IF EXISTS "Staff view batch allocations" ON public.order_batch_allocations;
DROP POLICY IF EXISTS "Staff manage batch allocations" ON public.order_batch_allocations;

DROP POLICY IF EXISTS "Staff view payments" ON public.payments;
DROP POLICY IF EXISTS "Staff insert payments" ON public.payments;

-- 11.1. CUSTOMERS POLICIES
-- Non-delivery staff can view all customers
CREATE POLICY "Staff view customers" ON public.customers FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'accountant', 'sales', 'inventory_manager')
));

-- Delivery staff can ONLY view customers of orders assigned to them for active delivery
CREATE POLICY "Delivery staff view assigned customers" ON public.customers FOR SELECT TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'delivery')
    AND EXISTS (
        SELECT 1 FROM public.orders 
        WHERE orders.customer_id = customers.id 
          AND orders.assigned_delivery_staff_id = auth.uid()
          AND orders.order_status IN ('Processing', 'Dispatched')
    )
);

CREATE POLICY "Staff insert customers" ON public.customers FOR INSERT TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'sales')
));

CREATE POLICY "Staff update customers" ON public.customers FOR UPDATE TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'sales')
));

-- 11.2. ORDERS POLICIES
-- Staff view orders policy for operational management
CREATE POLICY "Staff view orders" ON public.orders FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'accountant', 'sales', 'inventory_manager')
));

-- Delivery staff can only view orders assigned to them for active deliveries (only permitted non-financial columns are select-grantable)
CREATE POLICY "Delivery staff view assigned orders" ON public.orders FOR SELECT TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'delivery')
    AND orders.assigned_delivery_staff_id = auth.uid()
    AND orders.order_status IN ('Processing', 'Dispatched', 'Delivered')
);

CREATE POLICY "Staff insert orders" ON public.orders FOR INSERT TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'sales')
));

-- General staff order management
CREATE POLICY "Staff update orders" ON public.orders FOR UPDATE TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'sales')
));

-- Delivery staff can only update their assigned orders (trigger validate_order_update restricts columns)
CREATE POLICY "Delivery staff update assigned orders" ON public.orders FOR UPDATE TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'delivery')
    AND orders.assigned_delivery_staff_id = auth.uid()
);

-- 11.3. ORDER ITEMS POLICIES
CREATE POLICY "Staff view order items" ON public.order_items FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'accountant', 'sales', 'inventory_manager')
));

-- Delivery staff can only view item names and quantities of their assigned orders (no unit_price or total_price)
CREATE POLICY "Delivery staff view assigned order items" ON public.order_items FOR SELECT TO authenticated
USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'delivery')
    AND EXISTS (
        SELECT 1 FROM public.orders 
        WHERE orders.id = order_items.order_id 
          AND orders.assigned_delivery_staff_id = auth.uid() 
          AND orders.order_status IN ('Processing', 'Dispatched', 'Delivered')
    )
);

CREATE POLICY "Staff insert order items" ON public.order_items FOR INSERT TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'sales')
));

-- Staff can only delete items from orders that are still Pending
CREATE POLICY "Staff delete order items" ON public.order_items FOR DELETE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE profiles.id = auth.uid() 
          AND profiles.role IN ('owner', 'manager', 'sales')
    )
    AND EXISTS (
        SELECT 1 FROM public.orders 
        WHERE orders.id = order_items.order_id 
          AND orders.order_status = 'Pending'
    )
);

-- Note: NO UPDATE POLICY on order_items. Historical prices and quantities are immutable once inserted!

-- 11.4. ORDER BATCH ALLOCATIONS POLICIES
CREATE POLICY "Staff view batch allocations" ON public.order_batch_allocations FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'inventory_manager', 'accountant')
));

CREATE POLICY "Staff manage batch allocations" ON public.order_batch_allocations FOR ALL TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'inventory_manager')
));

-- 11.5. PAYMENTS POLICIES (STRICT FINANCIAL ENCLOSURE)
-- Delivery staff and inventory staff have zero access to payments
CREATE POLICY "Staff view payments" ON public.payments FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'accountant')
));

CREATE POLICY "Staff insert payments" ON public.payments FOR INSERT TO authenticated
WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('owner', 'manager', 'accountant')
));

-- Payments table has NO UPDATE and NO DELETE policies: Payment history is strictly immutable.

COMMIT;
