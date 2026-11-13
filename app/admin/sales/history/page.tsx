"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Invoice = { id: string; invoice_number: string; customer_id: string | null; customer_name: string; invoice_date: string; subtotal: number; discount: number; total: number; status: string; notes: string | null };
type Customer = { id: string; name: string; contact_person: string | null; phone: string | null; address: string | null; opening_balance: number; notes: string | null; is_active: boolean };
type Payment = { id: string; invoice_id: string; amount: number; payment_method: string; reference: string | null; notes: string | null; payment_date: string };
type InvoiceItem = { id: string; invoice_id: string; medicine_id: string; quantity: number; unit_price: number; line_discount: number; line_total: number; unit_cost_snapshot: number | null };
type Medicine = { id: string; name: string; strength: string | null; dosage_form: string | null };
type InvoiceRow = Invoice & { customer: Customer | null; paid: number };

const PAGE_SIZE = 250;
const money = (value: number) => `\u09F3 ${value.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayInDhaka = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dateLabel = (value: string) => {
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export default function SalesHistoryPage() {
  const router = useRouter();
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [accessError, setAccessError] = useState("");
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<InvoiceRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customerDetail, setCustomerDetail] = useState<Customer | null>(null);
  const [medicines, setMedicines] = useState<Record<string, Medicine>>({});
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayInDhaka);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [paymentSuccess, setPaymentSuccess] = useState("");

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const invoices: Invoice[] = [];
      for (let start = 0; ; start += PAGE_SIZE) {
        let query = supabase.from("invoices")
          .select("id,invoice_number,customer_id,customer_name,invoice_date,subtotal,discount,total,status,notes")
          .order("invoice_date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(start, start + PAGE_SIZE - 1);
        if (fromDate) query = query.gte("invoice_date", fromDate);
        if (toDate) query = query.lte("invoice_date", toDate);
        const { data, error: queryError } = await query;
        if (queryError) throw queryError;
        const page = (data ?? []) as Invoice[];
        invoices.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      if (!invoices.length) { setRows([]); return; }
      const invoiceIds = invoices.map((invoice) => invoice.id);
      const customerIds = [...new Set(invoices.map((invoice) => invoice.customer_id).filter((id): id is string => Boolean(id)))];
      const customersResult = customerIds.length ? await supabase.from("customers").select("id,name,contact_person,phone,address,opening_balance,notes,is_active").in("id", customerIds) : { data: [], error: null };
      if (customersResult.error) throw customersResult.error;
      const linkedPayments: Pick<Payment, "invoice_id" | "amount">[] = [];
      for (let start = 0; ; start += PAGE_SIZE) {
        const { data, error: paymentsError } = await supabase.from("payments")
          .select("invoice_id,amount").in("invoice_id", invoiceIds)
          .range(start, start + PAGE_SIZE - 1);
        if (paymentsError) throw paymentsError;
        const page = (data ?? []) as Pick<Payment, "invoice_id" | "amount">[];
        linkedPayments.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
      const customerById = new Map(((customersResult.data ?? []) as Customer[]).map((customer) => [customer.id, customer]));
      const paidByInvoice = new Map<string, number>();
      for (const entry of linkedPayments) {
        paidByInvoice.set(entry.invoice_id, (paidByInvoice.get(entry.invoice_id) ?? 0) + Number(entry.amount));
      }
      setRows(invoices.map((invoice) => ({ ...invoice, customer: invoice.customer_id ? customerById.get(invoice.customer_id) ?? null : null, paid: paidByInvoice.get(invoice.id) ?? 0 })));
    } catch (reason) {
      setError(`Could not load invoice history: ${reason instanceof Error ? reason.message : "Unexpected error."}`);
      setRows([]);
    } finally { setLoading(false); }
  }, [fromDate, toDate]);

  useEffect(() => {
    let active = true;
    async function checkAccess() {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError || !session?.user) { router.replace("/login"); return; }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
      if (!active) return;
      if (profileError) { setAccessError(`Unable to verify your access: ${profileError.message}`); setAccess("denied"); }
      else if (!(["owner", "manager", "sales", "accountant"] as string[]).includes(profile?.role ?? "")) { setAccessError("Access denied. This page is available to authorized sales and accounting staff only."); setAccess("denied"); }
      else setAccess("allowed");
    }
    checkAccess().catch((reason: unknown) => {
      if (!active) return;
      setAccessError(`Unable to verify your access: ${reason instanceof Error ? reason.message : "Unexpected error."}`);
      setAccess("denied");
    });
    return () => { active = false; };
  }, [router]);
  useEffect(() => { if (access === "allowed") void loadInvoices(); }, [access, loadInvoices]);

  async function openInvoice(invoice: InvoiceRow) {
    setSelected(invoice); setDetailLoading(true); setDetailError(""); setItems([]); setPayments([]); setMedicines({}); setCustomerDetail(null);
    setPaymentError(""); setPaymentSuccess("");
    try {
      const [itemResult, paymentResult, customerResult] = await Promise.all([
        supabase.from("invoice_items").select("id,invoice_id,medicine_id,quantity,unit_price,line_discount,line_total,unit_cost_snapshot").eq("invoice_id", invoice.id).order("created_at", { ascending: true }),
        supabase.from("payments").select("id,invoice_id,amount,payment_method,reference,notes,payment_date").eq("invoice_id", invoice.id).order("payment_date", { ascending: false }),
        invoice.customer_id ? supabase.from("customers").select("id,name,contact_person,phone,address,opening_balance,notes,is_active").eq("id", invoice.customer_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      if (itemResult.error) throw itemResult.error;
      if (paymentResult.error) throw paymentResult.error;
      if (customerResult.error) throw customerResult.error;
      const loadedItems = (itemResult.data ?? []) as InvoiceItem[];
      setItems(loadedItems); setPayments((paymentResult.data ?? []) as Payment[]); setCustomerDetail(customerResult.data as Customer);
      const medicineIds = [...new Set(loadedItems.map((item) => item.medicine_id))];
      if (medicineIds.length) {
        const { data, error: medicineError } = await supabase.from("medicines").select("id,name,strength,dosage_form").in("id", medicineIds);
        if (medicineError) throw medicineError;
        setMedicines(Object.fromEntries(((data ?? []) as Medicine[]).map((medicine) => [medicine.id, medicine])));
      }
    } catch (reason) { setDetailError(`Could not load invoice details: ${reason instanceof Error ? reason.message : "Unexpected error."}`); }
    finally { setDetailLoading(false); }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || paymentSubmitting) return;

    const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const outstanding = Math.max(0, Number(selected.total) - totalPaid);
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError("Enter a payment amount greater than zero.");
      return;
    }
    if (amount > outstanding) {
      setPaymentError(`Payment cannot exceed the outstanding balance of ${money(outstanding)}.`);
      return;
    }
    if (!paymentDate) {
      setPaymentError("Choose the date the payment was received.");
      return;
    }

    setPaymentSubmitting(true);
    setPaymentError("");
    setPaymentSuccess("");
    try {
      const { data, error: rpcError } = await supabase.rpc("record_invoice_payment", {
        p_invoice_id: selected.id,
        p_amount: amount,
        p_payment_method: paymentMethod,
        p_reference: paymentReference.trim() || null,
        p_notes: paymentNotes.trim() || null,
        p_payment_date: paymentDate,
      });
      if (rpcError) throw rpcError;
      if (typeof data !== "string" || !data) throw new Error("The database did not confirm the payment.");

      setPaymentSuccess(`Payment of ${money(amount)} recorded successfully.`);
      setPaymentAmount("");
      setPaymentReference("");
      setPaymentNotes("");
      await Promise.all([openInvoice(selected), loadInvoices()]);
      setPaymentSuccess(`Payment of ${money(amount)} recorded successfully.`);
    } catch (reason) {
      setPaymentError(reason instanceof Error ? reason.message : "Could not record the payment. Please try again.");
    } finally {
      setPaymentSubmitting(false);
    }
  }

  const visibleRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return term ? rows.filter((row) => row.invoice_number.toLocaleLowerCase().includes(term) || row.customer_name.toLocaleLowerCase().includes(term)) : rows;
  }, [rows, search]);
  if (access === "checking") return <main className="history-state">Checking access...<HistoryStyles /></main>;
  if (access === "denied") return <main className="history-state"><section><h1>Access denied</h1><p>{accessError}</p><Link href="/admin">Return to dashboard</Link></section><HistoryStyles /></main>;

  return <main className="history-layout">
    <aside className="history-sidebar">
      <Link className="history-brand" href="/"><span className="history-brand-mark">R</span><span>RETINA<small>BUSINESS HUB</small></span></Link>
      <div className="history-nav-label">WORKSPACE</div>
      <nav className="history-nav"><Link href="/admin">▦ &nbsp; Overview</Link><Link href="/admin/orders">▤ &nbsp; Orders</Link><Link href="/admin/medicines">＋ &nbsp; Medicines</Link><Link href="/admin/inventory">▥ &nbsp; Inventory</Link><Link href="/admin/sales">৳ &nbsp; Sales &amp; accounts</Link><Link className="history-active" href="/admin/sales/history">↳ &nbsp; Sales History</Link><Link href="/admin/customers">♙ &nbsp; Customers</Link></nav>
      <div className="history-sidebar-bottom"><span>OWNER DASHBOARD</span><Link href="/">← Back to website</Link></div>
    </aside>
    <section className="history-main">
      <header className="history-topbar"><span>RETINA / SALES &amp; ACCOUNTS</span><span className="history-tag">SALES HISTORY</span></header>
      <div className="history-content">
        <div className="history-heading"><div><div className="history-eyebrow">SALES MANAGEMENT</div><h1>Sales <em>History</em></h1><p>Review invoices, payments, and outstanding balances.</p></div><Link className="history-create" href="/admin/sales">+ Create invoice</Link></div>
        <section className="history-filters">
          <label>Search invoices<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Invoice number or customer name" /></label>
          <label>From date<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label>To date<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label>
          <button type="button" onClick={() => { setSearch(""); setFromDate(""); setToDate(""); }}>Clear filters</button>
        </section>
        {error && <div className="history-error" role="alert">{error}<button type="button" onClick={() => void loadInvoices()}>Retry</button></div>}
        <section className="history-table-card">
          {loading ? <div className="history-message" role="status">Loading invoice history...</div> : visibleRows.length === 0 ? <div className="history-message">{rows.length === 0 ? "No invoices found for this date range." : "No invoices match your search."}</div> :
            <div className="history-table-scroll"><table><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE</th><th>TOTAL</th><th>PAID</th><th>OUTSTANDING</th><th>STATUS</th><th></th></tr></thead><tbody>
              {visibleRows.map((invoice) => { const outstanding = Math.max(0, Number(invoice.total) - invoice.paid); return <tr key={invoice.id} onClick={() => void openInvoice(invoice)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openInvoice(invoice); } }}>
                <td><strong>{invoice.invoice_number}</strong></td><td>{invoice.customer_name}</td><td>{dateLabel(invoice.invoice_date)}</td><td>{money(Number(invoice.total))}</td><td>{money(invoice.paid)}</td><td className={outstanding > 0 ? "history-balance-due" : ""}>{money(outstanding)}</td><td><span className="history-status">{invoice.status}</span></td><td><button type="button" onClick={(event) => { event.stopPropagation(); void openInvoice(invoice); }}>View</button>{invoice.status === "posted" && outstanding > 0 && <> <button type="button" onClick={(event) => { event.stopPropagation(); void openInvoice(invoice); }}>Record Payment</button></>}</td>
              </tr>; })}
            </tbody></table></div>}
        </section>
        <p className="history-count">Showing {visibleRows.length} of {rows.length} invoices</p>
      </div>
    </section>
    {selected && <div className="history-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <section className="history-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-detail-title">
        <header className="history-modal-heading"><div><div className="history-eyebrow">INVOICE DETAILS</div><h2 id="invoice-detail-title">{selected.invoice_number}</h2></div><div className="history-modal-actions"><button type="button" onClick={() => window.print()}>Print invoice</button><button type="button" aria-label="Close invoice details" onClick={() => setSelected(null)}>×</button></div></header>
        {detailLoading ? <div className="history-message">Loading invoice details...</div> : detailError ? <div className="history-error" role="alert">{detailError}</div> : <>
          <div className="history-detail-grid">
            <section className="history-detail-card"><h3>Customer</h3><strong>{selected.customer_name}</strong><p>{customerDetail?.contact_person || "No contact person"}</p><p>{customerDetail?.phone || "No phone on file"}</p><p>{customerDetail?.address || "No address on file"}</p></section>
            <section className="history-detail-card"><h3>Invoice</h3><p>Date: <strong>{dateLabel(selected.invoice_date)}</strong></p><p>Status: <span className="history-status">{selected.status}</span></p>{selected.notes && <p>Notes: {selected.notes}</p>}</section>
          </div>
          <section className="history-detail-section"><h3>Medicine lines</h3>{items.length ? <div className="history-table-scroll"><table><thead><tr><th>MEDICINE</th><th>QUANTITY</th><th>UNIT PRICE</th><th>UNIT COST SNAPSHOT</th><th>LINE PROFIT*</th><th>LINE TOTAL</th></tr></thead><tbody>{items.map((item) => { const medicine = medicines[item.medicine_id]; const cost = item.unit_cost_snapshot == null ? null : Number(item.unit_cost_snapshot); return <tr key={item.id}><td><strong>{medicine?.name ?? "Medicine unavailable"}</strong>{medicine && <small>{[medicine.strength, medicine.dosage_form].filter(Boolean).join(" · ")}</small>}</td><td>{item.quantity}</td><td>{money(Number(item.unit_price))}</td><td>{cost == null ? "Unavailable" : money(cost)}</td><td>{cost == null ? "Unavailable" : money(Number(item.line_total) - cost * item.quantity)}</td><td>{money(Number(item.line_total))}</td></tr>; })}</tbody></table></div> : <p className="history-muted">No medicine lines on this invoice.</p>}<p className="history-muted">*Line profit is before invoice-level discount. A blank legacy cost remains unavailable rather than estimated.</p></section>
          <section className="history-detail-section"><h3>Payment history</h3>{payments.length ? <div className="history-table-scroll"><table><thead><tr><th>DATE</th><th>METHOD</th><th>REFERENCE</th><th>NOTES</th><th>AMOUNT</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td>{dateLabel(payment.payment_date)}</td><td>{payment.payment_method}</td><td>{payment.reference || "—"}</td><td>{payment.notes || "—"}</td><td>{money(Number(payment.amount))}</td></tr>)}</tbody></table></div> : <p className="history-muted">No payments recorded for this invoice.</p>}</section>
          {paymentSuccess && <div className="history-payment-success" role="status">{paymentSuccess}</div>}
          {(() => {
            const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
            const outstanding = Math.max(0, Number(selected.total) - totalPaid);
            const costComplete = items.length > 0 && items.every((item) => item.unit_cost_snapshot !== null);
            const grossProfit = costComplete
              ? items.reduce((sum, item) => sum + Number(item.line_total) - Number(item.unit_cost_snapshot) * item.quantity, 0) - Number(selected.discount)
              : null;
            return <>
              <section className="history-totals"><div><span>Invoice subtotal</span><strong>{money(Number(selected.subtotal))}</strong></div><div><span>Invoice discount</span><strong>{money(Number(selected.discount))}</strong></div><div><span>Gross profit</span><strong>{grossProfit === null ? "Unavailable" : money(grossProfit)}</strong></div><div><span>Total</span><strong>{money(Number(selected.total))}</strong></div><div><span>Total paid</span><strong>{money(totalPaid)}</strong></div><div className="history-total-due"><span>Outstanding balance</span><strong>{money(outstanding)}</strong></div></section>
              {selected.status === "posted" && outstanding > 0 && <form className="history-payment-form" onSubmit={recordPayment}>
                <div><div className="history-eyebrow">PAYMENT COLLECTION</div><h3>Record Payment</h3><p>Enter the amount received for this invoice. Remaining balance: <strong>{money(outstanding)}</strong></p></div>
                {paymentError && <div className="history-payment-error" role="alert">{paymentError}</div>}
                <div className="history-payment-fields">
                  <label>Amount received (BDT)<input required type="number" min="0.01" max={outstanding} step="0.01" inputMode="decimal" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} /></label>
                  <label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="bank_transfer">Bank Transfer</option><option value="mobile_banking">Mobile Banking</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
                  <label>Payment date<input required type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
                  <label>Reference (optional)<input value={paymentReference} maxLength={200} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Transaction or cheque reference" /></label>
                  <label className="history-payment-notes">Notes (optional)<textarea rows={3} maxLength={2000} value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} placeholder="Add a note about this collection" /></label>
                </div>
                <button className="history-payment-submit" type="submit" disabled={paymentSubmitting || !paymentAmount || Number(paymentAmount) <= 0 || Number(paymentAmount) > outstanding}>{paymentSubmitting ? "Recording payment..." : "Record Payment"}</button>
              </form>}
            </>;
          })()}
        </>}
      </section>
    </div>}
    <HistoryStyles />
  </main>;
}

function HistoryStyles() {
  return <style jsx global>{`
    .history-layout{min-height:100vh;display:grid;grid-template-columns:225px minmax(0,1fr);background:#f5f8f6;color:#111817;font-family:Arial,sans-serif}.history-sidebar{position:relative;min-height:100vh;background:#103d3c;padding:25px 17px;color:#fff}.history-brand{display:flex;align-items:center;gap:10px;margin-bottom:48px;color:#fff;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:.08em}.history-brand small{display:block;margin-top:3px;color:#9ab9b1;font-size:8px;font-weight:400;letter-spacing:.14em}.history-brand-mark{display:grid;width:35px;height:35px;place-items:center;border:1px solid #111817;background:#9de3d8;color:#103d3c;font-size:19px}.history-nav-label,.history-sidebar-bottom>span{font-size:9px;letter-spacing:.12em;color:#9ab9b1}.history-nav-label{margin:0 0 13px 10px}.history-nav{display:flex;flex-direction:column;gap:4px}.history-nav a{display:block;padding:13px 12px;color:#c6d9d3;text-decoration:none;font-size:13px}.history-nav a:hover{background:#1b504c;color:#fff}.history-nav .history-active{padding-left:24px;background:#9de3d8;color:#103d3c;font-size:12px;font-weight:700;border:1px solid #111817;box-shadow:3px 3px 0 #111817}.history-sidebar-bottom{position:absolute;left:25px;bottom:25px;display:flex;flex-direction:column;gap:13px}.history-sidebar-bottom a{color:#fff;text-decoration:none;font-size:12px}
    .history-main{min-width:0}.history-topbar{height:72px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 34px;border-bottom:1px solid #dce7e2;background:#fff;font:10px 'DM Mono',monospace;letter-spacing:.08em}.history-tag{padding:7px 9px;background:#e6f3ee;color:#103d3c;font:9px 'DM Mono',monospace;letter-spacing:.05em;white-space:nowrap}.history-content{max-width:1320px;margin:0 auto;padding:34px clamp(16px,3vw,34px) 48px}.history-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:24px}.history-eyebrow{color:#168c83;font:10px 'DM Mono',monospace;letter-spacing:.1em}.history-heading h1{margin:8px 0;color:#103d3c;font-size:34px;letter-spacing:-.04em}.history-heading h1 em{font-family:Georgia,serif;font-weight:400}.history-heading p{margin:0;color:#66736f;font-size:13px}.history-create{padding:12px 15px;border:1px solid #103d3c;background:#168c83;color:#fff;text-decoration:none;font-size:12px;font-weight:700}
    .history-filters{display:grid;grid-template-columns:minmax(220px,1.5fr) repeat(2,minmax(150px,.7fr)) auto;align-items:end;gap:12px;margin-bottom:18px;padding:17px;background:#fff;border:1.5px solid #111817;box-shadow:3px 3px 0 #111817}.history-filters label{display:grid;gap:7px;color:#103d3c;font-size:11px;font-weight:700}.history-filters input{width:100%;min-width:0;padding:11px;border:1px solid #cbd8d5;border-radius:4px;background:#fff;color:#111817;font:13px Arial,sans-serif}.history-filters button,.history-error button{padding:11px 13px;border:1px solid #cbd8d5;background:#fff;color:#103d3c;font-size:11px;font-weight:700;cursor:pointer}
    .history-table-card{overflow:hidden;background:#fff;border:1.5px solid #111817;box-shadow:3px 3px 0 #111817}.history-table-scroll{overflow-x:auto}.history-table-card table,.history-detail-section table{width:100%;border-collapse:collapse;text-align:left}.history-table-card table{min-width:850px}.history-table-card th,.history-detail-section th{padding:12px;background:#e5f2ef;color:#103d3c;font:9px 'DM Mono',monospace;letter-spacing:.05em;white-space:nowrap}.history-table-card td,.history-detail-section td{padding:13px;border-top:1px solid #edf1ef;font-size:12px;white-space:nowrap}.history-table-card tbody tr{cursor:pointer}.history-table-card tbody tr:hover{background:#f5faf8}.history-table-card td strong{color:#103d3c}.history-table-card td button{padding:7px 10px;border:1px solid #168c83;background:#fff;color:#103d3c;font-size:10px;font-weight:700;cursor:pointer}.history-status{display:inline-block;padding:5px 8px;border:1px solid #b8ccc5;background:#f0f8f6;color:#103d3c;font-size:10px;font-weight:700}.history-balance-due{color:#9b392d;font-weight:700}.history-message{padding:35px 20px;color:#66736f;text-align:center;font-size:13px}.history-error{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;padding:13px;border:1px solid #c94d3d;background:#fff0ed;color:#8b2419;font-size:12px;line-height:1.5}.history-count{margin-top:12px;color:#66736f;font-size:11px}.history-state{min-height:100vh;display:grid;place-items:center;padding:20px;background:#f5f8f6;color:#103d3c;font:600 14px Arial,sans-serif}.history-state section{max-width:460px;padding:28px;background:#fff;border:1.5px solid #111817;box-shadow:4px 4px 0 #111817}.history-state h1{margin-top:0}.history-state p{color:#66736f;line-height:1.6}.history-state a{color:#168c83;font-weight:700}
    .history-modal-backdrop{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:rgba(8,31,29,.62)}.history-modal{width:min(100%,1000px);max-height:92vh;overflow:auto;padding:24px;background:#f9fbfa;border:1.5px solid #111817;box-shadow:5px 5px 0 #111817}.history-modal-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:20px}.history-modal-actions{display:flex;gap:8px}.history-modal-actions button{min-height:35px;padding:0 12px;border:1px solid #cbd8d5;background:white;color:#103d3c;cursor:pointer}.history-modal-actions button:last-child{width:35px;padding:0;font-size:24px}.history-modal-heading h2{margin:7px 0 0;color:#103d3c;font-size:25px}.history-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}.history-detail-card,.history-detail-section{min-width:0;padding:16px;background:#fff;border:1px solid #d6e1dd}.history-detail-card h3,.history-detail-section h3{margin:0 0 12px;color:#103d3c;font-size:14px}.history-detail-card p{margin:6px 0;color:#66736f;font-size:12px;line-height:1.5}.history-detail-card>strong{color:#103d3c;font-size:13px}.history-detail-section{margin-bottom:14px}.history-detail-section table{min-width:650px}.history-detail-section td small{display:block;margin-top:4px;color:#66736f;font-size:10px}.history-muted{margin:0;color:#66736f;font-size:12px}.history-totals{max-width:440px;margin-left:auto;padding:16px;background:#fff;border:1px solid #d6e1dd}.history-totals>div{display:flex;justify-content:space-between;gap:15px;padding:9px 0;border-bottom:1px solid #edf1ef;color:#66736f;font-size:12px}.history-totals strong{color:#103d3c}.history-totals .history-total-due{border:0;color:#103d3c;font-weight:700;font-size:14px}.history-total-due strong{font-size:17px}
    .history-payment-form{margin-top:15px;padding:18px;background:#fff;border:1.5px solid #111817;box-shadow:3px 3px 0 #111817}.history-payment-form h3{margin:6px 0;color:#103d3c;font-size:18px}.history-payment-form>div:first-child>p{margin:0;color:#66736f;font-size:12px;line-height:1.5}.history-payment-form>div:first-child>p strong{color:#103d3c}.history-payment-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;margin-top:17px}.history-payment-fields label{display:grid;gap:7px;min-width:0;color:#103d3c;font-size:11px;font-weight:700}.history-payment-fields input,.history-payment-fields select,.history-payment-fields textarea{width:100%;min-width:0;padding:11px;border:1px solid #cbd8d5;border-radius:4px;background:#fff;color:#111817;font:13px Arial,sans-serif}.history-payment-fields textarea{resize:vertical}.history-payment-notes{grid-column:1/-1}.history-payment-submit{width:100%;margin-top:14px;padding:12px;border:1px solid #103d3c;background:#168c83;color:#fff;font-size:12px;font-weight:700;cursor:pointer}.history-payment-submit:disabled{cursor:wait;opacity:.6}.history-payment-error,.history-payment-success{margin-top:12px;padding:11px;font-size:12px;line-height:1.5}.history-payment-error{border:1px solid #c94d3d;background:#fff0ed;color:#8b2419}.history-payment-success{border:1px solid #168c83;background:#e5f2ef;color:#103d3c}
    @media(max-width:900px){.history-layout{grid-template-columns:190px minmax(0,1fr)}.history-sidebar{padding:22px 12px}.history-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.history-filters label:first-child{grid-column:1/-1}.history-filters button{justify-self:start}}
    @media(max-width:620px){.history-layout{display:block}.history-sidebar{min-height:auto;padding:13px 15px}.history-brand{margin-bottom:13px}.history-nav-label,.history-sidebar-bottom{display:none}.history-nav{flex-direction:row;overflow-x:auto}.history-nav a{flex:0 0 auto;padding:10px;font-size:11px;white-space:nowrap}.history-nav .history-active{padding:10px}.history-topbar{height:54px;padding:0 16px;font-size:9px}.history-content{padding-top:22px}.history-heading{flex-direction:column}.history-heading h1{font-size:29px}.history-filters{grid-template-columns:1fr}.history-filters label:first-child{grid-column:auto}.history-filters button{width:100%}.history-detail-grid{grid-template-columns:1fr}.history-modal-backdrop{padding:8px}.history-modal{max-height:96vh;padding:16px}.history-totals{max-width:none}.history-payment-fields{grid-template-columns:1fr}.history-payment-notes{grid-column:auto}}
    @media print{body *{visibility:hidden!important}.history-modal-backdrop,.history-modal-backdrop *{visibility:visible!important}.history-modal-backdrop{position:absolute;inset:0;display:block;padding:0;background:white}.history-modal{width:100%;max-height:none;overflow:visible;padding:0;border:0;box-shadow:none}.history-modal-actions,.history-payment-form{display:none!important}.history-detail-card,.history-detail-section,.history-totals{break-inside:avoid}.history-detail-section{overflow:visible}.history-detail-section table{min-width:0;width:100%}}
  `}</style>;
}
