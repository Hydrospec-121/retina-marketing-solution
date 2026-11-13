"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Invoice = { id: string; invoice_number: string; customer_id: string | null; customer_name: string; invoice_date: string; total: number; status: string };
type Payment = { invoice_id: string; amount: number };
type RecentInvoice = Invoice & { customer_name: string };
type OverviewData = { today: number; month: number; outstanding: number; collected: number; recent: RecentInvoice[] };

const PAGE_SIZE = 250;
const TZ = "Asia/Dhaka";
const money = (value: number) => `\u09F3 ${value.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });
};

function dateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function dhakaMidnightUtc(year: number, month: number, day: number) {
  const targetUtc = Date.UTC(year, month - 1, day);
  let guess = targetUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, Number(part.value)]));
    const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess = targetUtc - (representedUtc - guess);
  }
  return new Date(guess);
}

async function readAllInvoices(): Promise<Invoice[]> {
  const invoices: Invoice[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase.from("invoices")
      .select("id,invoice_number,customer_id,customer_name,invoice_date,total,status")
      .eq("status", "posted")
      .order("invoice_date", { ascending: false })
      .order("id", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Invoice[];
    invoices.push(...page);
    if (page.length < PAGE_SIZE) return invoices;
  }
}

async function readAllPayments(): Promise<Payment[]> {
  const payments: Payment[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await supabase.from("payments").select("invoice_id,amount,created_at").order("created_at", { ascending: true }).order("id", { ascending: true }).range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Payment[];
    payments.push(...page);
    if (page.length < PAGE_SIZE) return payments;
  }
}

async function loadOverview(): Promise<OverviewData> {
  const [invoices, payments] = await Promise.all([readAllInvoices(), readAllPayments()]);
  const parts = dateParts(new Date());
  const year = Number(parts.year);
  const monthNumber = Number(parts.month);
  const dayNumber = Number(parts.day);
  const todayStart = dhakaMidnightUtc(year, monthNumber, dayNumber).getTime();
  const tomorrowStart = dhakaMidnightUtc(year, monthNumber, dayNumber + 1).getTime();
  const monthStart = dhakaMidnightUtc(year, monthNumber, 1).getTime();
  const nextMonthStart = dhakaMidnightUtc(year, monthNumber + 1, 1).getTime();
  const paidByInvoice = new Map<string, number>();
  let collected = 0;
  for (const payment of payments) {
    const amount = Number(payment.amount);
    collected += amount;
    paidByInvoice.set(payment.invoice_id, (paidByInvoice.get(payment.invoice_id) ?? 0) + amount);
  }
  let today = 0;
  let month = 0;
  let outstanding = 0;
  for (const invoice of invoices) {
    const timestamp = new Date(invoice.invoice_date).getTime();
    const total = Number(invoice.total);
    if (timestamp >= todayStart && timestamp < tomorrowStart) today += total;
    if (timestamp >= monthStart && timestamp < nextMonthStart) month += total;
    outstanding += total - (paidByInvoice.get(invoice.id) ?? 0);
  }
  const recentInvoices = invoices.slice(0, 5);
  return {
    today,
    month,
    outstanding,
    collected,
    recent: recentInvoices.map((invoice) => ({ ...invoice, customer_name: invoice.customer_name })),
  };
}

export default function SalesOverviewPage() {
  const router = useRouter();
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [accessError, setAccessError] = useState("");
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let active = true;
    async function verify() {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError || !session?.user) { router.replace("/login"); return; }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
      if (!active) return;
      if (profileError) { setAccessError(`Unable to verify your access: ${profileError.message}`); setAccess("denied"); }
      else if (profile?.role !== "owner" && profile?.role !== "manager") { setAccessError("Access denied. This page is available to owners and managers only."); setAccess("denied"); }
      else setAccess("allowed");
    }
    verify().catch((reason: unknown) => {
      if (!active) return;
      setAccessError(`Unable to verify your access: ${reason instanceof Error ? reason.message : "Unexpected error."}`);
      setAccess("denied");
    });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (access !== "allowed") return;
    let active = true;
    setLoading(true);
    setError("");
    loadOverview().then((result) => { if (active) setData(result); }).catch((reason: unknown) => {
      if (!active) return;
      setError(`Could not load sales overview: ${reason instanceof Error ? reason.message : "Unexpected error."}`);
      setData(null);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [access, refreshCount]);

  if (access === "checking") return <main className="overview-state">Checking access...<OverviewStyles /></main>;
  if (access === "denied") return <main className="overview-state"><section><h1>Access denied</h1><p>{accessError}</p><Link href="/admin">Return to dashboard</Link></section><OverviewStyles /></main>;

  const cards = [
    { title: "Today's Sales", amount: data?.today ?? 0, note: "Posted invoices dated today" },
    { title: "This Month's Sales", amount: data?.month ?? 0, note: "Posted invoices this month" },
    { title: "Total Outstanding", amount: data?.outstanding ?? 0, note: "Posted invoices less linked payments" },
    { title: "Total Payments Collected", amount: data?.collected ?? 0, note: "All recorded payment amounts" },
  ];
  return <main className="overview-layout">
    <aside className="overview-sidebar">
      <Link className="overview-brand" href="/"><span className="overview-brand-mark">R</span><span>RETINA<small>BUSINESS HUB</small></span></Link>
      <div className="overview-nav-label">WORKSPACE</div>
      <nav className="overview-nav"><Link href="/admin">▦ &nbsp; Overview</Link><Link href="/admin/orders">▤ &nbsp; Orders</Link><Link href="/admin/medicines">＋ &nbsp; Medicines</Link><Link href="/admin/inventory">▥ &nbsp; Inventory</Link><Link href="/admin/sales">৳ &nbsp; Sales &amp; accounts</Link><Link className="overview-active" href="/admin/sales/overview">- &nbsp; Sales Overview</Link><Link href="/admin/sales/history">- &nbsp; Sales History</Link><Link href="/admin/customers">♙ &nbsp; Customers</Link></nav>
      <div className="overview-sidebar-bottom"><span>OWNER DASHBOARD</span><Link href="/">← Back to website</Link></div>
    </aside>
    <section className="overview-main">
      <header className="overview-topbar"><span>RETINA / SALES &amp; ACCOUNTS</span><span className="overview-tag">SALES OVERVIEW</span></header>
      <div className="overview-content">
        <div className="overview-heading"><div><div className="overview-eyebrow">SALES MANAGEMENT</div><h1>Sales <em>Overview</em></h1><p>Live invoice and payment figures for your business.</p></div><div className="overview-actions"><Link href="/admin/sales">Create invoice</Link><Link href="/admin/sales/history">Sales History</Link></div></div>
        {error && <div className="overview-error" role="alert">{error}<button type="button" onClick={() => setRefreshCount((count) => count + 1)}>Retry</button></div>}
        <section className="overview-metrics" aria-label="Sales summary">
          {cards.map((card) => <article className="overview-card" key={card.title}><span>{card.title}</span>{loading ? <div className="overview-skeleton" aria-label="Loading" /> : <strong>{error ? "Unavailable" : money(card.amount)}</strong>}<small>{card.note}</small></article>)}
        </section>
        <section className="overview-recent">
          <header><div><div className="overview-eyebrow">LATEST ACTIVITY</div><h2>Recent Invoices</h2></div><Link href="/admin/sales/history">View all invoices →</Link></header>
          {loading ? <div className="overview-message" role="status">Loading recent invoices...</div> : error ? <div className="overview-message">Recent invoices are unavailable.</div> : !data?.recent.length ? <div className="overview-message">No posted invoices yet.</div> :
            <div className="overview-table-wrap"><table><thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>DATE</th><th>TOTAL</th></tr></thead><tbody>{data.recent.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.invoice_number}</strong></td><td>{invoice.customer_name}</td><td>{dateLabel(invoice.invoice_date)}</td><td>{money(Number(invoice.total))}</td></tr>)}</tbody></table></div>}
        </section>
      </div>
    </section>
    <OverviewStyles />
  </main>;
}

function OverviewStyles() {
  return <style jsx global>{`
    .overview-layout{min-height:100vh;display:grid;grid-template-columns:225px minmax(0,1fr);background:#f5f8f6;color:#111817;font-family:Arial,sans-serif}.overview-sidebar{position:relative;min-height:100vh;background:#103d3c;padding:25px 17px;color:#fff}.overview-brand{display:flex;align-items:center;gap:10px;margin-bottom:48px;color:#fff;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:.08em}.overview-brand small{display:block;margin-top:3px;color:#9ab9b1;font-size:8px;font-weight:400;letter-spacing:.14em}.overview-brand-mark{display:grid;width:35px;height:35px;place-items:center;border:1px solid #111817;background:#9de3d8;color:#103d3c;font-size:19px}.overview-nav-label,.overview-sidebar-bottom>span{font-size:9px;letter-spacing:.12em;color:#9ab9b1}.overview-nav-label{margin:0 0 13px 10px}.overview-nav{display:flex;flex-direction:column;gap:4px}.overview-nav a{display:block;padding:13px 12px;color:#c6d9d3;text-decoration:none;font-size:13px}.overview-nav a:hover{background:#1b504c;color:#fff}.overview-nav .overview-active{padding-left:24px;background:#9de3d8;color:#103d3c;font-size:12px;font-weight:700;border:1px solid #111817;box-shadow:3px 3px 0 #111817}.overview-sidebar-bottom{position:absolute;left:25px;bottom:25px;display:flex;flex-direction:column;gap:13px}.overview-sidebar-bottom a{color:#fff;text-decoration:none;font-size:12px}
    .overview-main{min-width:0}.overview-topbar{height:72px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 34px;border-bottom:1px solid #dce7e2;background:#fff;font:10px 'DM Mono',monospace;letter-spacing:.08em}.overview-tag{padding:7px 9px;background:#e6f3ee;color:#103d3c;font:9px 'DM Mono',monospace;letter-spacing:.05em;white-space:nowrap}.overview-content{max-width:1250px;margin:0 auto;padding:34px clamp(16px,3vw,34px) 48px}.overview-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:25px}.overview-eyebrow{color:#168c83;font:10px 'DM Mono',monospace;letter-spacing:.1em}.overview-heading h1{margin:8px 0;color:#103d3c;font-size:34px;letter-spacing:-.04em}.overview-heading h1 em{font-family:Georgia,serif;font-weight:400}.overview-heading p{margin:0;color:#66736f;font-size:13px}.overview-actions{display:flex;gap:9px;flex-wrap:wrap}.overview-actions a{padding:11px 13px;border:1px solid #168c83;background:#fff;color:#103d3c;text-decoration:none;font-size:11px;font-weight:700}.overview-actions a:first-child{background:#168c83;color:#fff}
    .overview-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px;margin-bottom:23px}.overview-card{display:flex;min-height:150px;flex-direction:column;align-items:flex-start;gap:13px;padding:20px;background:#fff;border:1.5px solid #111817;box-shadow:3px 3px 0 #111817}.overview-card>span{color:#66736f;font-size:12px;font-weight:700}.overview-card>strong{color:#103d3c;font-size:clamp(21px,2.3vw,29px);letter-spacing:-.04em}.overview-card>small{margin-top:auto;color:#66736f;font-size:10px;line-height:1.4}.overview-skeleton{width:70%;height:27px;background:linear-gradient(90deg,#edf1ef,#dfeae5,#edf1ef);background-size:200% 100%;animation:overview-shimmer 1.2s linear infinite}@keyframes overview-shimmer{to{background-position:-200% 0}}
    .overview-recent{overflow:hidden;background:#fff;border:1.5px solid #111817;box-shadow:3px 3px 0 #111817}.overview-recent>header{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:20px;border-bottom:1px solid #e4ebe8}.overview-recent h2{margin:7px 0 0;color:#103d3c;font-size:19px}.overview-recent>header>a{color:#168c83;font-size:11px;font-weight:700;text-decoration:none}.overview-table-wrap{overflow-x:auto}.overview-recent table{width:100%;min-width:570px;border-collapse:collapse;text-align:left}.overview-recent th{padding:12px;background:#e5f2ef;color:#103d3c;font:9px 'DM Mono',monospace;letter-spacing:.05em}.overview-recent td{padding:14px;border-top:1px solid #edf1ef;color:#354541;font-size:12px;white-space:nowrap}.overview-recent td strong{color:#103d3c}.overview-message{padding:30px 20px;color:#66736f;text-align:center;font-size:12px}.overview-error{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;padding:13px;border:1px solid #c94d3d;background:#fff0ed;color:#8b2419;font-size:12px;line-height:1.5}.overview-error button{padding:8px 11px;border:1px solid #c94d3d;background:#fff;color:#8b2419;font-size:11px;font-weight:700;cursor:pointer}.overview-state{min-height:100vh;display:grid;place-items:center;padding:20px;background:#f5f8f6;color:#103d3c;font:600 14px Arial,sans-serif}.overview-state section{max-width:460px;padding:28px;background:#fff;border:1.5px solid #111817;box-shadow:4px 4px 0 #111817}.overview-state h1{margin-top:0}.overview-state p{color:#66736f;line-height:1.6}.overview-state a{color:#168c83;font-weight:700}
    @media(max-width:1000px){.overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.overview-layout{grid-template-columns:190px minmax(0,1fr)}}
    @media(max-width:620px){.overview-layout{display:block}.overview-sidebar{min-height:auto;padding:13px 15px}.overview-brand{margin-bottom:13px}.overview-nav-label,.overview-sidebar-bottom{display:none}.overview-nav{flex-direction:row;overflow-x:auto}.overview-nav a{flex:0 0 auto;padding:10px;font-size:11px;white-space:nowrap}.overview-nav .overview-active{padding:10px}.overview-topbar{height:54px;padding:0 16px;font-size:9px}.overview-content{padding-top:22px}.overview-heading{flex-direction:column}.overview-heading h1{font-size:29px}.overview-metrics{grid-template-columns:1fr;gap:12px}.overview-card{min-height:125px}.overview-recent>header{align-items:flex-start}}
  `}</style>;
}
