import Link from "next/link";

const stats = [
  { label: "TODAY'S SALES", value: "৳ 00,000", note: "Demo figure", icon: "↗" },
  { label: "NEW ORDERS", value: "08", note: "Sample orders", icon: "▤" },
  { label: "STOCK ITEMS", value: "124", note: "Sample count", icon: "▦" },
  { label: "LOW STOCK", value: "06", note: "Sample alerts", icon: "!" },
];
const orders = [
  ["#RMS-1008", "Green Care Pharmacy", "৳ 2,450", "Pending"],
  ["#RMS-1007", "City Medicine Corner", "৳ 5,200", "Processing"],
  ["#RMS-1006", "Health Point", "৳ 1,850", "Dispatched"],
  ["#RMS-1005", "MediLife Pharmacy", "৳ 3,100", "Delivered"],
];

export default function Admin() {
  return (
    <main className="admin-page">
      <aside className="admin-sidebar"><Link className="brand brand-light" href="/"><span className="brand-mark">R</span><span>RETINA<small>BUSINESS HUB</small></span></Link><div className="sidebar-label">WORKSPACE</div><a className="side-active">▦ &nbsp; Overview</a><a>▤ &nbsp; Orders</a><a>＋ &nbsp; Medicines</a><a>▥ &nbsp; Inventory</a><a>৳ &nbsp; Sales & accounts</a><a>♙ &nbsp; Customers</a><div className="sidebar-bottom"><span>DEMO DASHBOARD</span><Link href="/">← Back to website</Link></div></aside>
      <section className="admin-main"><header className="admin-topbar"><span>RETINA / OVERVIEW</span><div><span className="demo-tag">PREVIEW DATA</span><span className="avatar">R</span></div></header><div className="admin-content"><div className="admin-welcome"><div><div className="eyebrow">BUSINESS OVERVIEW</div><h1>Good day, <em>Retina.</em></h1><p>Here’s a quick look at your business. These are sample figures for the design preview.</p></div><button type="button" className="button button-primary" disabled>＋ Add medicine</button></div><div className="stats-grid">{stats.map((s) => <article className="stat-card" key={s.label}><div><span>{s.label}</span><b>{s.value}</b><small>{s.note}</small></div><i>{s.icon}</i></article>)}</div><div className="admin-panels"><section className="panel orders-panel"><div className="panel-heading"><div><span className="eyebrow">LATEST ACTIVITY</span><h2>Recent orders</h2></div><span className="panel-link">VIEW ALL ↗</span></div><div className="order-table"><div className="order-row order-head"><span>ORDER</span><span>CUSTOMER</span><span>AMOUNT</span><span>STATUS</span></div>{orders.map((o) => <div className="order-row" key={o[0]}><b>{o[0]}</b><span>{o[1]}</span><span>{o[2]}</span><span><i className={`status status-${o[3].toLowerCase()}`}>{o[3]}</i></span></div>)}</div></section><section className="panel quick-panel"><span className="eyebrow">SHORTCUTS</span><h2>Quick actions</h2><button disabled>＋ &nbsp; Add a medicine</button><button disabled>▤ &nbsp; Review new orders</button><button disabled>▥ &nbsp; Check inventory</button><div className="quick-note">These controls will become functional as we connect the database and business workflows.</div></section></div><div className="notice"><b>DEVELOPMENT PREVIEW</b><span>This dashboard is a visual starter. It has no login, live stock, customer data or financial records yet.</span></div></div></section>
    </main>
  );
}
