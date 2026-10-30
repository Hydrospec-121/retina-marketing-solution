import Link from "next/link";

const highlights = [
  { number: "01", title: "Medicine catalogue", text: "A clear, searchable catalogue for the products Retina supplies." },
  { number: "02", title: "Order management", text: "A central place for the team to review and process incoming orders." },
  { number: "03", title: "Stock visibility", text: "A foundation for batch-level inventory and expiry tracking." },
];

export default function Home() {
  return (
    <main>
      <nav className="nav shell">
        <Link className="brand" href="/"><span className="brand-mark">R</span><span>RETINA<small>MARKETING SOLUTION</small></span></Link>
        <div className="nav-links"><Link href="/shop">Medicine catalogue</Link><Link href="/admin">Admin preview</Link></div>
        <Link className="button button-dark" href="/shop">Browse catalogue <span>↗</span></Link>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span className="dot" /> PHARMACEUTICAL MARKETING & DISTRIBUTION</div>
          <h1>Healthcare supply.<br /><em>Made simpler.</em></h1>
          <p className="hero-text">A clearer way to explore Retina’s medicine catalogue and a smarter digital workspace for the team behind every order.</p>
          <div className="hero-actions"><Link className="button button-primary" href="/shop">Explore medicines <span>→</span></Link><Link className="text-link" href="/admin">View dashboard preview ↗</Link></div>
          <div className="hero-note"><span className="note-line" /> BUILT AROUND CLARITY, CARE & RELIABILITY</div>
        </div>
        <div className="hero-art" aria-label="Decorative healthcare illustration">
          <div className="art-grid" />
          <div className="art-card art-card-back"><span>RMS / SUPPLY</span><b>Reliable<br />distribution.</b><i>✳</i></div>
          <div className="art-cross">＋</div>
          <div className="art-card art-card-front"><div className="capsule"><span /><span /></div><small>HEALTHCARE / 001</small><strong>Better systems.<br />Better service.</strong><div className="art-bottom"><span>RETINA</span><span>EST. BUSINESS</span></div></div>
          <div className="art-stamp">R<br /><small>RMS</small></div>
        </div>
      </section>

      <section className="trust-strip"><div className="shell trust-inner"><span>ONE CONNECTED WORKSPACE</span><b>CATALOGUE</b><b>ORDERS</b><b>INVENTORY</b><b>OPERATIONS</b></div></section>

      <section className="section shell">
        <div className="section-heading"><div><div className="eyebrow">THE RETINA PLATFORM</div><h2>Business operations,<br /><em>with a clearer view.</em></h2></div><p>We’re building one connected platform for customers to place orders and for the Retina team to manage daily operations.</p></div>
        <div className="feature-grid">{highlights.map((item) => <article className="feature-card" key={item.number}><span className="feature-number">{item.number}</span><div className="feature-icon">{item.number === "01" ? "▦" : item.number === "02" ? "↗" : "▤"}</div><h3>{item.title}</h3><p>{item.text}</p><span className="feature-arrow">↗</span></article>)}</div>
      </section>

      <footer className="footer"><div className="shell footer-inner"><Link className="brand brand-light" href="/"><span className="brand-mark">R</span><span>RETINA<small>MARKETING SOLUTION</small></span></Link><span>PHARMACEUTICAL MARKETING & DISTRIBUTION</span><span>© {new Date().getFullYear()} RETINA</span></div></footer>
    </main>
  );
}
