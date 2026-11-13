"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Invoice = { id: string; invoice_number: string; customer_id: string | null; customer_name?: string | null; total: number; invoice_date: string; status: string };
type Customer = { id: string; name: string };
type Payment = { id: string; invoice_id: string; amount: number; payment_method: string; payment_date: string };
type Medicine = { id: string; name: string; strength: string | null; is_active: boolean; stock_quantity: number; purchase_cost_avg: number; min_stock_level: number | null };
type Movement = { id: string; medicine_id: string; movement_type: string; quantity_delta: number; previous_quantity: number; resulting_quantity: number; purchase_cost: number | null; created_at: string; reason: string | null; related_invoice_id: string | null };
type DashboardData = { invoices: Invoice[]; payments: Payment[]; medicines: Medicine[]; movements: Movement[]; customers: Customer[] };
type Attention = { title: string; detail: string; href: string; tone: "warning" | "urgent" | "neutral" };

const PAGE_SIZE = 500;
const TZ = "Asia/Dhaka";
const money = (value: number) => `৳ ${value.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateKey = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const prettyDate = (date = new Date()) => date.toLocaleDateString("en-BD", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const prettyTime = (date: string) => new Date(date).toLocaleString("en-BD", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

async function readAll<T>(loadPage: (start: number, end: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await loadPage(start, start + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function loadDashboard(): Promise<DashboardData> {
  const readInvoices = async () => {
    try {
      return await readAll<Invoice>((start, end) => supabase.from("invoices").select("id,invoice_number,customer_id,customer_name,total,invoice_date,status").order("invoice_date", { ascending: false }).range(start, end));
    } catch (reason) {
      if (!(reason instanceof Error) || !reason.message.toLowerCase().includes("customer_name")) throw reason;
      return readAll<Invoice>((start, end) => supabase.from("invoices").select("id,invoice_number,customer_id,total,invoice_date,status").order("invoice_date", { ascending: false }).range(start, end));
    }
  };
  const [invoices, payments, medicines, movements, customers] = await Promise.all([
    readInvoices(),
    readAll<Payment>((start, end) => supabase.from("payments").select("id,invoice_id,amount,payment_method,payment_date").order("payment_date", { ascending: false }).range(start, end)),
    readAll<Medicine>((start, end) => supabase.from("medicines").select("id,name,strength,is_active,stock_quantity,purchase_cost_avg,min_stock_level").order("name").range(start, end)),
    readAll<Movement>((start, end) => supabase.from("medicine_stock_movements").select("id,medicine_id,movement_type,quantity_delta,previous_quantity,resulting_quantity,purchase_cost,created_at,reason,related_invoice_id").order("created_at", { ascending: false }).range(start, end)),
    readAll<Customer>((start, end) => supabase.from("customers").select("id,name").order("name").range(start, end)),
  ]);
  return { invoices, payments, medicines, movements, customers };
}

function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/></>,
    invoice: <><path d="M7 3h8l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M15 3v5h5M9 13h6M9 17h6"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
    inventory: <><path d="m3 7 9-4 9 4-9 4-9-4Z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4M12 11v5"/></>,
    medicine: <><path d="m10 3 11 11a5 5 0 0 1-7 7L3 10a5 5 0 0 1 7-7Z"/><path d="m8 8 8 8"/></>,
    customer: <><circle cx="9" cy="8" r="4"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 4a4 4 0 0 1 0 8M18 15a5 5 0 0 1 3 4v2"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    box: <><path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></>,
    alert: <><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    collapse: <><path d="m15 18-6-6 6-6"/><path d="M20 4v16"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  };
  return <svg {...common}>{paths[name] ?? paths.overview}</svg>;
}

const NAV = [
  { label: "Overview", href: "/admin", icon: "overview" },
  { label: "Sales & invoices", href: "/admin/sales", icon: "invoice" },
  { label: "Sales history", href: "/admin/sales/history", icon: "history" },
  { label: "Inventory", href: "/admin/inventory", icon: "inventory" },
  { label: "Medicines", href: "/admin/medicines", icon: "medicine" },
  { label: "Customers", href: "/admin/customers", icon: "customer" },
];

export default function Admin() {
  const router = useRouter();
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [profileName, setProfileName] = useState("Business owner");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(true);
  const today = dateKey();

  useEffect(() => {
    let active = true;
    async function checkAccess() {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError || !session?.user) { router.replace("/login"); return; }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("role,full_name").eq("id", session.user.id).single();
      if (!active) return;
      if (profileError || profile?.role !== "owner") { setAccess("denied"); return; }
      setProfileName(profile.full_name?.trim() || session.user.email || "Business owner");
      setAccess("allowed");
    }
    checkAccess().catch(() => { if (active) setAccess("denied"); });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (access !== "allowed") return;
    let active = true;
    setLoading(true); setError("");
    loadDashboard().then((result) => { if (active) setData(result); }).catch((reason: unknown) => {
      if (!active) return;
      setData(null); setError(reason instanceof Error ? reason.message : "Dashboard data could not be loaded.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [access, refresh]);

  const summary = useMemo(() => {
    if (!data) return null;
    const posted = data.invoices.filter((invoice) => invoice.status === "posted");
    const postedIds = new Set(posted.map((invoice) => invoice.id));
    const paidByInvoice = new Map<string, number>();
    let collected = 0;
    const paymentRows = data.payments.filter((payment) => postedIds.has(payment.invoice_id));
    for (const payment of paymentRows) {
      const amount = Number(payment.amount) || 0;
      collected += amount;
      paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) ?? 0) + amount);
    }
    const sales = posted.filter((invoice) => invoice.invoice_date.slice(0, 10) === today).reduce((sum, invoice) => sum + (Number(invoice.total) || 0), 0);
    const outstanding = posted.reduce((sum, invoice) => sum + Math.max(0, (Number(invoice.total) || 0) - (paidByInvoice.get(invoice.id) ?? 0)), 0);
    const medicineById = new Map(data.medicines.map((medicine) => [medicine.id, medicine]));
    const customerById = new Map(data.customers.map((customer) => [customer.id, customer.name]));
    const activeMedicines = data.medicines.filter((medicine) => medicine.is_active);
    const lowStock = activeMedicines.filter((medicine) => Number(medicine.stock_quantity) <= (medicine.min_stock_level ?? 10));
    const attention: Attention[] = [];
    for (const medicine of lowStock.slice(0, 4)) attention.push({ title: medicine.name, detail: `${Number(medicine.stock_quantity).toLocaleString("en-BD")} units · minimum ${medicine.min_stock_level ?? 10}`, href: "/admin/inventory", tone: "warning" });
    const balancesByCustomer = new Map<string, number>();
    for (const invoice of posted) {
      const due = Math.max(0, (Number(invoice.total) || 0) - (paidByInvoice.get(invoice.id) ?? 0));
      const customerKey = invoice.customer_id ?? `walkin:${invoice.customer_name ?? invoice.id}`;
      if (due > 0) balancesByCustomer.set(customerKey, (balancesByCustomer.get(customerKey) ?? 0) + due);
    }
    const customerBalances = [...balancesByCustomer.entries()].sort((a, b) => b[1] - a[1]);
    for (const [customerKey, balance] of customerBalances.slice(0, Math.max(0, 5 - attention.length))) {
      const invoice = customerKey.startsWith("walkin:") ? posted.find((item) => `walkin:${item.customer_name ?? item.id}` === customerKey) : undefined;
      const customerName = invoice?.customer_name || customerById.get(customerKey) || "Customer";
      attention.push({ title: customerName, detail: `${money(balance)} outstanding across posted invoices`, href: "/admin/sales/history", tone: "neutral" });
    }
    const recentInvoices = posted.slice(0, 5);
    const recentPayments = paymentRows.slice(0, 5);
    const recentMovements = data.movements.slice(0, 5).map((movement) => ({ movement, medicine: medicineById.get(movement.medicine_id) }));
    return { sales, outstanding, collected, usableStock: activeMedicines.reduce((sum, medicine) => sum + Number(medicine.stock_quantity || 0), 0), lowStock: lowStock.length, recentInvoices, recentPayments, recentMovements, attention, medicineById, customerById, invoiceById: new Map(data.invoices.map((invoice) => [invoice.id, invoice])) };
  }, [data, today]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (access === "checking") return <main className="dashboard-gate"><div className="gate-mark">R</div><p>Verifying owner access…</p><DashboardStyles /></main>;
  if (access === "denied") return <main className="dashboard-gate"><section><span className="eyebrow">RESTRICTED WORKSPACE</span><h1>Owner access required</h1><p>This dashboard is available to the account owner.</p><Link href="/login">Return to sign in <Icon name="arrow" size={16}/></Link></section><DashboardStyles /></main>;

  const greetingHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const greeting = greetingHour < 12 ? "Good morning" : greetingHour < 17 ? "Good afternoon" : "Good evening";
  const metricCards = [
    { label: "Today’s sales", value: summary ? money(summary.sales) : "—", note: "Posted invoices today", icon: "invoice", accent: "mint" },
    { label: "Outstanding credit", value: summary ? money(summary.outstanding) : "—", note: "Posted invoices less payments", icon: "history", accent: "sand" },
    { label: "Total stock", value: summary ? `${summary.usableStock.toLocaleString("en-BD")} units` : "—", note: "Units across active medicines", icon: "box", accent: "lavender" },
  ];

  return <main className={`dashboard-shell${collapsed ? " is-collapsed" : ""}${mobileOpen ? " mobile-open" : ""}`}>
    <button className="drawer-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
    <aside className="dashboard-sidebar">
      <Link className="dashboard-brand" href="/admin" aria-label="Retina Marketing Solution dashboard"><span className="brand-symbol">R</span><span className="brand-words">RETINA<small>MARKETING SOLUTION</small></span></Link>
      <div className="sidebar-caption">WORKSPACE</div>
      <nav className="dashboard-nav" aria-label="Admin navigation">{NAV.map((item) => <Link key={item.href} href={item.href} className={item.href === "/admin" ? "nav-link nav-current" : "nav-link"} title={collapsed ? item.label : undefined} onClick={() => setMobileOpen(false)}><Icon name={item.icon}/><span>{item.label}</span>{item.href === "/admin" && <i className="active-dot"/>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-help"><span className="help-icon">i</span><span>Need help?<small>Your team workspace</small></span><Icon name="arrow" size={15}/></div><Link className="site-link" href="/"><span>↗</span> Back to website</Link><button className="collapse-button" type="button" onClick={() => setCollapsed((value) => !value)}><Icon name="collapse"/><span>Collapse sidebar</span></button></div>
    </aside>

    <section className="dashboard-main">
      <header className="dashboard-topbar">
        <div className="topbar-left"><button className="mobile-menu-button" type="button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Icon name="menu"/></button><div><div className="breadcrumb">RETINA <span>/</span> WORKSPACE</div><h1>Business overview</h1></div></div>
        <div className="topbar-right"><div className="date-chip"><Icon name="calendar" size={16}/><span>{prettyDate()}</span></div><div className="profile-wrap"><button className="profile-button" type="button" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}><span className="profile-avatar">{profileName.slice(0, 1).toUpperCase()}</span><span className="profile-label"><b>{profileName}</b><small>Owner account</small></span><span className="chevron">⌄</span></button>{profileOpen && <div className="profile-menu"><div><b>{profileName}</b><small>Owner account</small></div><button type="button" onClick={handleLogout}><Icon name="logout" size={16}/> Sign out</button></div>}</div></div>
      </header>

      <div className="dashboard-content">
        <section className="welcome-card entrance" style={{ "--delay": "0ms" } as React.CSSProperties}>
          <div className="welcome-copy"><span className="eyebrow"><i/> YOUR BUSINESS AT A GLANCE</span><h2>{greeting}, <em>{profileName.split(/[ @]/)[0]}.</em></h2><p>Keep sales moving, stock healthy, and customer accounts in view.</p><div className="welcome-actions"><Link className="primary-action" href="/admin/sales"><Icon name="plus" size={17}/> Create invoice <Icon name="arrow" size={15}/></Link><Link className="secondary-action" href="/admin/inventory"><Icon name="box" size={17}/> Receive stock</Link></div></div>
          <div className="welcome-art" aria-hidden="true"><div className="art-ring ring-one"/><div className="art-ring ring-two"/><div className="art-cross">+</div><div className="art-card"><span>RETINA</span><b>Care in every<br/>transaction.</b><i>R</i></div><span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✳</span></div>
        </section>

        {error && <div className="dashboard-error" role="alert"><Icon name="alert"/><span><b>Dashboard data is unavailable.</b> {error}</span><button type="button" onClick={() => setRefresh((value) => value + 1)}>Retry</button></div>}

        <section className="overview-section entrance" style={{ "--delay": "70ms" } as React.CSSProperties}>
          <div className="section-heading"><div><span className="eyebrow">LIVE BUSINESS DATA</span><h2>Business overview</h2></div><button className="refresh-button" type="button" aria-label="Refresh dashboard" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>↻ <span>Refresh</span></button></div>
          <div className="metric-grid">{metricCards.map((metric, index) => <Link key={metric.label} href={metric.label === "Total stock" ? "/admin/inventory" : "/admin/sales/history"} className={`metric-card accent-${metric.accent}`} style={{ "--card-delay": `${index * 45}ms` } as React.CSSProperties}><div className="metric-top"><span>{metric.label}</span><i><Icon name={metric.icon} size={18}/></i></div>{loading ? <div className="skeleton metric-skeleton"/> : <strong>{error ? "Unavailable" : metric.value}</strong>}<small>{metric.note}</small><span className="metric-edge"/></Link>)}</div>
        </section>

        <section id="quick-actions" className="quick-section entrance" style={{ "--delay": "140ms" } as React.CSSProperties}>
          <div className="section-heading"><div><span className="eyebrow">MOVE WORK FORWARD</span><h2>Quick actions</h2></div><span className="section-aside">SHORTCUTS</span></div>
          <div className="quick-grid">{[
            { title: "Create invoice", detail: "Record a sale", href: "/admin/sales", icon: "invoice", primary: true },
            { title: "Receive stock", detail: "Add medicine quantity", href: "/admin/inventory", icon: "box" },
            { title: "View inventory", detail: "Total medicine stock", href: "/admin/inventory", icon: "inventory" },
            { title: "Manage medicines", detail: "Catalogue & pricing", href: "/admin/medicines", icon: "medicine" },
            { title: "Sales history", detail: "Invoices & payments", href: "/admin/sales/history", icon: "history", secondary: true },
            { title: "Customers", detail: "Accounts & contacts", href: "/admin/customers", icon: "customer", secondary: true },
          ].filter((action) => !action.secondary || moreOpen).map((action) => <Link key={action.title} href={action.href} className={`quick-link${action.primary ? " quick-primary" : ""}`}><span className="quick-icon"><Icon name={action.icon}/></span><span className="quick-label"><b>{action.title}</b><small>{action.detail}</small></span><Icon name="arrow" size={16}/></Link>)}</div>
          <button className="more-actions" type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>{moreOpen ? "Show fewer actions" : "More · Sales history and customers"}</button>
        </section>

        <div className="activity-grid entrance" style={{ "--delay": "210ms" } as React.CSSProperties}>
          <section className="surface-card activity-card"><div className="card-heading"><div><span className="eyebrow">LATEST SALES</span><h2>Recent invoices</h2></div><Link href="/admin/sales/history">View history <Icon name="arrow" size={15}/></Link></div>
            {loading ? <div className="skeleton-list">{[0,1,2].map((item) => <div className="skeleton-row" key={item}><i/><span><b/><small/></span><em/></div>)}</div> : error ? <EmptyState title="Invoice activity unavailable" detail="Retry to load current invoice records."/> : !summary?.recentInvoices.length ? <EmptyState title="No posted invoices yet" detail="Posted sales will appear here when available."/> : <div className="activity-list">{summary.recentInvoices.map((invoice) => <div className="activity-row" key={invoice.id}><span className="activity-icon invoice-icon"><Icon name="invoice" size={17}/></span><span className="activity-primary"><b>{invoice.customer_name || summary.customerById.get(invoice.customer_id ?? "") || "Customer"}</b><small>{invoice.invoice_number} · {prettyTime(invoice.invoice_date)}</small></span><strong>{money(Number(invoice.total) || 0)}</strong><span className="status-pill">Posted</span></div>)}</div>}
          </section>
          <section className="surface-card attention-card"><div className="card-heading"><div><span className="eyebrow">NEEDS YOUR ATTENTION</span><h2>Operational alerts</h2></div><Link href="/admin/inventory">Inventory <Icon name="arrow" size={15}/></Link></div>
            {loading ? <div className="skeleton-list">{[0,1,2].map((item) => <div className="skeleton-row" key={item}><i/><span><b/><small/></span></div>)}</div> : error ? <EmptyState title="Alerts unavailable" detail="Retry to check stock and account activity."/> : !summary?.attention.length ? <EmptyState title="You’re all caught up" detail="No low-stock medicines or outstanding invoice balances were found."/> : <div className="attention-list">{summary.attention.slice(0, alertsExpanded ? undefined : 3).map((item, index) => <Link className="attention-row" key={`${item.title}-${index}`} href={item.href}><span className={`attention-icon ${item.tone}`}><Icon name={item.tone === "neutral" ? "history" : "alert"} size={16}/></span><span><b>{item.title}</b><small>{item.detail}</small></span><Icon name="arrow" size={15}/></Link>)}</div>}
            {!loading && summary && summary.attention.length > 3 && <button className="more-actions" type="button" aria-expanded={alertsExpanded} onClick={() => setAlertsExpanded((open) => !open)}>{alertsExpanded ? "Show fewer alerts" : `See all ${summary.attention.length} alerts`}</button>}
            {!loading && summary && <div className="attention-foot"><span>{summary.lowStock} low stock</span><span>{summary.attention.filter((item) => item.tone === "neutral").length} customer balances</span></div>}
          </section>
        </div>

        <section className="surface-card activity-lower entrance" style={{ "--delay": "280ms" } as React.CSSProperties}>
          <div className="lower-column"><div className="card-heading"><div><span className="eyebrow">CASH FLOW</span><h2>Recent payments</h2></div><Link href="/admin/sales/history">Sales history <Icon name="arrow" size={15}/></Link></div>
            {loading ? <div className="skeleton-list">{[0,1,2].map((item) => <div className="skeleton-row" key={item}><i/><span><b/><small/></span><em/></div>)}</div> : error ? <EmptyState title="Payment activity unavailable" detail="Retry to load payment records."/> : !summary?.recentPayments.length ? <EmptyState title="No payments recorded" detail="Payments on posted invoices appear here."/> : <div className="activity-list compact-list">{summary.recentPayments.map((payment) => { const invoice = summary.invoiceById.get(payment.invoice_id); return <div className="activity-row" key={payment.id}><span className="activity-icon payment-icon">৳</span><span className="activity-primary"><b>{invoice?.customer_name || summary.customerById.get(invoice?.customer_id ?? "") || "Customer"}</b><small>{invoice?.invoice_number ?? "Invoice"} · {payment.payment_method.replaceAll("_", " ")} · {prettyTime(payment.payment_date)}</small></span><strong className="payment-amount">+{money(Number(payment.amount) || 0)}</strong></div>; })}</div>}
          </div>
          <div className="lower-column movement-column"><div className="card-heading"><div><span className="eyebrow">STOCK CONTROL</span><h2>Recent stock movements</h2></div><Link href="/admin/inventory">View inventory <Icon name="arrow" size={15}/></Link></div>
            {loading ? <div className="skeleton-list">{[0,1,2].map((item) => <div className="skeleton-row" key={item}><i/><span><b/><small/></span><em/></div>)}</div> : error ? <EmptyState title="Stock activity unavailable" detail="Retry to load stock movements."/> : !summary?.recentMovements.length ? <EmptyState title="No stock movements yet" detail="Receipts, sales, and corrections appear here."/> : <div className="activity-list compact-list">{summary.recentMovements.map(({ movement, medicine }) => <div className="activity-row" key={movement.id}><span className="activity-icon stock-icon"><Icon name="box" size={17}/></span><span className="activity-primary"><b>{medicine?.name ?? "Medicine"}</b><small>{movement.movement_type.replaceAll("_", " ")} · {prettyTime(movement.created_at)}</small></span><strong className="movement-quantity">{movement.quantity_delta > 0 ? "+" : ""}{movement.quantity_delta} units</strong></div>)}</div>}
          </div>
        </section>
        <footer className="dashboard-footer"><span><b>RETINA</b> · BUSINESS OPERATIONS</span><span>Live data · Updated {new Intl.DateTimeFormat("en-BD", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date())}</span></footer>
      </div>
    </section>
    <nav className="mobile-bottom-nav" aria-label="Quick navigation"><Link href="/admin" aria-current="page"><Icon name="overview" size={20}/><span>Home</span></Link><Link className="bottom-create" href="/admin/sales"><Icon name="plus" size={22}/><span>Create</span></Link><Link href="/admin/inventory"><Icon name="inventory" size={20}/><span>Inventory</span></Link><Link href="/admin/sales/history"><Icon name="history" size={20}/><span>Sales</span></Link><button type="button" aria-expanded={moreOpen} onClick={() => { setMoreOpen(true); document.getElementById("quick-actions")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}><Icon name="menu" size={20}/><span>More</span></button></nav>
    <DashboardStyles />
  </main>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><span>—</span><b>{title}</b><small>{detail}</small></div>; }

function DashboardStyles() {
  return <style jsx global>{`
    *{box-sizing:border-box}.dashboard-shell{--sidebar-width:254px;min-height:100vh;display:grid;grid-template-columns:var(--sidebar-width) minmax(0,1fr);background:#f2f6f4;color:#172c2b;font-family:Arial,Helvetica,sans-serif;transition:grid-template-columns .24s ease}.dashboard-shell.is-collapsed{--sidebar-width:78px}.dashboard-sidebar{position:sticky;top:0;display:flex;height:100vh;min-height:620px;flex-direction:column;padding:24px 16px 18px;background:#103d3c;color:#fff;overflow:hidden;z-index:40;transition:width .24s ease,padding .24s ease}.dashboard-brand{display:flex;align-items:center;gap:12px;min-height:48px;margin:0 2px 43px;color:#fff;text-decoration:none;white-space:nowrap}.brand-symbol{display:grid;width:39px;height:39px;flex:0 0 39px;place-items:center;border:1px solid #0c2827;background:#9de3d8;color:#103d3c;font-family:Georgia,serif;font-size:23px}.brand-words{font-size:15px;font-weight:800;letter-spacing:.11em}.brand-words small{display:block;margin-top:4px;color:#91b6ad;font-size:8px;font-weight:500;letter-spacing:.12em}.sidebar-caption{margin:0 0 10px 12px;color:#91b6ad;font-size:9px;font-weight:700;letter-spacing:.16em;white-space:nowrap}.dashboard-nav{display:grid;gap:5px}.nav-link{position:relative;display:flex;align-items:center;gap:13px;min-height:46px;padding:0 12px;border:1px solid transparent;color:#c3d7d2;text-decoration:none;font-size:12px;font-weight:600;white-space:nowrap;transition:background .18s,color .18s,border-color .18s,transform .18s}.nav-link svg{flex:0 0 20px}.nav-link:hover{transform:translateX(2px);background:#194c49;color:#fff}.nav-current,.nav-current:hover{border-color:#071f1e;background:#9de3d8;color:#103d3c;box-shadow:3px 3px 0 #071f1e}.active-dot{width:6px;height:6px;margin-left:auto;border-radius:50%;background:#168c83}.sidebar-bottom{display:grid;gap:9px;margin-top:auto}.sidebar-help{display:flex;align-items:center;gap:10px;margin:0 3px 14px;padding:12px 10px;border:1px solid #315e59;color:#d7e7e2;font-size:10px}.sidebar-help>span:nth-child(2){flex:1}.sidebar-help small{display:block;margin-top:4px;color:#91b6ad;font-size:9px}.help-icon{display:grid;width:23px;height:23px;place-items:center;border:1px solid #80aaa1;border-radius:50%;font-family:Georgia,serif}.site-link,.collapse-button{display:flex;align-items:center;gap:12px;min-height:40px;padding:0 12px;border:0;background:none;color:#c3d7d2;text-align:left;text-decoration:none;font:600 11px Arial,sans-serif;white-space:nowrap;cursor:pointer}.site-link:hover,.collapse-button:hover{color:white}.site-link span{width:20px;text-align:center;font-size:16px}.collapse-button{border-top:1px solid #315e59;margin-top:7px;padding-top:10px}.is-collapsed .dashboard-sidebar{padding-right:12px;padding-left:12px}.is-collapsed .brand-words,.is-collapsed .sidebar-caption,.is-collapsed .nav-link>span,.is-collapsed .active-dot,.is-collapsed .sidebar-help>span:nth-child(2),.is-collapsed .sidebar-help>svg,.is-collapsed .site-link,.is-collapsed .collapse-button span{display:none}.is-collapsed .dashboard-brand{justify-content:center;margin-right:0;margin-left:0}.is-collapsed .nav-link{justify-content:center;padding:0}.is-collapsed .sidebar-help{justify-content:center;padding:9px 0}.is-collapsed .collapse-button{justify-content:center}.is-collapsed .collapse-button svg{transform:rotate(180deg)}
    .dashboard-main{min-width:0}.dashboard-topbar{position:relative;z-index:20;display:flex;min-height:84px;align-items:center;justify-content:space-between;gap:20px;padding:14px clamp(18px,3vw,42px);border-bottom:1px solid #dce7e2;background:#fff}.topbar-left,.topbar-right{display:flex;align-items:center;gap:16px}.breadcrumb{color:#778984;font-size:9px;font-weight:700;letter-spacing:.13em}.breadcrumb span{padding:0 6px;color:#a4b4af}.topbar-left h1{margin:6px 0 0;color:#103d3c;font-size:19px;letter-spacing:-.02em}.date-chip{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid #e1e9e6;background:#fbfdfc;color:#52645f;font-size:10px;font-weight:600}.date-chip svg{color:#168c83}.profile-wrap{position:relative}.profile-button{display:flex;align-items:center;gap:10px;padding:3px;border:0;background:transparent;text-align:left;cursor:pointer}.profile-avatar{display:grid;width:37px;height:37px;place-items:center;border:1px solid #0e322f;background:#9de3d8;color:#103d3c;font-family:Georgia,serif;font-size:17px;font-weight:700}.profile-label b,.profile-label small{display:block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.profile-label b{color:#23403d;font-size:10px}.profile-label small{margin-top:4px;color:#82918c;font-size:9px}.chevron{color:#61716c}.profile-menu{position:absolute;top:calc(100% + 10px);right:0;width:215px;padding:10px;border:1px solid #cbd8d5;background:#fff;box-shadow:3px 3px 0 #103d3c;z-index:50}.profile-menu>div{padding:7px 8px 12px;border-bottom:1px solid #e7eeeb}.profile-menu b,.profile-menu small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.profile-menu b{font-size:11px}.profile-menu small{margin-top:4px;color:#73837e;font-size:10px}.profile-menu button{display:flex;width:100%;align-items:center;gap:9px;padding:10px 8px 7px;border:0;background:#fff;color:#8a3a32;text-align:left;font-size:11px;font-weight:700;cursor:pointer}.mobile-menu-button{display:none}
    .dashboard-content{width:min(100%,1500px);margin:0 auto;padding:29px clamp(16px,3vw,42px) 22px}.welcome-card{position:relative;display:flex;min-height:238px;align-items:center;justify-content:space-between;overflow:hidden;padding:clamp(24px,4vw,42px);border:1.5px solid #102f2e;background:#fff;box-shadow:4px 4px 0 #103d3c}.welcome-copy{position:relative;z-index:2;max-width:590px}.eyebrow{display:inline-flex;align-items:center;gap:8px;color:#168c83;font-family:ui-monospace,Consolas,monospace;font-size:9px;font-weight:700;letter-spacing:.12em}.eyebrow i{width:7px;height:7px;border-radius:50%;background:#168c83}.welcome-copy h2{margin:15px 0 8px;color:#103d3c;font-size:clamp(27px,3.5vw,39px);letter-spacing:-.055em}.welcome-copy h2 em{font-family:Georgia,serif;font-weight:400}.welcome-copy p{margin:0;color:#667772;font-size:12px;line-height:1.6}.welcome-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:23px}.primary-action,.secondary-action{display:flex;min-height:41px;align-items:center;gap:9px;padding:0 14px;border:1px solid #103d3c;text-decoration:none;font-size:10px;font-weight:700;transition:transform .16s,box-shadow .16s,background .16s}.primary-action{background:#168c83;color:#fff}.primary-action svg:last-child{margin-left:7px}.secondary-action{background:#fff;color:#103d3c}.primary-action:hover,.secondary-action:hover{transform:translateY(-2px);box-shadow:2px 3px 0 #103d3c}.welcome-art{position:absolute;top:0;right:0;width:39%;height:100%;overflow:hidden;background:#eaf5f1}.welcome-art:before{position:absolute;top:-130px;right:-130px;width:360px;height:360px;border:1px solid #b7d8cf;border-radius:50%;content:""}.art-ring{position:absolute;border:1px solid #acd1c7;border-radius:50%}.ring-one{top:26px;right:59px;width:190px;height:190px}.ring-two{top:47px;right:80px;width:148px;height:148px}.art-cross{position:absolute;top:26px;right:43px;color:#168c83;font:30px Georgia,serif}.art-card{position:absolute;top:50%;right:27%;display:flex;width:178px;height:121px;flex-direction:column;justify-content:space-between;padding:16px;transform:translateY(-50%) rotate(-5deg);border:1px solid #103d3c;background:#fff;box-shadow:5px 5px 0 #9de3d8}.art-card>span{color:#168c83;font:700 8px ui-monospace,monospace;letter-spacing:.16em}.art-card>b{color:#103d3c;font:700 14px/1.25 Georgia,serif}.art-card>i{position:absolute;right:13px;bottom:8px;color:#c9e8df;font:italic 38px Georgia,serif}.art-spark{position:absolute;color:#168c83;font-size:17px}.spark-one{right:18%;bottom:21%}.spark-two{top:24%;left:23%;font-size:11px}
    .overview-section,.quick-section{margin-top:31px}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:14px}.section-heading h2,.card-heading h2{margin:6px 0 0;color:#163d39;font-size:18px;letter-spacing:-.03em}.section-aside{color:#8b9994;font:9px ui-monospace,monospace;letter-spacing:.1em}.refresh-button{padding:6px 9px;border:1px solid #d1dfda;background:#fff;color:#55706a;font-size:15px;cursor:pointer}.refresh-button span{font-size:9px;font-weight:700}.refresh-button:disabled{opacity:.5;cursor:wait}.metric-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.metric-card{position:relative;display:flex;min-width:0;min-height:137px;flex-direction:column;padding:16px 15px 14px;overflow:hidden;border:1px solid #d4e0dc;background:#fff;transition:transform .2s,box-shadow .2s,border-color .2s;animation:card-rise .5s both;animation-delay:var(--card-delay)}.metric-card:hover{transform:translateY(-3px);border-color:#8cbab0;box-shadow:3px 4px 0 #c3dcd4}.metric-top{display:flex;align-items:center;justify-content:space-between;gap:7px;color:#65756f;font-size:10px;font-weight:700}.metric-top i{display:grid;width:30px;height:30px;flex:0 0 30px;place-items:center;border:1px solid #dce9e4;background:#f5faf8;color:#168c83;font-style:normal}.metric-card>strong{margin-top:10px;color:#103d3c;font-size:clamp(17px,1.8vw,24px);letter-spacing:-.04em;white-space:nowrap}.metric-card>small{margin-top:auto;padding-top:9px;color:#84918c;font-size:9px;line-height:1.4}.metric-edge{position:absolute;right:0;bottom:0;left:0;height:3px;background:#9de3d8}.accent-sand .metric-edge{background:#e6c98b}.accent-blue .metric-edge{background:#a7c8df}.accent-lavender .metric-edge{background:#c9b7df}.accent-rose .metric-edge{background:#dfaaaa}.accent-sand .metric-top i{color:#96701f}.accent-blue .metric-top i{color:#477b9e}.accent-lavender .metric-top i{color:#765c96}.accent-rose .metric-top i{color:#a4504b}
    .quick-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.quick-link{display:flex;min-width:0;min-height:69px;align-items:center;gap:12px;padding:11px 13px;border:1px solid #d5e1dd;background:#fff;color:#244340;text-decoration:none;transition:transform .18s,border-color .18s,box-shadow .18s}.quick-link:hover{transform:translateY(-2px);border-color:#78aa9f;box-shadow:2px 3px 0 #bdd8d0}.quick-link>svg:last-child{margin-left:auto;color:#82938e}.quick-icon{display:grid;width:37px;height:37px;flex:0 0 37px;place-items:center;border:1px solid #cfe2dc;background:#f2faf7;color:#168c83}.quick-label{min-width:0}.quick-label b,.quick-label small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.quick-label b{font-size:10px}.quick-label small{margin-top:5px;color:#80908a;font-size:9px}.quick-primary{border-color:#103d3c;background:#e9f5f1;box-shadow:2px 2px 0 #103d3c}.quick-primary .quick-icon{border-color:#168c83;background:#168c83;color:white}
    .activity-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(320px,.85fr);gap:14px;margin-top:24px}.surface-card{min-width:0;border:1px solid #d1ded9;background:#fff;box-shadow:2px 2px 0 #dbe6e2}.activity-card,.attention-card{padding:18px}.card-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}.card-heading h2{font-size:16px}.card-heading>a{display:flex;align-items:center;gap:5px;color:#168c83;text-decoration:none;font-size:9px;font-weight:700;white-space:nowrap}.activity-list,.attention-list{display:grid}.activity-row{display:flex;min-width:0;align-items:center;gap:10px;padding:11px 0;border-top:1px solid #edf1ef}.activity-icon{display:grid;width:33px;height:33px;flex:0 0 33px;place-items:center;border:1px solid #dce9e4;background:#f3faf7;color:#168c83}.payment-icon{font-family:Georgia,serif;font-weight:700}.stock-icon{color:#708d3b}.activity-primary{flex:1;min-width:0}.activity-primary b,.activity-primary small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity-primary b{color:#28413d;font-size:10px}.activity-primary small{margin-top:4px;color:#8a9893;font-size:8px}.activity-row>strong{color:#214540;font-size:10px;white-space:nowrap}.status-pill{padding:5px 7px;background:#e9f5f1;color:#25806f;font-size:8px;font-weight:700}.attention-row{display:flex;min-width:0;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #edf1ef;color:#2d4541;text-decoration:none}.attention-row>span:nth-child(2){flex:1;min-width:0}.attention-row b,.attention-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.attention-row b{font-size:9px}.attention-row small{margin-top:4px;color:#899690;font-size:8px}.attention-row>svg{color:#8da09a}.attention-icon{display:grid;width:29px;height:29px;flex:0 0 29px;place-items:center;background:#fff4e2;color:#af7716}.attention-icon.urgent{background:#fff0ed;color:#ab4c40}.attention-icon.neutral{background:#f1f5f4;color:#74847f}.attention-foot{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;padding-top:11px;border-top:1px solid #edf1ef}.attention-foot span{padding:5px 7px;background:#f3f7f5;color:#71817b;font-size:8px}.activity-lower{display:grid;grid-template-columns:1fr 1fr;margin-top:14px;padding:18px}.lower-column{min-width:0}.movement-column{padding-left:18px;border-left:1px solid #e2ebe7}.compact-list .activity-row{padding:9px 0}.payment-amount{color:#168c83!important}.movement-quantity{color:#677d43!important}.empty-state{display:grid;min-height:128px;align-content:center;justify-items:center;gap:7px;padding:18px;border-top:1px solid #edf1ef;text-align:center}.empty-state>span{display:grid;width:27px;height:27px;place-items:center;border:1px solid #dce9e4;color:#168c83}.empty-state b{color:#3c5651;font-size:10px}.empty-state small{max-width:260px;color:#8a9893;font-size:9px;line-height:1.5}.dashboard-footer{display:flex;justify-content:space-between;gap:10px;padding:19px 3px 4px;color:#94a19c;font-size:8px;letter-spacing:.04em}.dashboard-footer b{color:#59716a;letter-spacing:.14em}.dashboard-error{display:flex;align-items:center;gap:10px;margin:15px 0 0;padding:12px;border:1px solid #dfb7b1;background:#fff4f1;color:#85473f;font-size:10px}.dashboard-error>span{flex:1}.dashboard-error button{padding:7px 10px;border:1px solid #be8178;background:white;color:#85473f;font-size:9px;font-weight:700;cursor:pointer}.skeleton{position:relative;overflow:hidden;background:#edf2f0}.skeleton:after{position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,#fff,transparent);animation:shimmer 1.4s infinite;content:""}.metric-skeleton{width:68%;height:26px;margin-top:11px}.skeleton-list{display:grid}.skeleton-row{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid #edf1ef}.skeleton-row>i{width:33px;height:33px;background:#edf2f0}.skeleton-row>span{flex:1}.skeleton-row b,.skeleton-row small,.skeleton-row em{display:block;height:8px;background:#edf2f0}.skeleton-row b{width:55%;margin-bottom:7px}.skeleton-row small{width:76%;height:6px}.skeleton-row em{width:43px}.dashboard-gate{display:grid;min-height:100vh;align-content:center;justify-items:center;gap:13px;background:#f2f6f4;color:#52645f;font-size:12px}.gate-mark{display:grid;width:44px;height:44px;place-items:center;border:1px solid #103d3c;background:#9de3d8;color:#103d3c;font:26px Georgia,serif}.dashboard-gate section{width:min(440px,calc(100% - 36px));padding:28px;border:1px solid #cbd8d5;background:#fff;box-shadow:4px 4px 0 #103d3c}.dashboard-gate h1{margin:11px 0;color:#103d3c;font-size:24px}.dashboard-gate p{color:#70817b;font-size:12px;line-height:1.6}.dashboard-gate a{display:flex;align-items:center;gap:7px;color:#168c83;text-decoration:none;font-size:11px;font-weight:700}
    .entrance{animation:enter .45s both;animation-delay:var(--delay)}@keyframes enter{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:translateY(0)}}@keyframes card-rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}@keyframes shimmer{to{transform:translateX(100%)}}
    /* Shared circular color inversion for the dashboard's interactive controls. */
    .dashboard-shell :is(.nav-link,.site-link,.collapse-button,.profile-button,.profile-menu button,.mobile-menu-button,.primary-action,.secondary-action,.refresh-button,.quick-link,.card-heading>a,.attention-row,.dashboard-error button){
      --circle-fill:#168c83;--circle-ink:#fff;position:relative;isolation:isolate;overflow:hidden;
      transition:color 280ms cubic-bezier(.22,1,.36,1),background-color 280ms cubic-bezier(.22,1,.36,1),border-color .18s,transform .18s,box-shadow .18s;
      -webkit-tap-highlight-color:transparent
    }
    .dashboard-shell :is(.nav-link,.site-link,.collapse-button,.profile-button,.profile-menu button,.mobile-menu-button,.primary-action,.secondary-action,.refresh-button,.quick-link,.card-heading>a,.attention-row,.dashboard-error button)::before{
      position:absolute;z-index:-1;top:50%;left:50%;width:150%;aspect-ratio:1;border-radius:50%;background:var(--circle-fill);content:"";pointer-events:none;
      transform:translate(-50%,-50%) scale(0);transition:transform 300ms cubic-bezier(.22,1,.36,1)
    }
    .dashboard-shell :is(.nav-link,.site-link,.collapse-button,.profile-button,.profile-menu button,.mobile-menu-button,.primary-action,.secondary-action,.refresh-button,.quick-link,.card-heading>a,.attention-row,.dashboard-error button):is(:hover,:focus-visible){color:var(--circle-ink)}
    .dashboard-shell :is(.nav-link,.site-link,.collapse-button,.profile-button,.profile-menu button,.mobile-menu-button,.primary-action,.secondary-action,.refresh-button,.quick-link,.card-heading>a,.attention-row,.dashboard-error button):is(:hover,:focus-visible)::before{transform:translate(-50%,-50%) scale(3)}
    .dashboard-shell :is(.nav-link,.site-link,.collapse-button,.profile-button,.profile-menu button,.mobile-menu-button,.primary-action,.secondary-action,.refresh-button,.quick-link,.card-heading>a,.attention-row,.dashboard-error button):is(:hover,:focus-visible)>*,
    .dashboard-shell :is(.nav-link,.site-link,.collapse-button,.profile-button,.profile-menu button,.mobile-menu-button,.primary-action,.secondary-action,.refresh-button,.quick-link,.card-heading>a,.attention-row,.dashboard-error button):is(:hover,:focus-visible) svg{color:inherit}
    .dashboard-shell :is(.nav-link,.site-link,.collapse-button,.profile-button,.profile-menu button,.mobile-menu-button,.primary-action,.secondary-action,.refresh-button,.quick-link,.card-heading>a,.attention-row,.dashboard-error button):is(:hover,:focus-visible) *{color:inherit}
    .dashboard-shell .nav-link{--circle-fill:#9de3d8;--circle-ink:#103d3c}
    .dashboard-shell .nav-current{--circle-fill:#103d3c;--circle-ink:#fff}
    .dashboard-shell .site-link,.dashboard-shell .collapse-button{--circle-fill:#9de3d8;--circle-ink:#103d3c}
    .dashboard-shell .profile-button,.dashboard-shell .mobile-menu-button{--circle-fill:#103d3c;--circle-ink:#fff}
    .dashboard-shell .profile-menu button{--circle-fill:#8a3a32;--circle-ink:#fff}
    .dashboard-shell .primary-action,.dashboard-shell .quick-primary{--circle-fill:#fff;--circle-ink:#168c83}
    .dashboard-shell .secondary-action,.dashboard-shell .quick-link,.dashboard-shell .refresh-button,.dashboard-shell .card-heading>a{--circle-fill:#168c83;--circle-ink:#fff}
    .dashboard-shell .quick-link:hover .quick-icon,.dashboard-shell .quick-link:focus-visible .quick-icon{border-color:currentColor;background:transparent;color:inherit}
    .dashboard-shell .quick-link:hover .quick-label small,.dashboard-shell .quick-link:focus-visible .quick-label small{color:inherit}
    .dashboard-shell .attention-row{--circle-fill:#103d3c;--circle-ink:#fff}
    .dashboard-shell .attention-row:hover .attention-icon.warning,.dashboard-shell .attention-row:focus-visible .attention-icon.warning{color:#af7716}
    .dashboard-shell .attention-row:hover .attention-icon.urgent,.dashboard-shell .attention-row:focus-visible .attention-icon.urgent{color:#ab4c40}
    .dashboard-shell .attention-row:hover .attention-icon.neutral,.dashboard-shell .attention-row:focus-visible .attention-icon.neutral{color:#52645f}
    .dashboard-shell .dashboard-error button{--circle-fill:#85473f;--circle-ink:#fff}
    .dashboard-shell :is(.nav-link,.site-link,.collapse-button,.profile-button,.profile-menu button,.mobile-menu-button,.primary-action,.secondary-action,.refresh-button,.quick-link,.card-heading>a,.attention-row,.dashboard-error button):focus-visible{outline:2px solid #168c83;outline-offset:3px}
    @media(hover:none){.dashboard-shell :is(.nav-link,.site-link,.collapse-button,.profile-button,.profile-menu button,.mobile-menu-button,.primary-action,.secondary-action,.refresh-button,.quick-link,.card-heading>a,.attention-row,.dashboard-error button):hover::before{transform:translate(-50%,-50%) scale(0)}.dashboard-shell :is(.nav-link,.site-link,.collapse-button,.profile-button,.profile-menu button,.mobile-menu-button,.primary-action,.secondary-action,.refresh-button,.quick-link,.card-heading>a,.attention-row,.dashboard-error button):active::before{transform:translate(-50%,-50%) scale(3)}}
    @media(prefers-reduced-motion:reduce){.dashboard-shell :is(.nav-link,.site-link,.collapse-button,.profile-button,.profile-menu button,.mobile-menu-button,.primary-action,.secondary-action,.refresh-button,.quick-link,.card-heading>a,.attention-row,.dashboard-error button)::before{transition:none}}
    .drawer-scrim{display:none}
    @media(max-width:1200px){.dashboard-shell{--sidebar-width:220px}.dashboard-content{padding-right:24px;padding-left:24px}.metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.metric-card{min-height:126px}.welcome-art{width:33%}}
    @media(max-width:900px){.dashboard-shell,.dashboard-shell.is-collapsed{display:block}.dashboard-sidebar{position:fixed;left:0;top:0;width:270px;min-height:100vh;transform:translateX(-105%);transition:transform .24s ease;box-shadow:5px 0 20px #092c2b30}.mobile-open .dashboard-sidebar{transform:translateX(0)}.drawer-scrim{position:fixed;inset:0;z-index:35;display:block;visibility:hidden;border:0;background:#092c2b80;opacity:0;transition:opacity .2s,visibility .2s}.mobile-open .drawer-scrim{visibility:visible;opacity:1}.dashboard-shell.is-collapsed .dashboard-sidebar{width:270px;padding:24px 16px 18px}.is-collapsed .dashboard-sidebar .brand-words,.is-collapsed .dashboard-sidebar .sidebar-caption,.is-collapsed .dashboard-sidebar .nav-link>span,.is-collapsed .dashboard-sidebar .active-dot,.is-collapsed .dashboard-sidebar .sidebar-help>span:nth-child(2),.is-collapsed .dashboard-sidebar .sidebar-help>svg,.is-collapsed .dashboard-sidebar .site-link,.is-collapsed .dashboard-sidebar .collapse-button span{display:initial}.dashboard-sidebar .collapse-button,.dashboard-sidebar .site-link{display:none}.dashboard-brand{margin-bottom:36px}.dashboard-nav{gap:7px}.dashboard-nav .nav-link{min-height:48px}.metric-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.activity-grid{grid-template-columns:1fr 1fr}.welcome-art{width:32%}}
    @media(max-width:680px){.dashboard-topbar{min-height:69px;padding:11px 15px}.mobile-menu-button{display:grid;width:36px;height:36px;place-items:center;border:1px solid #d6e2dd;background:#fff;color:#103d3c}.topbar-left{gap:10px}.topbar-left h1{font-size:16px}.topbar-right{gap:7px}.date-chip{width:36px;height:36px;justify-content:center;padding:0}.date-chip span{display:none}.profile-label,.chevron{display:none}.profile-button{padding:0}.profile-avatar{width:35px;height:35px}.dashboard-content{padding:17px 14px 18px}.welcome-card{min-height:232px;padding:23px 20px}.welcome-copy{max-width:90%}.welcome-copy h2{font-size:29px}.welcome-copy p{max-width:260px;font-size:11px}.welcome-art{right:-95px;width:58%;opacity:.44}.art-card{right:27%;transform:translateY(-50%) rotate(-5deg) scale(.8)}.welcome-actions{margin-top:18px}.primary-action,.secondary-action{min-height:39px;padding:0 10px;font-size:9px}.overview-section,.quick-section{margin-top:25px}.section-heading h2{font-size:17px}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.metric-card{min-height:124px;padding:13px 12px}.metric-top{font-size:9px}.metric-top i{width:27px;height:27px;flex-basis:27px}.metric-card>strong{font-size:19px}.metric-card>small{font-size:8px}.quick-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.quick-link{min-height:65px;gap:8px;padding:9px}.quick-icon{width:31px;height:31px;flex-basis:31px}.quick-label b{font-size:9px}.quick-label small{font-size:8px}.quick-link>svg:last-child{width:13px;flex:0 0 13px}.activity-grid{grid-template-columns:1fr;gap:10px;margin-top:20px}.activity-card,.attention-card{padding:14px}.activity-lower{grid-template-columns:1fr;gap:20px;padding:14px}.movement-column{padding:17px 0 0;border-top:1px solid #e2ebe7;border-left:0}.card-heading h2{font-size:15px}.dashboard-footer{flex-direction:column}.profile-menu{position:fixed;top:60px;right:12px}}
    @media(max-width:390px){.breadcrumb{font-size:8px}.topbar-left h1{font-size:14px}.welcome-card{padding-right:14px;padding-left:16px}.welcome-copy h2{font-size:25px}.welcome-copy{max-width:100%}.welcome-art{right:-135px;width:75%}.metric-card>strong{font-size:17px}.quick-grid{grid-template-columns:1fr}}
    /* Readability pass: preserve the current dashboard composition and raise
       type scale, contrast, and breathing room across its existing components. */
    .sidebar-caption{font-size:11px;color:#aac8c0}.nav-link{font-size:14px;font-weight:600}.site-link,.collapse-button{font-size:13px}.sidebar-help{font-size:12px}.sidebar-help small{font-size:11px;color:#aac8c0}
    .breadcrumb{color:#5f716b;font-size:11px}.topbar-left h1{font-size:clamp(24px,1.4vw,28px)}.date-chip{font-size:13px}.profile-label b{font-size:12px}.profile-label small{font-size:11px;color:#62736d}.profile-menu b{font-size:12px}.profile-menu small{font-size:11px;color:#62736d}.profile-menu button{font-size:13px}
    .dashboard-content{padding-top:34px}.welcome-card{min-height:252px;padding:clamp(28px,3.4vw,46px)}.eyebrow{color:#11776e;font-size:10.5px;letter-spacing:.105em}.welcome-copy h2{font-size:clamp(32px,2.1vw,36px);letter-spacing:-.045em}.welcome-copy p{color:#536660;font-size:14px;line-height:1.7}.welcome-actions{margin-top:25px}.primary-action,.secondary-action{min-height:46px;padding:0 16px;font-size:13px;font-weight:700}
    .overview-section,.quick-section{margin-top:35px}.section-heading{margin-bottom:17px}.section-heading h2{font-size:21px;letter-spacing:-.025em}.section-aside{color:#64756f;font-size:11px}.refresh-button{padding:8px 11px;font-size:16px}.refresh-button span{font-size:12px}.metric-grid{gap:14px}.metric-card{min-height:164px;padding:19px 18px 16px}.metric-top{color:#4b6059;font-size:14px;font-weight:600;line-height:1.35}.metric-top i{width:34px;height:34px;flex-basis:34px}.metric-card>strong{margin-top:13px;font-size:clamp(26px,1.55vw,30px);font-weight:700;letter-spacing:-.035em}.metric-card>small{padding-top:11px;color:#5c6e68;font-size:11px;line-height:1.5}
    .quick-grid{gap:11px}.quick-link{min-height:82px;gap:14px;padding:13px 15px}.quick-icon{width:41px;height:41px;flex-basis:41px}.quick-label b{font-size:14px;font-weight:600;line-height:1.3}.quick-label small{margin-top:5px;color:#60726c;font-size:12px;line-height:1.35}
    .activity-grid{gap:16px;margin-top:27px}.activity-card,.attention-card{padding:21px}.card-heading{margin-bottom:17px}.card-heading h2{font-size:19px}.card-heading>a{font-size:12px}.activity-row{gap:12px;padding:13px 0}.activity-icon{width:37px;height:37px;flex-basis:37px}.activity-primary b{color:#203d38;font-size:13px;font-weight:600}.activity-primary small{margin-top:5px;color:#5e706a;font-size:11px;line-height:1.35}.activity-row>strong{font-size:13px}.status-pill{font-size:10px}.attention-row{gap:12px;padding:11px 0}.attention-icon{width:33px;height:33px;flex-basis:33px}.attention-row b{font-size:12px;font-weight:600}.attention-row small{margin-top:4px;color:#5e706a;font-size:11px;line-height:1.35}.attention-foot{gap:7px}.attention-foot span{color:#52665f;font-size:10px}.activity-lower{margin-top:16px;padding:21px}.movement-column{padding-left:21px}.compact-list .activity-row{padding:11px 0}.empty-state{min-height:140px}.empty-state b{color:#304a44;font-size:13px}.empty-state small{color:#5e706a;font-size:11px;line-height:1.55}.dashboard-error{font-size:13px;line-height:1.5}.dashboard-error button{font-size:12px}.dashboard-footer{color:#63756e;font-size:10px}.dashboard-footer b{color:#405e56}.gate-mark{font-size:27px}.dashboard-gate{font-size:13px}.dashboard-gate h1{font-size:26px}.dashboard-gate p{color:#536660;font-size:14px;line-height:1.65}.dashboard-gate a{font-size:13px}
    @media(max-width:1200px){.metric-card{min-height:157px}.metric-card>strong{font-size:clamp(25px,2.3vw,29px)}}
    @media(max-width:900px){.dashboard-sidebar .nav-link{font-size:14px}.dashboard-sidebar .site-link{font-size:13px}.activity-grid{gap:12px}.activity-card,.attention-card{padding:17px}}
    @media(max-width:680px){.dashboard-topbar{min-height:74px}.topbar-left h1{font-size:21px}.breadcrumb{font-size:10px}.profile-label,.chevron{display:none}.dashboard-content{padding:21px 15px}.welcome-card{min-height:245px;padding:24px 20px}.welcome-copy{max-width:94%}.welcome-copy h2{font-size:clamp(28px,7vw,32px);line-height:1.15}.welcome-copy p{max-width:275px;font-size:13px;line-height:1.6}.eyebrow{font-size:9.5px}.primary-action,.secondary-action{min-height:43px;padding:0 11px;font-size:12px}.overview-section,.quick-section{margin-top:28px}.section-heading{margin-bottom:14px}.section-heading h2{font-size:19px}.section-aside{font-size:10px}.metric-grid{gap:10px}.metric-card{min-height:143px;padding:14px 13px 13px}.metric-top{font-size:12px;line-height:1.3}.metric-top i{width:29px;height:29px;flex-basis:29px}.metric-card>strong{margin-top:10px;font-size:clamp(21px,6vw,25px)}.metric-card>small{padding-top:8px;color:#556a63;font-size:10px;line-height:1.4}.quick-grid{gap:8px}.quick-link{min-height:76px;gap:9px;padding:10px}.quick-icon{width:34px;height:34px;flex-basis:34px}.quick-label b{font-size:12px;white-space:normal;overflow:visible}.quick-label small{font-size:10px;white-space:normal;overflow:visible}.quick-link>svg:last-child{width:14px;flex:0 0 14px}.activity-grid{gap:11px;margin-top:21px}.activity-card,.attention-card{padding:15px}.card-heading{align-items:flex-start;gap:8px;margin-bottom:13px}.card-heading h2{font-size:17px}.card-heading>a{font-size:10px}.activity-row{gap:9px;padding:11px 0}.activity-icon{width:33px;height:33px;flex-basis:33px}.activity-primary b{font-size:12px}.activity-primary small{font-size:10px;line-height:1.4}.activity-row>strong{font-size:11px}.status-pill{padding:4px 6px;font-size:9px}.attention-row{gap:9px;padding:10px 0}.attention-icon{width:30px;height:30px;flex-basis:30px}.attention-row b{font-size:11px}.attention-row small{font-size:10px;white-space:normal;line-height:1.35}.attention-foot span{font-size:9px}.activity-lower{gap:18px;padding:15px}.movement-column{padding:17px 0 0}.empty-state{min-height:120px}.empty-state b{font-size:12px}.empty-state small{font-size:10px}.dashboard-footer{font-size:9px}}
    @media(max-width:390px){.topbar-left h1{font-size:19px}.breadcrumb{font-size:9px}.welcome-copy h2{font-size:27px}.welcome-copy p{font-size:12px}.metric-card{min-height:137px;padding:12px 10px}.metric-top{font-size:11px}.metric-card>strong{font-size:21px}.quick-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.quick-link{gap:7px;padding:9px}.quick-icon{width:30px;height:30px;flex-basis:30px}.quick-label b{font-size:11px}.quick-label small{font-size:9px}}
    .metric-card{text-decoration:none;color:inherit}.more-actions{min-height:44px;margin-top:8px;padding:0 12px;border:1px solid #cbdad5;background:#fff;color:#31534d;font-size:12px;font-weight:700;cursor:pointer}.mobile-bottom-nav{display:none}
    @media(max-width:680px){.dashboard-content{padding-bottom:100px}.welcome-card{min-height:185px;padding:20px 18px}.welcome-art{display:none}.welcome-copy{max-width:100%}.welcome-copy h2{margin:10px 0 5px}.welcome-copy p{font-size:12px}.welcome-actions{margin-top:14px}.primary-action,.secondary-action{min-height:48px;padding:0 13px;font-size:12px}.metric-grid{grid-template-columns:1fr;gap:8px}.metric-card{min-height:104px;padding:13px 14px}.metric-card>strong{font-size:23px}.metric-card>small{font-size:10px}.quick-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.quick-link{min-height:82px;padding:10px}.quick-label b{font-size:12px}.quick-label small{font-size:10px}.activity-grid{grid-template-columns:1fr}.activity-lower{grid-template-columns:1fr}.movement-column{padding:17px 0 0;border-top:1px solid #e2ebe7;border-left:0}.mobile-bottom-nav{position:fixed;z-index:32;right:0;bottom:0;left:0;display:grid;grid-template-columns:repeat(5,1fr);min-height:68px;padding:5px 8px max(5px,env(safe-area-inset-bottom));border-top:1px solid #cbdad5;background:#fff;box-shadow:0 -4px 15px #103d3c12}.mobile-bottom-nav a,.mobile-bottom-nav button{display:flex;min-width:0;min-height:52px;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:0;background:transparent;color:#526660;text-decoration:none;font:600 10px Arial,sans-serif}.mobile-bottom-nav .bottom-create{position:relative;top:-13px;min-height:62px;margin:0 3px;padding:7px 4px;border:1px solid #082a28;background:#168c83;color:white;box-shadow:3px 3px 0 #103d3c}.mobile-bottom-nav .bottom-create span{font-size:9px}.mobile-bottom-nav a[aria-current=page]{color:#087a70}.mobile-bottom-nav button{cursor:pointer}.dashboard-topbar{min-height:67px}.topbar-left h1{font-size:18px}.mobile-menu-button{width:44px;height:44px}.profile-avatar{width:42px;height:42px}.date-chip{width:42px;height:42px}.more-actions{min-height:48px}}
    @media(max-width:390px){.dashboard-content{padding-right:12px;padding-left:12px}.welcome-card{padding:18px 15px}.quick-link{gap:7px;padding:9px}.quick-icon{width:34px;height:34px;flex-basis:34px}.quick-label b{font-size:11px}.quick-label small{font-size:9px}.mobile-bottom-nav{padding-right:5px;padding-left:5px}}
    /* Task-first workspace composition */
    .dashboard-content{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr);column-gap:26px;align-content:start}
    .welcome-card,.dashboard-error,.activity-grid,.activity-lower,.dashboard-footer{grid-column:1/-1}
    .welcome-card{min-height:218px;border:1.5px solid #103d3c;box-shadow:5px 5px 0 #103d3c}
    .overview-section{grid-column:2;grid-row:2;align-self:start;margin-top:29px}
    .quick-section{grid-column:1;grid-row:2;align-self:start;margin-top:29px}
    .quick-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .quick-link{min-height:76px;padding:12px 14px;border:1px solid #c8d7d0;background:#fff;box-shadow:2px 2px 0 #dce7e0}
    .quick-primary{grid-column:1/-1;min-height:92px;background:#168c83;color:#fff;box-shadow:3px 3px 0 #103d3c}
    .quick-primary .quick-icon{width:43px;height:43px;flex-basis:43px;background:#d9f0e8;color:#103d3c}
    .quick-primary .quick-label b{font-size:15px}.quick-primary .quick-label small{color:#d7eeea}
    .quick-link:hover{box-shadow:3px 4px 0 #103d3c}
    .metric-grid{grid-template-columns:1fr;gap:9px}
    .metric-card{min-height:116px;padding:15px 17px;border:1px solid #bfd0c7;background:#fff;box-shadow:2px 2px 0 #dce7e0}
    .metric-card>strong{font-size:clamp(24px,2vw,30px)}
    .activity-grid{margin-top:28px}
    @media(max-width:900px){.dashboard-content{grid-template-columns:minmax(0,1fr) minmax(280px,.8fr);column-gap:18px}.quick-grid{gap:8px}.quick-link{padding:10px}.overview-section,.quick-section{margin-top:23px}}
    @media(max-width:680px){.dashboard-content{display:flex;flex-direction:column;gap:0}.welcome-card,.dashboard-error,.overview-section,.quick-section,.activity-grid,.activity-lower,.dashboard-footer{width:100%}.quick-section{order:2;margin-top:23px}.overview-section{order:3;margin-top:23px}.activity-grid{order:4}.activity-lower{order:5}.dashboard-footer{order:6}.quick-grid{grid-template-columns:1fr 1fr}.quick-primary{grid-column:1/-1}.quick-link{min-height:77px}.metric-grid{grid-template-columns:1fr}.metric-card{min-height:102px}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
  `}</style>;
}
