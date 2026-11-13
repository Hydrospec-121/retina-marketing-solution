"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Customer = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  opening_balance: number;
  notes: string | null;
  is_active: boolean;
};

type Medicine = {
  id: string;
  name: string;
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  category: string | null;
  selling_price: number;
  stock_quantity: number;
  min_stock_level: number | null;
  requires_prescription: boolean;
  is_active: boolean;
};

type InvoiceLine = { medicine: Medicine; quantity: number };

const money = (amount: number) =>
  `\u09F3 ${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SalesPage() {
  const router = useRouter();
  const isSubmittingRef = useRef(false);
  const customerResultsRef = useRef<HTMLDivElement>(null);
  const [accessState, setAccessState] = useState<"checking" | "allowed" | "denied">("checking");
  const [accessMessage, setAccessMessage] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [walkInCustomer, setWalkInCustomer] = useState(false);
  const [manualCustomerName, setManualCustomerName] = useState("");
  const [medicineSearch, setMedicineSearch] = useState("");
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([]);
  const [removingMedicineId, setRemovingMedicineId] = useState("");
  const [discount, setDiscount] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");
  const [invoiceSuccess, setInvoiceSuccess] = useState("");
  const selectedCustomer = customers.find((customer) => customer.id === customerId) ?? null;
  const matchingCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return customers.slice(0, 8);
    return customers.filter((customer) =>
      `${customer.name} ${customer.contact_person ?? ""} ${customer.phone ?? ""}`.toLowerCase().includes(term)
    ).slice(0, 8);
  }, [customers, customerSearch]);
  const matchingMedicines = useMemo(() => {
    const term = medicineSearch.trim().toLowerCase();
    if (!term) return [];
    return medicines.filter((medicine) =>
      `${medicine.name} ${medicine.generic_name ?? ""} ${medicine.strength ?? ""}`
        .toLowerCase().includes(term)
    ).slice(0, 8);
  }, [medicines, medicineSearch]);
  const subtotal = invoiceLines.reduce((sum, line) => sum + Number(line.medicine.selling_price) * line.quantity, 0);
  const enteredDiscount = discount.trim() === "" ? 0 : Number(discount);
  const discountIsValid = Number.isFinite(enteredDiscount) && enteredDiscount >= 0 && enteredDiscount <= subtotal;
  const grandTotal = Math.max(0, subtotal - (Number.isFinite(enteredDiscount) ? enteredDiscount : 0));
  const received = Math.max(0, Number(amountReceived) || 0);
  const paymentIsValid = amountReceived.trim() === "" || (Number.isFinite(Number(amountReceived)) && Number(amountReceived) >= 0 && Number(amountReceived) <= grandTotal);
  const remaining = useMemo(() => Math.max(0, grandTotal - received), [grandTotal, received]);

  useEffect(() => {
    let active = true;
    let passedRoleCheck = false;

    async function checkAccessAndLoad() {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError || !session?.user) {
        router.replace("/login");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();
      if (!active) return;
      if (profileError) {
        setAccessMessage(`Unable to verify your access: ${profileError.message}`);
        setAccessState("denied");
        return;
      }
      if (profile?.role !== "owner" && profile?.role !== "manager") {
        setAccessMessage("Access denied. This page is available to owners and managers only.");
        setAccessState("denied");
        return;
      }

      setAccessState("allowed");
      passedRoleCheck = true;
      setDataLoading(true);
      const [customerResult, medicineResult] = await Promise.all([
        supabase
          .from("customers")
          .select("id,name,contact_person,phone,address,opening_balance,notes,is_active")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        supabase
          .from("medicines")
          .select("id,name,generic_name,strength,dosage_form,pack_size,category,stock_quantity,selling_price,min_stock_level,requires_prescription,is_active")
          .eq("is_active", true)
          .order("name", { ascending: true }),
      ]);

      if (!active) return;
      const errors: string[] = [];
      if (customerResult.error) errors.push(`Customers: ${customerResult.error.message}`);
      else setCustomers((customerResult.data ?? []) as Customer[]);
      if (medicineResult.error) errors.push(`Medicines: ${medicineResult.error.message}`);
      else setMedicines((medicineResult.data ?? []) as Medicine[]);
      setDataError(errors.join(" "));
      setDataLoading(false);
    }

    checkAccessAndLoad().catch((loadError: unknown) => {
      if (!active) return;
      const message = loadError instanceof Error ? loadError.message : "Unexpected error.";
      if (!passedRoleCheck) {
        setAccessMessage(`Unable to verify access: ${message}`);
        setAccessState("denied");
        return;
      }
      setDataError(`Unable to load sales data: ${message}`);
      setDataLoading(false);
    });

    return () => { active = false; };
  }, [router]);

  function addMedicine(medicine: Medicine) {
    setInvoiceLines((current) => {
      const existing = current.find((line) => line.medicine.id === medicine.id);
      if (existing) {
        if (existing.quantity >= Number(medicine.stock_quantity || 0)) return current;
        return current.map((line) => line.medicine.id === medicine.id ? { ...line, quantity: line.quantity + 1 } : line);
      }
      if (Number(medicine.stock_quantity || 0) < 1) return current;
      return [...current, { medicine, quantity: 1 }];
    });
    setMedicineSearch("");
  }

  function focusCustomerOption(direction: 1 | -1 = 1) {
    const options = Array.from(customerResultsRef.current?.querySelectorAll<HTMLButtonElement>("button[role=option]") ?? []);
    if (options.length) options[direction > 0 ? 0 : options.length - 1].focus();
  }

  function moveCustomerOption(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = Array.from(customerResultsRef.current?.querySelectorAll<HTMLButtonElement>("button[role=option]") ?? []);
    const index = options.indexOf(event.currentTarget);
    const next = (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
  }

  function updateQuantity(medicineId: string, quantity: number) {
    const line = invoiceLines.find((item) => item.medicine.id === medicineId);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > Number(line?.medicine.stock_quantity ?? 0)) return;
    setInvoiceLines((current) => current.map((line) => line.medicine.id === medicineId ? { ...line, quantity } : line));
  }

  function removeMedicine(medicineId: string) {
    if (removingMedicineId) return;
    setRemovingMedicineId(medicineId);
    window.setTimeout(() => {
      setInvoiceLines((current) => current.filter((line) => line.medicine.id !== medicineId));
      setRemovingMedicineId("");
    }, 180);
  }

  function invoiceRpcErrorMessage(error: { code?: string; message?: string }) {
    const detail = (error.message ?? "").toLowerCase();
    if (detail.includes("insufficient stock")) {
      return "There is not enough total stock for one or more medicines. Reduce the quantities or contact the inventory manager.";
    }
    if (detail.includes("select an active customer")) {
      return "This customer is no longer active. Refresh the page and select an active customer.";
    }
    if (detail.includes("selected medicine is unavailable")) {
      return "One of the selected medicines is no longer active. Refresh the page and update the invoice.";
    }
    if (error.code === "23505" || detail.includes("duplicate key") || detail.includes("unique constraint")) {
      return "This invoice number is already in use. Please contact support before retrying this invoice.";
    }
    if (detail.includes("authentication required")) {
      return "Your session has expired. Sign in again before creating the invoice.";
    }
    if (detail.includes("not authorized")) {
      return "Your account is not authorized to create invoices.";
    }
    return "The invoice could not be created. Check your connection and access, then try again. Your draft has been kept.";
  }

  async function createInvoice() {
    if (isSubmittingRef.current || removingMedicineId) return;
    setInvoiceError("");
    setInvoiceSuccess("");

    const enteredCustomerName = manualCustomerName.trim();
    if (walkInCustomer ? !enteredCustomerName : (!customerId || !selectedCustomer)) {
      setInvoiceError(walkInCustomer ? "Enter a customer name before creating the invoice." : "Select an active customer before creating the invoice.");
      return;
    }
    if (invoiceLines.length === 0) {
      setInvoiceError("Add at least one medicine to the invoice.");
      return;
    }
    if (invoiceLines.some((line) => !Number.isInteger(line.quantity) || line.quantity <= 0)) {
      setInvoiceError("Every medicine quantity must be a positive whole number.");
      return;
    }

    const discountValue = discount.trim() === "" ? 0 : Number(discount);
    if (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > subtotal) {
      setInvoiceError("Discount must be zero or more and cannot exceed the invoice subtotal.");
      return;
    }

    const paymentValue = amountReceived.trim() === "" ? 0 : Number(amountReceived);
    const finalTotal = subtotal - discountValue;
    if (!Number.isFinite(paymentValue) || paymentValue < 0 || paymentValue > finalTotal) {
      setInvoiceError("Initial payment must be zero or more and cannot exceed the invoice total.");
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const medicineIds = invoiceLines.map((line) => line.medicine.id);
      const { data: latestMedicineData, error: priceRefreshError } = await supabase
        .from("medicines")
        .select("id,selling_price,stock_quantity,is_active")
        .in("id", medicineIds);

      if (priceRefreshError) {
        setInvoiceError("Could not refresh current medicine prices. Your draft was kept and no invoice was submitted. Please try again.");
        return;
      }

      const latestMedicines = new Map(
        (latestMedicineData ?? []).map((medicine) => [medicine.id, medicine])
      );
      const missingMedicine = medicineIds.some((id) => !latestMedicines.has(id));
      const inactiveMedicine = medicineIds.some((id) => latestMedicines.get(id)?.is_active !== true);
      if (missingMedicine || inactiveMedicine) {
        setInvoiceError("A medicine in this draft is no longer available or active. Your draft was kept and no invoice was submitted. Refresh the page and review the medicines.");
        return;
      }

      const insufficient = invoiceLines.find((line) => line.quantity > Number(latestMedicines.get(line.medicine.id)?.stock_quantity ?? 0));
      if (insufficient) {
        setInvoiceError(`Only ${Number(latestMedicines.get(insufficient.medicine.id)?.stock_quantity ?? 0)} total units of ${insufficient.medicine.name} are currently available. Your draft was kept.`);
        return;
      }

      const refreshedLines = invoiceLines.map((line) => ({
        ...line,
        medicine: {
          ...line.medicine,
          selling_price: Number(latestMedicines.get(line.medicine.id)!.selling_price),
          stock_quantity: Number(latestMedicines.get(line.medicine.id)!.stock_quantity),
        },
      }));
      const pricesChanged = refreshedLines.some((line, index) =>
        Number(line.medicine.selling_price) !== Number(invoiceLines[index].medicine.selling_price)
      );

      if (pricesChanged) {
        setInvoiceLines(refreshedLines);
        setMedicines((current) => current.map((medicine) => {
          const refreshed = latestMedicines.get(medicine.id);
          return refreshed ? { ...medicine, selling_price: Number(refreshed.selling_price) } : medicine;
        }));
        setInvoiceError("Medicine prices changed. The draft has been updated with current prices. Review the new totals, then submit again.");
        return;
      }

      const invoiceArguments = {
        p_customer_id: walkInCustomer ? null : customerId,
        p_items: invoiceLines.map((line) => ({
          medicine_id: line.medicine.id,
          quantity: line.quantity,
        })),
        p_discount: discountValue,
        p_initial_payment: paymentValue,
        p_payment_method: paymentMethod,
        p_payment_reference: paymentReference.trim() || null,
        p_notes: notes.trim() || null,
        ...(walkInCustomer ? { p_customer_name: enteredCustomerName } : {}),
      };
      const { data, error } = await supabase.rpc("create_sales_invoice", invoiceArguments);

      if (error) {
        setInvoiceError(invoiceRpcErrorMessage(error));
        return;
      }
      if (typeof data !== "string" || data.length === 0) {
        setInvoiceError("The database did not confirm invoice creation. Your draft has been kept.");
        return;
      }

      const invoiceId = data;
      const { data: createdInvoice, error: invoiceLookupError } = await supabase
        .from("invoices")
        .select("invoice_number")
        .eq("id", invoiceId)
        .single();

      if (invoiceLookupError || !createdInvoice?.invoice_number) {
        setInvoiceSuccess(`The invoice was created, but its display number could not be retrieved. Invoice ID: ${invoiceId}`);
      } else {
        setInvoiceSuccess(`Invoice ${createdInvoice.invoice_number} was created successfully.`);
      }
      setCustomerId("");
      setCustomerSearch("");
      setWalkInCustomer(false);
      setManualCustomerName("");
      setInvoiceLines([]);
      setDiscount("");
      setAmountReceived("");
      setPaymentMethod("cash");
      setPaymentReference("");
      setNotes("");
      setMedicineSearch("");
    } catch {
      setInvoiceError("The invoice request could not be confirmed. Your draft has been kept. Ask a manager to verify whether it was saved before retrying.");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  if (accessState === "checking") {
    return <main className="sales-access-state"><p>Checking access...</p><style jsx global>{`.sales-access-state{min-height:100vh;display:grid;place-items:center;background:#f5f8f6;color:#103d3c;font:600 15px Arial,sans-serif}`}</style></main>;
  }

  if (accessState === "denied") {
    return <main className="sales-access-state"><section><h1>Access denied</h1><p>{accessMessage}</p><Link href="/admin">Return to dashboard</Link></section><style jsx global>{`.sales-access-state{min-height:100vh;display:grid;place-items:center;padding:20px;background:#f5f8f6;color:#103d3c;font:14px Arial,sans-serif}.sales-access-state section{max-width:460px;padding:28px;background:#fff;border:1.5px solid #111817;box-shadow:4px 4px 0 #111817}.sales-access-state h1{margin-top:0}.sales-access-state p{color:#66736f;line-height:1.6}.sales-access-state a{color:#168c83;font-weight:700}`}</style></main>;
  }

  return (
    <main className="sales-admin-layout">
      <aside className="sales-sidebar">
        <Link className="sales-brand" href="/">
          <span className="sales-brand-mark">R</span>
          <span>RETINA<small>BUSINESS HUB</small></span>
        </Link>
        <div className="sales-nav-label">WORKSPACE</div>
        <nav className="sales-nav">
          <Link href="/admin">▦ &nbsp; Overview</Link>
          <Link href="/admin/orders">▤ &nbsp; Orders</Link>
          <Link href="/admin/medicines">＋ &nbsp; Medicines</Link>
          <Link href="/admin/inventory">▥ &nbsp; Inventory</Link>
          <Link className="sales-nav-active" href="/admin/sales">৳ &nbsp; Sales &amp; accounts</Link>
          <Link className="sales-nav-history" href="/admin/sales/overview">- &nbsp; Sales Overview</Link>
          <Link className="sales-nav-history" href="/admin/sales/history">- &nbsp; Sales History</Link>
          <Link href="/admin/customers">♙ &nbsp; Customers</Link>
        </nav>
        <div className="sales-sidebar-bottom">
          <span>OWNER DASHBOARD</span>
          <Link href="/">← Back to website</Link>
        </div>
      </aside>

      <section className="sales-main">
        <header className="sales-topbar">
          <span>RETINA / SALES &amp; ACCOUNTS</span>
          <span className="sales-workspace-tag">INVOICE WORKSPACE</span>
        </header>

        <div className="sales-content">
          <div className="sales-heading">
            <div>
              <div className="sales-eyebrow">SALES MANAGEMENT</div>
              <h1>Create <em>Invoice</em></h1>
              <p>Prepare a customer invoice and review the totals before saving.</p>
            </div>
            <span className="sales-draft-tag">NEW INVOICE</span>
          </div>

          {dataError && <div className="sales-data-error" role="alert">Could not fully load live sales data: {dataError}</div>}
          {invoiceSuccess && <div className="sales-invoice-success" role="status">{invoiceSuccess}</div>}
          {invoiceError && <div className="sales-data-error" role="alert">{invoiceError}</div>}

          <section className="sales-panel sales-enter">
            <div className="sales-section-heading"><span className="sales-step">01</span><div><h2>Customer</h2><p>Select the pharmacy or business for this invoice.</p></div></div>
            <label className="sales-walkin-toggle"><input type="checkbox" checked={walkInCustomer} onChange={(event) => { setWalkInCustomer(event.target.checked); setCustomerPickerOpen(false); setInvoiceError(""); }} /> Create a walk-in invoice</label>
            {walkInCustomer ? <label className="sales-field sales-customer-select">Customer name<input required maxLength={150} value={manualCustomerName} onChange={(event) => setManualCustomerName(event.target.value)} placeholder="Enter customer or pharmacy name" /></label> : <div className="sales-customer-picker">
              <label className="sales-field sales-customer-select" htmlFor="customer-search">Search customers<input id="customer-search" role="combobox" aria-expanded={customerPickerOpen} aria-controls="customer-results" aria-autocomplete="list" autoComplete="off" value={customerSearch} disabled={dataLoading || customers.length === 0} onKeyDown={(event) => { if (event.key === "ArrowDown" && customerPickerOpen) { event.preventDefault(); focusCustomerOption(); } else if (event.key === "Escape") setCustomerPickerOpen(false); }} onFocus={() => setCustomerPickerOpen(true)} onChange={(event) => { setCustomerSearch(event.target.value); setCustomerPickerOpen(true); }} placeholder={dataLoading ? "Loading customers..." : customers.length ? "Search by business, contact, or phone" : "No active customers available"} /></label>
              {customerPickerOpen && !dataLoading && <div ref={customerResultsRef} className="sales-customer-results" id="customer-results" role="listbox" aria-label="Customer search results">
                {matchingCustomers.length ? matchingCustomers.map((customer) => <button type="button" role="option" aria-selected={customer.id === customerId} key={customer.id} onKeyDown={moveCustomerOption} onClick={() => { setCustomerId(customer.id); setCustomerSearch(customer.name); setCustomerPickerOpen(false); setInvoiceError(""); }}><strong>{customer.name}</strong><span>{[customer.contact_person, customer.phone].filter(Boolean).join(" · ") || "No contact details"}</span></button>) : <p>No matching active customers.</p>}
              </div>}
              {selectedCustomer && <button className="sales-change-customer" type="button" onClick={() => { setCustomerId(""); setCustomerSearch(""); setCustomerPickerOpen(true); }}>Change customer</button>}
            </div>}
            {!walkInCustomer && <div className="sales-empty-customer">
              <span className="sales-empty-icon">♙</span>
              <div>{selectedCustomer ? <><strong>{selectedCustomer.name}</strong><p>{selectedCustomer.contact_person || "No contact person"}{selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ""}</p><p>{selectedCustomer.address || "No address on file"}</p><p>Opening balance: {money(Number(selectedCustomer.opening_balance) || 0)}</p></> : <><strong>{dataLoading ? "Loading active customers..." : customers.length === 0 ? "No active customers found" : "No customer selected"}</strong><p>{customers.length ? "Select a customer to see their contact details and address." : "Active customer records will appear in the selector when available."}</p></>}</div>
            </div>}
          </section>

          <section className="sales-panel sales-enter sales-enter-delay">
            <div className="sales-section-heading"><span className="sales-step">02</span><div><h2>Medicines</h2><p>Search and add the items for this invoice.</p></div></div>
            <div className="sales-search-wrap"><span aria-hidden="true">⌕</span><input disabled={dataLoading || medicines.length === 0} value={medicineSearch} onChange={(event) => setMedicineSearch(event.target.value)} aria-label="Search medicines" placeholder={dataLoading ? "Loading active medicines..." : medicines.length ? "Search by medicine, generic name, or strength" : "No active medicines available"} /></div>
            {medicineSearch.trim() && <div className="sales-medicine-results" role="listbox" aria-label="Medicine search results">
              {matchingMedicines.length ? matchingMedicines.map((medicine) => { const addedLine = invoiceLines.find((line) => line.medicine.id === medicine.id); const available = Number(medicine.stock_quantity || 0); const cannotAdd = available < 1 || (addedLine?.quantity ?? 0) >= available; return <button type="button" role="option" aria-selected={Boolean(addedLine)} disabled={cannotAdd} key={medicine.id} onClick={() => addMedicine(medicine)}><span><strong>{medicine.name}</strong><small>{[medicine.generic_name, medicine.strength, medicine.dosage_form].filter(Boolean).join(" · ") || medicine.dosage_form || "Medicine"} · {available.toLocaleString("en-BD")} units in stock</small></span><span>{money(Number(medicine.selling_price) || 0)} <b>{available < 1 ? "Out of stock" : cannotAdd ? "Max added" : "+ Add"}</b></span></button>; }) : <p>{medicines.length ? "No matching medicines found." : "No active medicines found."}</p>}
            </div>}
            {invoiceLines.length === 0 ? <div className="sales-empty-items"><span>＋</span><strong>No medicines added</strong><p>Search for a medicine above to start building this invoice.</p></div> : <div className="sales-items-list" aria-label="Invoice items">{invoiceLines.map((line) => <article className={`sales-item-card${removingMedicineId === line.medicine.id ? " is-removing" : ""}`} key={line.medicine.id}>
              <div className="sales-line-medicine"><span><strong>{line.medicine.name}</strong><small>{[line.medicine.generic_name, line.medicine.strength, line.medicine.dosage_form].filter(Boolean).join(" · ") || "Medicine"} · {Number(line.medicine.stock_quantity || 0).toLocaleString("en-BD")} available</small></span><button className="sales-remove-button" type="button" disabled={Boolean(removingMedicineId)} aria-label={`Remove ${line.medicine.name}`} onClick={() => removeMedicine(line.medicine.id)}>Remove</button></div>
              <div className="sales-item-data"><span>Unit price<strong>{money(Number(line.medicine.selling_price) || 0)}</strong></span><label>Quantity<input className="sales-quantity-input" type="number" min="1" max={line.medicine.stock_quantity} step="1" value={line.quantity} aria-label={`Quantity for ${line.medicine.name}`} onChange={(event) => updateQuantity(line.medicine.id, Number(event.target.value))} /></label><span className="sales-line-total">Line total<strong key={(Number(line.medicine.selling_price) * line.quantity).toFixed(2)}>{money((Number(line.medicine.selling_price) || 0) * line.quantity)}</strong></span></div>
            </article>)}</div>}
          </section>

          <div className="sales-lower-grid">
            <section className="sales-panel sales-payment-panel sales-enter sales-enter-late">
              <div className="sales-section-heading"><span className="sales-step">03</span><div><h2>Payment details</h2><p>Record the amount received now. Any balance remains due.</p></div></div>
              <div className="sales-form-grid">
                <label className="sales-field">Amount received (৳)<input type="number" min="0" max={grandTotal} step="0.01" inputMode="decimal" value={amountReceived} aria-invalid={!paymentIsValid} onChange={(event) => setAmountReceived(event.target.value)} placeholder="0.00" />{!paymentIsValid && <span className="sales-input-error">Payment cannot exceed the invoice total.</span>}</label>
                <label className="sales-field">Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="bank_transfer">Bank Transfer</option><option value="mobile_banking">Mobile Banking</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
                <label className="sales-field sales-full-width">Payment reference<input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Optional transaction or cheque reference" /></label>
              </div>
              <label className="sales-field sales-notes-field">Notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add any notes for this invoice" /></label>
            </section>

            <aside className="sales-summary-panel">
              <div className="sales-summary-top"><div><div className="sales-eyebrow">PAYMENT SUMMARY</div><h2>Invoice total</h2></div><span className={`sales-payment-status ${!paymentIsValid ? "is-due" : remaining > 0 ? "is-due" : "is-paid"}`}>{!paymentIsValid ? "Check payment" : remaining > 0 ? (received > 0 ? "Partially paid" : "Due") : "Fully paid"}</span></div>
              <div className="sales-summary-row"><span>Subtotal</span><strong key={subtotal.toFixed(2)}>{money(subtotal)}</strong></div>
              <label className={`sales-summary-discount${discountIsValid ? "" : " sales-discount-invalid"}`}>Discount (৳)<input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} placeholder="0.00" aria-invalid={!discountIsValid} />{!discountIsValid && <small className="sales-discount-error">Discount must be between 0 and the subtotal.</small>}</label>
              <div className="sales-summary-total"><span>Total due</span><strong key={grandTotal.toFixed(2)}>{money(grandTotal)}</strong></div>
              <div className="sales-summary-row"><span>Amount paid</span><strong>{money(received)}</strong></div>
              <div className="sales-summary-row sales-remaining"><span>Remaining balance</span><strong>{money(remaining)}</strong></div>
              <button className={`sales-create-button${isSubmitting ? " is-loading" : ""}`} type="button" disabled={isSubmitting || Boolean(removingMedicineId) || dataLoading || !discountIsValid || !paymentIsValid} onClick={createInvoice}><span>{isSubmitting ? "Creating invoice…" : "Create Invoice"}</span><span aria-hidden="true">{isSubmitting ? "◌" : "→"}</span></button>
              {isSubmitting && <p className="sales-disabled-note" role="status" aria-live="polite">Saving invoice and updating stock securely…</p>}
            </aside>
          </div>
          <p className="sales-page-footnote">Prices are checked again before submission. Stock and cost snapshots are recorded securely with the invoice.</p>
        </div>
      </section>

      <style jsx global>{`
        .sales-admin-layout{min-height:100vh;display:grid;grid-template-columns:225px minmax(0,1fr);background:#f5f8f6;color:#111817;font-family:Arial,sans-serif}
        .sales-sidebar{position:relative;min-height:100vh;background:#103d3c;padding:25px 17px;color:#fff}
        .sales-brand{display:flex;align-items:center;gap:10px;margin-bottom:48px;color:#fff;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:.08em}
        .sales-brand small{display:block;margin-top:3px;color:#9ab9b1;font-size:8px;font-weight:400;letter-spacing:.14em}
        .sales-brand-mark{display:grid;width:35px;height:35px;place-items:center;border:1px solid #111817;background:#9de3d8;color:#103d3c;font-size:19px}
        .sales-nav-label,.sales-sidebar-bottom>span{font-size:9px;letter-spacing:.12em;color:#9ab9b1}
        .sales-nav-label{margin:0 0 13px 10px}
        .sales-nav{display:flex;flex-direction:column;gap:4px}
        .sales-nav a{display:block;padding:13px 12px;color:#c6d9d3;text-decoration:none;font-size:13px}
        .sales-nav a:hover{background:#1b504c;color:#fff}
        .sales-nav .sales-nav-active{background:#9de3d8;color:#103d3c;font-weight:700;border:1px solid #111817;box-shadow:3px 3px 0 #111817}
        .sales-nav .sales-nav-history{padding-left:24px;font-size:12px}
        .sales-sidebar-bottom{position:absolute;left:25px;bottom:25px;display:flex;flex-direction:column;gap:13px}
        .sales-sidebar-bottom a{color:#fff;text-decoration:none;font-size:12px}
        .sales-main{min-width:0}
        .sales-topbar{height:72px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 34px;border-bottom:1px solid #dce7e2;background:#fff;font:10px 'DM Mono',monospace;letter-spacing:.08em}
        .sales-workspace-tag,.sales-draft-tag{padding:7px 9px;background:#e6f3ee;color:#103d3c;font:9px 'DM Mono',monospace;letter-spacing:.05em;white-space:nowrap}
        .sales-content{max-width:1180px;margin:0 auto;padding:34px clamp(16px,3vw,34px) 48px}
        .sales-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px}
        .sales-eyebrow{color:#168c83;font:10px 'DM Mono',monospace;letter-spacing:.1em}
        .sales-heading h1{margin:8px 0;font-size:34px;letter-spacing:-.04em;color:#103d3c}
        .sales-heading h1 em{font-family:Georgia,serif;font-weight:400}
        .sales-heading p,.sales-section-heading p{margin:0;color:#66736f;font-size:13px;line-height:1.5}
        .sales-draft-tag{border:1px solid #103d3c;background:#fff}
        .sales-panel,.sales-summary-panel{min-width:0;margin-bottom:18px;padding:21px;background:#fff;border:1.5px solid #111817;box-shadow:3px 3px 0 #111817}
        .sales-section-heading{display:flex;align-items:flex-start;gap:12px;margin-bottom:19px}
        .sales-step{display:grid;flex:0 0 29px;height:29px;place-items:center;border:1px solid #111817;background:#9de3d8;color:#103d3c;font:10px 'DM Mono',monospace}
        .sales-section-heading h2{margin:2px 0 5px;color:#103d3c;font-size:18px}
        .sales-field{display:grid;gap:7px;color:#103d3c;font-size:12px;font-weight:700}
        .sales-field input,.sales-field select,.sales-field textarea,.sales-summary-discount input{width:100%;min-width:0;padding:11px 12px;border:1px solid #cbd8d5;border-radius:4px;background:#fff;color:#111817;font:13px Arial,sans-serif}
        .sales-field input:disabled,.sales-field select:disabled,.sales-search-wrap input:disabled{background:#f4f7f5;color:#7b8984;cursor:not-allowed}
        .sales-data-error{margin:0 0 18px;padding:12px 14px;border:1px solid #c94d3d;background:#fff0ed;color:#8b2419;font-size:12px;line-height:1.5}
        .sales-invoice-success{margin:0 0 18px;padding:12px 14px;border:1px solid #168c83;background:#e5f2ef;color:#103d3c;font-size:13px;font-weight:700}
        .sales-customer-select{max-width:560px}
        .sales-walkin-toggle{display:flex;align-items:center;gap:9px;margin:0 0 15px;color:#103d3c;font-size:13px;font-weight:700;cursor:pointer}
        .sales-walkin-toggle input{width:16px;height:16px;accent-color:#168c83}
        .sales-empty-customer{display:flex;align-items:center;gap:12px;margin-top:15px;padding:14px;border:1px dashed #b8ccc5;background:#f8fbf9}
        .sales-empty-icon{display:grid;width:34px;height:34px;place-items:center;background:#e5f2ef;color:#168c83;font-size:18px}
        .sales-empty-customer strong,.sales-empty-items strong{color:#103d3c;font-size:13px}
        .sales-empty-customer p,.sales-empty-items p{margin:4px 0 0;color:#66736f;font-size:12px;line-height:1.5}
        .sales-search-wrap{display:flex;align-items:center;gap:9px;margin-bottom:16px;padding:0 12px;border:1px solid #cbd8d5;border-radius:4px;color:#168c83;font-size:20px}
        .sales-search-wrap input{width:100%;padding:12px 0;border:0;outline:0;background:transparent;font:13px Arial,sans-serif}
        .sales-medicine-results{max-height:280px;overflow:auto;margin:-7px 0 16px;border:1px solid #cbd8d5;background:#fff;box-shadow:2px 2px 0 #103d3c}
        .sales-medicine-results>button{display:flex;width:100%;align-items:center;justify-content:space-between;gap:14px;padding:12px;border:0;border-bottom:1px solid #e4ebe8;background:#fff;color:#103d3c;text-align:left;cursor:pointer}
        .sales-medicine-results>button:hover{background:#f1f8f6}
        .sales-medicine-results>button>span:first-child{display:grid;gap:4px}
        .sales-medicine-results strong,.sales-line-medicine strong{font-size:12px}
        .sales-medicine-results small,.sales-line-medicine small{color:#66736f;font-size:10px}
        .sales-medicine-results>button>span:last-child{display:flex;align-items:center;gap:10px;white-space:nowrap;font-size:11px}
        .sales-medicine-results b{padding:6px 8px;background:#168c83;color:#fff;font-size:10px}
        .sales-medicine-results>p{margin:0;padding:14px;color:#66736f;font-size:12px}
        .sales-items-wrap{overflow-x:auto;border:1px solid #d6e1dd}
        .sales-items-table{width:100%;min-width:560px;border-collapse:collapse;text-align:left}
        .sales-items-table th{padding:12px;background:#e5f2ef;color:#103d3c;font:9px 'DM Mono',monospace;letter-spacing:.05em}
        .sales-items-table td{border-top:1px solid #edf1ef}
        .sales-items-table tbody td{padding:12px;font-size:12px;white-space:nowrap}
        .sales-line-medicine{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:170px}
        .sales-line-medicine>span{display:grid;gap:4px;white-space:normal}
        .sales-line-medicine button{padding:5px 7px;border:1px solid #cbd8d5;background:#fff;color:#8b2419;font-size:10px;cursor:pointer}
        .sales-quantity-input{width:76px;padding:7px;border:1px solid #cbd8d5;border-radius:4px}
        .sales-empty-items{display:flex;min-height:135px;flex-direction:column;align-items:center;justify-content:center;padding:18px;text-align:center}
        .sales-empty-items>span{display:grid;width:32px;height:32px;place-items:center;margin-bottom:9px;border:1px solid #cbd8d5;color:#168c83;font-size:19px}
        .sales-lower-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.8fr);gap:18px;align-items:start}
        .sales-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}
        .sales-full-width,.sales-notes-field{grid-column:1/-1}
        .sales-notes-field{margin-top:16px}
        .sales-summary-panel{position:sticky;top:18px;margin-bottom:18px}
        .sales-summary-row,.sales-summary-total{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid #e4ebe8;font-size:13px}
        .sales-summary-row span,.sales-summary-discount{color:#66736f}
        .sales-summary-row strong{color:#103d3c}
        .sales-summary-discount{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid #e4ebe8;font-size:13px}
        .sales-summary-discount input{width:120px;text-align:right}
        .sales-discount-invalid{color:#8b2419}
        .sales-summary-discount .sales-discount-error{flex-basis:100%;margin-top:-7px;color:#8b2419;font-size:11px}
        .sales-summary-discount:has(.sales-discount-error){flex-wrap:wrap}
        .sales-summary-total{margin-top:2px;border-bottom:0;color:#103d3c;font-weight:700}
        .sales-summary-total strong{font-size:22px}
        .sales-remaining{padding-top:4px;border-bottom:0;font-size:11px}
        .sales-create-button{width:100%;margin-top:12px;padding:13px;border:1px solid #103d3c;background:#168c83;color:#fff;font-size:13px;font-weight:700;cursor:pointer}
        .sales-create-button:disabled{cursor:wait;opacity:.6}
        .sales-disabled-note{margin:9px 0 0;text-align:center;color:#66736f;font-size:10px}
        .sales-page-footnote{color:#66736f;font-size:11px;text-align:center}
        @media(max-width:850px){.sales-admin-layout{grid-template-columns:1fr}.sales-sidebar{min-height:auto;padding:12px 16px}.sales-brand{margin:0}.sales-nav-label,.sales-sidebar-bottom{display:none}.sales-nav{flex-direction:row;overflow-x:auto;margin-top:12px;padding-bottom:3px}.sales-nav a{flex:0 0 auto;padding:10px;font-size:12px}.sales-topbar{height:56px;padding:0 16px}.sales-content{padding-top:25px}.sales-lower-grid{grid-template-columns:1fr}.sales-summary-panel{position:static}}
        @media(max-width:520px){.sales-heading{flex-direction:column}.sales-heading h1{font-size:29px}.sales-panel,.sales-summary-panel{padding:16px}.sales-form-grid{grid-template-columns:1fr}.sales-full-width,.sales-notes-field{grid-column:auto}.sales-summary-discount input{width:105px}}
        .sales-admin-layout{--sales-ink:#103d3c;--sales-teal:#087c73;--sales-mint:#9de3d8;--sales-paper:#f1f6f3;background:var(--sales-paper);font-size:16px}
        .sales-sidebar{padding:27px 18px;background:#103d3c}
        .sales-brand{font-size:16px}.sales-brand small{font-size:12px}
        .sales-nav-label,.sales-sidebar-bottom>span{font-size:12px;font-weight:700}
        .sales-nav a{font-size:15px;transition:background .2s,color .2s,transform .2s}
        .sales-nav a:focus-visible,.sales-brand:focus-visible,.sales-sidebar-bottom a:focus-visible{outline:3px solid #f2bf63;outline-offset:3px}
        .sales-nav .sales-nav-history{padding-left:24px;font-size:14px}
        .sales-sidebar-bottom a{font-size:14px}
        .sales-topbar{font-size:12px;font-weight:700}
        .sales-workspace-tag,.sales-draft-tag{font-size:12px;font-weight:700}
        .sales-content{max-width:1240px;padding-top:38px}
        .sales-heading h1{font-size:clamp(34px,4vw,44px);font-weight:800;line-height:1.08}
        .sales-heading h1 em{font-weight:800;font-style:normal}
        .sales-heading p,.sales-section-heading p{font-size:15px}
        .sales-eyebrow{font-size:12px;font-weight:800}
        .sales-panel,.sales-summary-panel{padding:24px;border-width:2px;box-shadow:4px 4px 0 #111817}
        .sales-section-heading{align-items:center}
        .sales-section-heading h2,.sales-summary-top h2{font-size:22px;font-weight:800}
        .sales-section-heading p{margin-top:3px}
        .sales-step{flex-basis:36px;height:36px;font-size:13px;font-weight:700}
        .sales-field{font-size:15px;gap:8px}
        .sales-field input,.sales-field select,.sales-field textarea,.sales-summary-discount input{min-height:48px;padding:12px 14px;border:1.5px solid #aebfba;border-radius:0;font-size:16px}
        .sales-field textarea{min-height:100px}
        .sales-customer-picker{position:relative;max-width:640px}
        .sales-customer-select{max-width:none}
        .sales-customer-results{position:absolute;z-index:20;top:100%;right:0;left:0;max-height:300px;overflow:auto;border:1.5px solid #103d3c;background:#fff;box-shadow:4px 4px #103d3c;animation:sales-dropdown-in .16s ease-out}
        .sales-customer-results button{display:grid;width:100%;gap:4px;padding:13px 15px;border:0;border-bottom:1px solid #e2ebe6;background:#fff;color:#103d3c;text-align:left;cursor:pointer}
        .sales-customer-results button:hover,.sales-customer-results button[aria-selected="true"]{background:#e8f5f0}
        .sales-customer-results button:before{display:none}
        .sales-customer-results button strong{font-size:15px}.sales-customer-results button span,.sales-customer-results p{font-size:14px;color:#526c62}
        .sales-customer-results p{margin:0;padding:15px}
        .sales-change-customer{margin-top:9px;padding:8px 0;border:0;background:transparent;color:#087c73;font-size:14px;font-weight:700;text-decoration:underline;cursor:pointer}
        .sales-walkin-toggle{font-size:15px}
        .sales-walkin-toggle input{width:20px;height:20px}
        .sales-empty-customer{padding:17px}
        .sales-empty-customer strong,.sales-empty-items strong{font-size:16px}
        .sales-empty-customer p,.sales-empty-items p{font-size:14px}
        .sales-search-wrap{min-height:54px;border:1.5px solid #aebfba;border-radius:0;background:#fff}
        .sales-search-wrap input{min-height:50px;font-size:16px}
        .sales-medicine-results{max-height:340px;border:1.5px solid #103d3c;box-shadow:4px 4px #103d3c;animation:sales-dropdown-in .16s ease-out}
        .sales-medicine-results>button{position:relative;isolation:isolate;overflow:hidden;min-height:70px;padding:14px 16px;font-size:15px;transition:background .15s,color .15s}
        .sales-medicine-results>button:before{position:absolute;z-index:-1;top:50%;left:50%;width:1px;height:1px;border-radius:50%;background:#d8f0e8;content:"";transform:scale(0);transition:transform .38s cubic-bezier(.2,.75,.25,1)}
        .sales-medicine-results>button:hover:not(:disabled):before{transform:scale(420)}
        .sales-medicine-results>button>span{position:relative;z-index:1}
        .sales-medicine-results strong,.sales-line-medicine strong{font-size:16px}
        .sales-medicine-results small,.sales-line-medicine small{font-size:14px;line-height:1.45}
        .sales-medicine-results>button>span:last-child{font-size:15px}
        .sales-medicine-results b{padding:8px 10px;font-size:14px}
        .sales-medicine-results>button:disabled{opacity:.58;cursor:not-allowed}
        .sales-medicine-results>button b{white-space:nowrap}
        .sales-medicine-results>p{font-size:14px}
        .sales-empty-items{min-height:150px;border:1px dashed #b8ccc5;background:#fbfdfc;animation:sales-card-in .22s ease-out}
        .sales-items-list{display:grid;gap:12px}
        .sales-item-card{min-width:0;padding:17px;border:1.5px solid #cbdad3;background:#fff;box-shadow:2px 2px #e1ebe5;animation:sales-card-in .22s ease-out;transition:border-color .18s,box-shadow .18s,transform .18s}
        .sales-item-card:hover{border-color:#168c83;box-shadow:3px 3px #9de3d8;transform:translateY(-1px)}
        .sales-item-card.is-removing{overflow:hidden;max-height:0;margin:0;padding-top:0;padding-bottom:0;border-width:0;opacity:0;transform:translateX(12px);transition:max-height .18s ease,margin .18s ease,padding .18s ease,border-width .18s ease,opacity .18s ease,transform .18s ease}
        .sales-line-medicine{min-width:0;justify-content:space-between}
        .sales-line-medicine>span{min-width:0}
        .sales-remove-button{min-height:40px;padding:0 12px;border:1px solid #c94d3d;background:#fff;color:#8b2419;font-size:14px;font-weight:700;cursor:pointer;transition:background .2s,color .2s}
        .sales-remove-button:hover{background:#8b2419;color:#fff}
        .sales-item-data{display:grid;grid-template-columns:1fr 150px 1fr;align-items:end;gap:18px;margin-top:16px;padding-top:14px;border-top:1px solid #e3ebe6}
        .sales-item-data>span,.sales-item-data>label{display:grid;gap:7px;color:#567066;font-size:14px;font-weight:700}
        .sales-item-data strong{color:#103d3c;font-size:17px;font-weight:800;transition:transform .15s}
        .sales-item-data .sales-line-total{justify-items:end;text-align:right}
        .sales-quantity-input{width:100%;min-height:46px;padding:8px 10px;border:1.5px solid #aebfba;border-radius:0;color:#111817;font-size:16px}
        .sales-quantity-input:focus,.sales-field :is(input,select,textarea):focus,.sales-summary-discount input:focus{outline:3px solid #e5ae4e;outline-offset:2px}
        .sales-summary-panel{top:20px;padding:24px}
        .sales-summary-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
        .sales-summary-top h2{margin:5px 0 0;color:#103d3c}
        .sales-payment-status{padding:8px 10px;border:1px solid #aebfba;font-size:13px;font-weight:800;white-space:nowrap}
        .sales-payment-status.is-due{border-color:#c48b32;background:#fff4dc;color:#714a08}
        .sales-payment-status.is-paid{border-color:#168c83;background:#e5f2ef;color:#12645e}
        .sales-summary-row,.sales-summary-total{padding:16px 0;font-size:15px;transition:background .2s}
        .sales-summary-row strong{font-size:16px;font-variant-numeric:tabular-nums}
        .sales-summary-discount{font-size:15px}
        .sales-summary-discount input{width:145px;min-height:44px}
        .sales-summary-total{margin-top:5px;padding-top:19px;font-size:17px}
        .sales-summary-total strong{font-size:28px;font-variant-numeric:tabular-nums;transition:transform .18s}
        .sales-summary-row strong,.sales-summary-total strong,.sales-line-total strong{animation:sales-number-in .2s ease-out}
        .sales-remaining{font-weight:700}
        .sales-discount-error,.sales-input-error{font-size:14px!important}
        .sales-input-error{color:#8b2419;font-weight:600}
        .sales-create-button{position:relative;isolation:isolate;display:flex;min-height:56px;align-items:center;justify-content:space-between;gap:12px;overflow:hidden;margin-top:18px;padding:0 19px;border:1.5px solid #103d3c;border-radius:0;background:#087c73;color:#fff;font-size:17px;font-weight:800;box-shadow:4px 4px #103d3c;cursor:pointer;transition:transform .18s,box-shadow .18s,opacity .18s}
        .sales-create-button:before{position:absolute;z-index:-1;top:50%;left:50%;width:1px;height:1px;border-radius:50%;background:#9de3d8;content:"";transform:scale(0);transition:transform .42s cubic-bezier(.2,.75,.25,1)}
        .sales-create-button:hover:not(:disabled):before{transform:scale(340)}
        .sales-create-button:hover:not(:disabled){color:#103d3c}
        .sales-create-button>span:last-child{font-size:22px;transition:transform .18s}
        .sales-create-button:hover:not(:disabled)>span:last-child{transform:translateX(4px)}
        .sales-create-button:active:not(:disabled){transform:translate(2px,2px);box-shadow:2px 2px #103d3c}
        .sales-create-button:focus-visible,.sales-medicine-results button:focus-visible,.sales-customer-results button:focus-visible,.sales-remove-button:focus-visible,.sales-change-customer:focus-visible{outline:3px solid #e5ae4e;outline-offset:3px}
        .sales-create-button:disabled{opacity:.58;cursor:not-allowed}
        .sales-create-button.is-loading>span:last-child{animation:sales-spin .8s linear infinite}
        .sales-remove-button{position:relative;isolation:isolate;overflow:hidden}
        .sales-remove-button:before{position:absolute;z-index:-1;top:50%;left:50%;width:1px;height:1px;border-radius:50%;background:#8b2419;content:"";transform:scale(0);transition:transform .35s ease}
        .sales-remove-button:hover:not(:disabled){color:#fff}
        .sales-remove-button:hover:not(:disabled):before{transform:scale(90)}
        .sales-remove-button:disabled{opacity:.6;cursor:wait}
        .sales-disabled-note{font-size:14px}
        .sales-data-error,.sales-invoice-success{padding:15px 17px;font-size:15px}
        .sales-page-footnote{font-size:14px}
        .sales-sidebar-bottom>span{font-size:12px}
        @keyframes sales-dropdown-in{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes sales-card-in{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
        @keyframes sales-spin{to{transform:rotate(360deg)}}
        @keyframes sales-number-in{from{opacity:.55;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
        @keyframes sales-section-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .sales-enter{animation:sales-section-in .32s ease-out both}
        .sales-enter-delay{animation-delay:.06s}.sales-enter-late{animation-delay:.12s}
        @media(max-width:850px){.sales-sidebar{padding:14px 16px}.sales-brand{font-size:16px}.sales-nav{gap:5px}.sales-nav a{min-height:44px;padding:11px 12px;font-size:14px}.sales-nav .sales-nav-history{font-size:14px}.sales-topbar{font-size:12px}.sales-workspace-tag{font-size:12px}}
        @media(max-width:600px){.sales-content{padding:21px 14px 34px}.sales-heading{gap:10px;margin-bottom:18px}.sales-heading h1{font-size:32px}.sales-heading p{font-size:15px}.sales-panel,.sales-summary-panel{padding:17px}.sales-section-heading h2,.sales-summary-top h2{font-size:21px}.sales-section-heading p{font-size:14px}.sales-item-card{padding:14px}.sales-item-data{grid-template-columns:1fr 1fr;gap:14px}.sales-item-data .sales-line-total{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;text-align:left}.sales-quantity-input{min-height:48px}.sales-summary-panel{position:static}.sales-summary-total strong{font-size:26px}.sales-create-button{position:sticky;bottom:10px;z-index:5;box-shadow:4px 4px #103d3c,0 4px 18px #103d3c33}.sales-create-button:hover:not(:disabled):before{transform:scale(420)}}
        @media(max-width:390px){.sales-sidebar{padding:12px}.sales-brand{font-size:14px}.sales-brand small{font-size:12px}.sales-nav{margin-right:-12px}.sales-nav a{padding:10px;font-size:13px}.sales-content{padding-right:12px;padding-left:12px}.sales-heading h1{font-size:29px}.sales-topbar{padding:0 12px;font-size:12px}.sales-workspace-tag{padding:6px 7px;font-size:12px}.sales-item-data{gap:10px}.sales-summary-discount{flex-wrap:wrap}.sales-summary-discount input{width:130px}}
        @media(prefers-reduced-motion:reduce){.sales-admin-layout *,.sales-admin-layout *:before,.sales-admin-layout *:after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
      `}</style>
    </main>
  );
}
