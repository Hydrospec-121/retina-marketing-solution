import Link from "next/link";

const products = [
  { name: "Paracetamol 500 mg", generic: "Paracetamol", form: "Tablet · Sample listing", price: "৳ 00.00", tag: "PAIN RELIEF" },
  { name: "Vitamin C 500 mg", generic: "Ascorbic acid", form: "Tablet · Sample listing", price: "৳ 00.00", tag: "VITAMINS" },
  { name: "Oral Saline", generic: "Oral rehydration salts", form: "Sachet · Sample listing", price: "৳ 00.00", tag: "WELLNESS" },
  { name: "Antacid Suspension", generic: "Antacid", form: "Suspension · Sample listing", price: "৳ 00.00", tag: "DIGESTIVE" },
];

export default function Shop() {
  return (
    <main className="subpage">
      <nav className="nav shell"><Link className="brand" href="/"><span className="brand-mark">R</span><span>RETINA<small>MARKETING SOLUTION</small></span></Link><div className="nav-links"><Link href="/">Home</Link><Link href="/admin">Admin preview</Link></div><span className="cart-pill">CART <b>0</b></span></nav>
      <section className="shell page-intro"><div className="eyebrow">RETINA / CATALOGUE</div><h1>Medicine <em>catalogue.</em></h1><p>Explore the sample catalogue layout. Product listings and prices shown here are placeholders, not real stock or offers.</p></section>
      <section className="shell catalogue-layout"><aside className="filter-panel"><b>CATALOGUE</b><span className="filter-active">All products <i>04</i></span><span>Vitamins</span><span>Wellness</span><span>Digestive health</span><span>Pain relief</span><div className="filter-note">Product availability and regulated-medicine checks will be connected before launch.</div></aside><div className="products-area"><div className="catalogue-toolbar"><span>DEMO PRODUCTS / 04 ITEMS</span><span> SORT: FEATURED ↓</span></div><div className="product-grid">{products.map((p, i) => <article className="product-card" key={p.name}><div className={`product-visual product-visual-${i + 1}`}><span>{p.tag}</span><div className="product-pack"><b>{["R","C","ORS","RX"][i]}</b><small>RETINA / SAMPLE</small></div><i>✳</i></div><div className="product-info"><small>{p.generic}</small><h3>{p.name}</h3><p>{p.form}</p><div className="product-buy"><b>{p.price}</b><button type="button" disabled title="Cart functionality will be added in a later milestone">＋</button></div></div></article>)}</div></div></section>
      <footer className="footer"><div className="shell footer-inner"><span>RETINA MARKETING SOLUTION</span><span>DEMO CATALOGUE — NOT FOR REAL ORDERS</span><Link href="/">Back home ↑</Link></div></footer>
    </main>
  );
}
