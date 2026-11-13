"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

type CustomerForm = {
  name: string;
  contact_person: string;
  phone: string;
  address: string;
  opening_balance: string;
  notes: string;
};

type StatusFilter = "all" | "active" | "inactive";
type CustomerInvoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total: number;
  status: string;
  paid: number;
};

const PAGE_SIZE = 250;
const formatMoney = (amount: number) => `\u09F3 ${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatInvoiceDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "numeric" });
};

const emptyForm: CustomerForm = {
  name: "",
  contact_person: "",
  phone: "",
  address: "",
  opening_balance: "0",
  notes: "",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  border: "1px solid #cbd8d5",
  borderRadius: 6,
  background: "#fff",
  color: "#111817",
  font: "inherit",
};

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [invoiceHistory, setInvoiceHistory] = useState<CustomerInvoice[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyRequest = useRef(0);
  const canManage = role === "owner" || role === "manager" || role === "sales";

  useEffect(() => {
    let active = true;
    async function checkCustomerAccess() {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session?.user) {
        router.replace("/login");
        return;
      }
      const { data: profile, error: profileError } = await supabase
        .from("profiles").select("role").eq("id", session.user.id).single();
      if (!active) return;
      const allowedRoles = ["owner", "manager", "sales", "accountant"];
      if (profileError || !allowedRoles.includes(profile?.role ?? "")) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }
      setRole(profile.role);
      setChecking(false);
    }
    checkCustomerAccess();
    return () => { active = false; };
  }, [router]);

  async function loadCustomers() {
    setLoading(true);
    setError("");
    const { data, error: queryError } = await supabase
      .from("customers")
      .select("id,name,contact_person,phone,address,opening_balance,notes,is_active")
      .order("name", { ascending: true });
    if (queryError) {
      setError(`Could not load customers: ${queryError.message}`);
      setCustomers([]);
    } else {
      const loadedCustomers = (data ?? []) as Customer[];
      setCustomers(loadedCustomers);
      setSelectedCustomer((current) => current ? loadedCustomers.find((customer) => customer.id === current.id) ?? current : null);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!checking) loadCustomers();
  }, [checking]);

  function editCustomer(customer: Customer) {
    if (!canManage) return;
    setEditingId(customer.id);
    setForm({
      name: customer.name,
      contact_person: customer.contact_person ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
      opening_balance: String(customer.opening_balance ?? 0),
      notes: customer.notes ?? "",
    });
    setError("");
    setMessage("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    if (saving) return;
    const name = form.name.trim();
    if (!name) return setError("Enter the pharmacy or business name.");
    const openingBalance = Number(form.opening_balance);
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      return setError("Opening balance must be zero or a positive amount.");
    }

    const values = {
      name,
      contact_person: form.contact_person.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      opening_balance: openingBalance,
      notes: form.notes.trim() || null,
    };
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = editingId
        ? await supabase.from("customers").update(values).eq("id", editingId)
        : await supabase.from("customers").insert(values);
      if (result.error) {
        setError(`Could not ${editingId ? "update" : "create"} customer: ${result.error.message}`);
        return;
      }
      setMessage(editingId ? "Customer details updated." : "Customer created.");
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      await loadCustomers();
    } catch (saveError) {
      setError(`Could not save customer: ${saveError instanceof Error ? saveError.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleCustomerStatus(customer: Customer) {
    if (!canManage) return;
    const nextIsActive = !customer.is_active;
    if (customer.is_active && !window.confirm(`Deactivate ${customer.name}? The customer will remain saved and can be reactivated later.`)) return;

    setUpdatingStatusId(customer.id);
    setError("");
    setMessage("");
    try {
      const { error: updateError } = await supabase
        .from("customers")
        .update({ is_active: nextIsActive })
        .eq("id", customer.id)
        .select("id")
        .single();
      if (updateError) {
        setError(`Could not ${nextIsActive ? "reactivate" : "deactivate"} ${customer.name}: ${updateError.message}`);
        return;
      }
      setCustomers((current) => current.map((item) => item.id === customer.id ? { ...item, is_active: nextIsActive } : item));
      setSelectedCustomer((current) => current?.id === customer.id ? { ...current, is_active: nextIsActive } : current);
      setMessage(`${customer.name} ${nextIsActive ? "reactivated" : "deactivated"}.`);
    } catch (statusError) {
      setError(`Could not update customer status: ${statusError instanceof Error ? statusError.message : "Unknown error"}`);
    } finally {
      setUpdatingStatusId(null);
    }
  }

  async function selectCustomer(customer: Customer) {
    const requestId = ++historyRequest.current;
    setSelectedCustomer(customer);
    setInvoiceHistory([]);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      const invoices: Array<Omit<CustomerInvoice, "paid">> = [];
      for (let start = 0; ; start += PAGE_SIZE) {
        const { data, error: invoiceError } = await supabase.from("invoices")
          .select("id,invoice_number,invoice_date,total,status")
          .eq("customer_id", customer.id)
          .order("invoice_date", { ascending: false })
          .order("id", { ascending: true })
          .range(start, start + PAGE_SIZE - 1);
        if (invoiceError) throw invoiceError;
        const page = (data ?? []) as Array<Omit<CustomerInvoice, "paid">>;
        invoices.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      const paidByInvoice = new Map<string, number>();
      for (let offset = 0; offset < invoices.length; offset += PAGE_SIZE) {
        const invoiceIds = invoices.slice(offset, offset + PAGE_SIZE).map((invoice) => invoice.id);
        for (let start = 0; ; start += PAGE_SIZE) {
          const { data, error: paymentError } = await supabase.from("payments")
            .select("invoice_id,amount")
            .in("invoice_id", invoiceIds)
            .order("id", { ascending: true })
            .range(start, start + PAGE_SIZE - 1);
          if (paymentError) throw paymentError;
          const page = (data ?? []) as Array<{ invoice_id: string; amount: number }>;
          for (const payment of page) paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) ?? 0) + Number(payment.amount));
          if (page.length < PAGE_SIZE) break;
        }
      }
      if (historyRequest.current !== requestId) return;
      setInvoiceHistory(invoices.map((invoice) => ({ ...invoice, paid: paidByInvoice.get(invoice.id) ?? 0 })));
    } catch (historyLoadError) {
      if (historyRequest.current !== requestId) return;
      setHistoryError(`Could not load customer invoice history: ${historyLoadError instanceof Error ? historyLoadError.message : "Unexpected error."}`);
    } finally {
      if (historyRequest.current === requestId) setHistoryLoading(false);
    }
  }

  const visibleCustomers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((customer) => {
      const matchesSearch = !term || [customer.name, customer.contact_person, customer.phone, customer.address]
        .some((value) => value?.toLowerCase().includes(term));
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? customer.is_active : !customer.is_active);
      return matchesSearch && matchesStatus;
    });
  }, [customers, search, statusFilter]);

  const postedInvoices = invoiceHistory.filter((invoice) => invoice.status === "posted");
  const postedSales = postedInvoices.reduce((sum, invoice) => sum + Number(invoice.total), 0);
  const postedInvoiceIds = new Set(postedInvoices.map((invoice) => invoice.id));
  const postedPayments = invoiceHistory.reduce((sum, invoice) => sum + (postedInvoiceIds.has(invoice.id) ? invoice.paid : 0), 0);
  const postedOutstanding = postedInvoices.reduce((sum, invoice) => sum + Number(invoice.total) - invoice.paid, 0);

  if (checking) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#103D3C" }}>Checking access...</main>;

  const labelStyle: React.CSSProperties = { display: "grid", gap: 6, fontSize: 13, fontWeight: 600 };
  return (
    <main style={{ minHeight: "100vh", background: "#f5f8f6", color: "#111817", padding: "clamp(16px, 4vw, 36px)", fontFamily: "Arial, sans-serif" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <Link href="/admin" style={{ color: "#168C83", textDecoration: "none", fontSize: 14 }}>← Back to Dashboard</Link>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", margin: "24px 0" }}>
          <div><div style={{ color: "#168C83", fontSize: 11, fontWeight: 700, letterSpacing: 2 }}>BUSINESS MANAGEMENT</div><h1 style={{ color: "#103D3C", fontSize: 32, margin: "7px 0" }}>Customers</h1><p style={{ color: "#66736f", margin: 0 }}>Manage pharmacy and business accounts.</p></div>
          {canManage && <button type="button" onClick={() => { if (!canManage) return; if (showForm && !editingId) setShowForm(false); else { setEditingId(null); setForm(emptyForm); setError(""); setMessage(""); setShowForm(true); } }} style={{ background: "#168C83", color: "white", border: 0, borderRadius: 6, padding: "12px 18px", fontWeight: 700, cursor: "pointer" }}>{showForm && !editingId ? "Close form" : "+ Add customer"}</button>}
        </header>

        {message && <div role="status" style={{ padding: 13, marginBottom: 16, border: "1px solid #168C83", background: "#e5f2ef", borderRadius: 6 }}>{message}</div>}
        {error && <div role="alert" style={{ padding: 13, marginBottom: 16, border: "1px solid #c94d3d", background: "#fff0ed", color: "#8b2419", borderRadius: 6 }}>{error}</div>}

        {showForm && canManage && <form onSubmit={saveCustomer} style={{ background: "white", padding: "clamp(16px, 3vw, 24px)", border: "1px solid #cbd8d5", borderRadius: 8, marginBottom: 22 }}>
          <h2 style={{ color: "#103D3C", marginTop: 0 }}>{editingId ? "Edit customer" : "New customer"}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))", gap: 16 }}>
            <label style={labelStyle}>Pharmacy/business name *<input required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} /></label>
            <label style={labelStyle}>Contact Person<input maxLength={200} value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} style={inputStyle} /></label>
            <label style={labelStyle}>Phone<input type="tel" maxLength={40} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={inputStyle} /></label>
            <label style={labelStyle}>Opening Balance<input type="number" min="0" step="0.01" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} style={inputStyle} /></label>
            <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Address<textarea rows={2} maxLength={1000} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></label>
            <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Notes<textarea rows={3} maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} /></label>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            <button type="submit" disabled={saving} style={{ background: "#168C83", color: "white", border: 0, borderRadius: 6, padding: "11px 18px", fontWeight: 700, cursor: "pointer" }}>{saving ? "Saving..." : editingId ? "Save changes" : "Create customer"}</button>
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm); }} style={{ border: "1px solid #cbd8d5", borderRadius: 6, padding: "11px 18px", background: "white", cursor: "pointer" }}>Cancel</button>
          </div>
        </form>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 12, marginBottom: 16 }}>
          <input aria-label="Search customers" placeholder="Search business name, contact, phone, or address..." value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
          <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#103D3C", fontSize: 13, fontWeight: 600 }}>Status
            <select aria-label="Filter customers by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} style={{ ...inputStyle, width: "auto", minWidth: 150 }}>
              <option value="all">All customers</option><option value="active">Active</option><option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        <section style={{ background: "white", border: "1px solid #d6e1dd", borderRadius: 8, overflow: "hidden" }}>
          {loading ? <p style={{ padding: 22, color: "#66736f" }}>Loading customers...</p>
            : visibleCustomers.length === 0 ? <p style={{ padding: 22, color: "#66736f" }}>{customers.length === 0 ? "No customers yet. Add a customer to get started." : "No customers match your search."}</p>
            : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", textAlign: "left" }}>
              <thead><tr style={{ background: "#e5f2ef", color: "#103D3C" }}>{["BUSINESS", "CONTACT", "PHONE", "ADDRESS", "OPENING BALANCE", "STATUS", "NOTES", "ACTIONS"].map((title) => <th key={title} style={{ padding: 13, fontSize: 11, whiteSpace: "nowrap" }}>{title}</th>)}</tr></thead>
              <tbody>{visibleCustomers.map((customer) => <tr key={customer.id}>
                <td style={{ padding: 13, borderTop: "1px solid #edf1ef", fontWeight: 700 }}>{customer.name}</td>
                <td style={{ padding: 13, borderTop: "1px solid #edf1ef" }}>{customer.phone || "—"}</td>
                <td style={{ padding: 13, borderTop: "1px solid #edf1ef" }}>{customer.contact_person || "—"}</td>
                <td style={{ padding: 13, borderTop: "1px solid #edf1ef" }}>{customer.address || "—"}</td>
                <td style={{ padding: 13, borderTop: "1px solid #edf1ef", whiteSpace: "nowrap" }}>৳ {Number(customer.opening_balance).toFixed(2)}</td>
                <td style={{ padding: 13, borderTop: "1px solid #edf1ef" }}><span style={{ display: "inline-block", borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 700, color: customer.is_active ? "#17684c" : "#7b3e37", background: customer.is_active ? "#e5f2ef" : "#f8e9e6" }}>{customer.is_active ? "Active" : "Inactive"}</span></td>
                <td style={{ padding: 13, borderTop: "1px solid #edf1ef" }}>{customer.notes || "—"}</td>
                <td style={{ padding: 13, borderTop: "1px solid #edf1ef" }}><div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => void selectCustomer(customer)} style={{ border: "1px solid #168C83", color: "#103D3C", background: "white", borderRadius: 5, padding: "7px 11px", cursor: "pointer" }}>Details</button>
                  {canManage && <button type="button" onClick={() => editCustomer(customer)} style={{ border: "1px solid #168C83", color: "#103D3C", background: "white", borderRadius: 5, padding: "7px 11px", cursor: "pointer" }}>Edit</button>}
                  {canManage && <button type="button" disabled={updatingStatusId === customer.id} onClick={() => toggleCustomerStatus(customer)} style={{ border: "1px solid #cbd8d5", color: customer.is_active ? "#8b2419" : "#17684c", background: "white", borderRadius: 5, padding: "7px 11px", cursor: updatingStatusId === customer.id ? "wait" : "pointer", opacity: updatingStatusId === customer.id ? 0.6 : 1 }}>{updatingStatusId === customer.id ? "Saving..." : customer.is_active ? "Deactivate" : "Reactivate"}</button>}
                </div></td>
              </tr>)}</tbody>
            </table></div>}
        </section>
        <p style={{ color: "#66736f", fontSize: 12, marginTop: 12 }}>Customers shown: {visibleCustomers.length}</p>

        {selectedCustomer && <section aria-labelledby="customer-details-heading" style={{ marginTop: 26, background: "#fff", border: "1.5px solid #111817", boxShadow: "3px 3px 0 #111817", padding: "clamp(16px, 3vw, 24px)" }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
            <div><div style={{ color: "#168C83", fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>CUSTOMER DETAILS</div><h2 id="customer-details-heading" style={{ color: "#103D3C", margin: "7px 0 0", fontSize: 23 }}>{selectedCustomer.name}</h2></div>
            <button type="button" onClick={() => { historyRequest.current++; setSelectedCustomer(null); setInvoiceHistory([]); setHistoryError(""); }} style={{ border: "1px solid #cbd8d5", borderRadius: 5, padding: "8px 12px", background: "white", color: "#103D3C", cursor: "pointer" }}>Close details</button>
          </header>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: 12, marginBottom: 22 }}>
            {[["Business/customer name", selectedCustomer.name], ["Contact person", selectedCustomer.contact_person || "—"], ["Phone", selectedCustomer.phone || "—"], ["Address", selectedCustomer.address || "—"], ["Opening balance", formatMoney(Number(selectedCustomer.opening_balance) || 0)], ["Status", selectedCustomer.is_active ? "Active" : "Inactive"], ["Notes", selectedCustomer.notes || "—"]].map(([label, value]) => <div key={label} style={{ padding: 13, background: "#f5f8f6", border: "1px solid #d6e1dd", minWidth: 0 }}><div style={{ marginBottom: 6, color: "#66736f", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5 }}>{label}</div><div style={{ color: "#103D3C", fontSize: 13, lineHeight: 1.5, overflowWrap: "anywhere" }}>{value}</div></div>)}
          </div>

          <div style={{ marginBottom: 21 }}><h3 style={{ color: "#103D3C", fontSize: 16, margin: "0 0 11px" }}>Balance summary</h3><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 10 }}>
            {[["Posted invoice sales", formatMoney(postedSales)], ["Payments against posted invoices", formatMoney(postedPayments)], ["Outstanding against posted invoices", formatMoney(postedOutstanding)], ["Customer opening balance", formatMoney(Number(selectedCustomer.opening_balance) || 0)]].map(([label, value]) => <div key={label} style={{ padding: 14, border: "1px solid #b8ccc5", background: "#f0f8f6" }}><div style={{ color: "#66736f", fontSize: 11, lineHeight: 1.4 }}>{label}</div><strong style={{ display: "block", marginTop: 8, color: "#103D3C", fontSize: 17 }}>{historyLoading ? "Loading..." : historyError ? "Unavailable" : value}</strong></div>)}
          </div></div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}><h3 style={{ color: "#103D3C", fontSize: 16, margin: 0 }}>Invoice history</h3><span style={{ color: "#66736f", fontSize: 11 }}>Outstanding is shown for posted invoices only.</span></div>
          {historyError && <div role="alert" style={{ marginBottom: 12, padding: 12, border: "1px solid #c94d3d", background: "#fff0ed", color: "#8b2419", fontSize: 12 }}>{historyError}<button type="button" onClick={() => void selectCustomer(selectedCustomer)} style={{ marginLeft: 10, border: "1px solid #c94d3d", background: "#fff", padding: "6px 9px", color: "#8b2419", cursor: "pointer" }}>Retry</button></div>}
          <div style={{ overflowX: "auto", border: "1px solid #d6e1dd" }}>
            {historyLoading ? <p role="status" style={{ padding: 18, color: "#66736f", margin: 0 }}>Loading invoice history...</p> : historyError ? <p style={{ padding: 18, color: "#66736f", margin: 0 }}>Invoice history could not be loaded.</p> : invoiceHistory.length === 0 ? <p style={{ padding: 18, color: "#66736f", margin: 0 }}>No invoices found for this customer.</p> : <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse", textAlign: "left" }}>
              <thead><tr style={{ background: "#e5f2ef", color: "#103D3C" }}>{["INVOICE", "DATE", "TOTAL", "AMOUNT PAID", "OUTSTANDING", "STATUS"].map((label) => <th key={label} style={{ padding: 12, fontSize: 10, whiteSpace: "nowrap" }}>{label}</th>)}</tr></thead>
              <tbody>{invoiceHistory.map((invoice) => <tr key={invoice.id}><td style={{ padding: 12, borderTop: "1px solid #edf1ef", fontWeight: 700 }}>{invoice.invoice_number}</td><td style={{ padding: 12, borderTop: "1px solid #edf1ef", whiteSpace: "nowrap" }}>{formatInvoiceDate(invoice.invoice_date)}</td><td style={{ padding: 12, borderTop: "1px solid #edf1ef", whiteSpace: "nowrap" }}>{formatMoney(Number(invoice.total))}</td><td style={{ padding: 12, borderTop: "1px solid #edf1ef", whiteSpace: "nowrap" }}>{formatMoney(invoice.paid)}</td><td style={{ padding: 12, borderTop: "1px solid #edf1ef", whiteSpace: "nowrap", color: invoice.status === "posted" && Number(invoice.total) - invoice.paid > 0 ? "#8b2419" : "#103D3C" }}>{invoice.status === "posted" ? formatMoney(Number(invoice.total) - invoice.paid) : "—"}</td><td style={{ padding: 12, borderTop: "1px solid #edf1ef", whiteSpace: "nowrap" }}>{invoice.status}</td></tr>)}</tbody>
            </table>}
          </div>
        </section>}
      </div>
    </main>
  );
}
