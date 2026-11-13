"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Medicine = { id: string; name: string; generic_name: string | null; strength: string | null; dosage_form: string | null; category: string | null; stock_quantity: number; purchase_cost_avg: number; selling_price: number; min_stock_level: number; is_active: boolean };
type Movement = { id: string; medicine_id: string; movement_type: string; quantity_delta: number; previous_quantity: number; resulting_quantity: number; purchase_cost: number | null; reason: string | null; actor_id: string | null; related_invoice_id: string | null; created_at: string };
type MovementActivity = { medicine_id: string; movement_type: string };
function calculatedUnitCost(total: string, quantity: string): string {
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(total) || !/^\d{1,10}$/.test(quantity)) return "";
  const units = BigInt(quantity);
  if (units === BigInt(0) || units > BigInt(2147483647)) return "";
  const [whole, fraction = ""] = total.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  const tenThousandths = (cents * BigInt(100) + units / BigInt(2)) / units;
  const unitWhole = tenThousandths / BigInt(10000);
  const unitFraction = (tenThousandths % BigInt(10000)).toString().padStart(4, "0");
  return `\u09F3${unitWhole.toLocaleString("en-BD")}.${unitFraction}`;
}
const money = (value: number) => `\u09F3${Number(value || 0).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const moneyCost = (value: number) => `\u09F3${Number(value || 0).toLocaleString("en-BD", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
const dateTime = (value: string) => new Date(value).toLocaleString("en-BD", { timeZone: "Asia/Dhaka", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

async function loadAllMovementActivity(): Promise<{ data: MovementActivity[] | null; error: string | null }> {
  const rows: MovementActivity[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("medicine_stock_movements")
      .select("medicine_id,movement_type")
      .order("id", { ascending: true })
      .range(start, start + pageSize - 1);
    if (error) return { data: null, error: error.message };
    const page = (data ?? []) as MovementActivity[];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}

export default function InventoryPage() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const dashboardHref = role === "owner"
    ? "/admin"
    : role === "inventory_manager"
      ? "/admin/inventory"
      : "/admin/sales/history";
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [accessError, setAccessError] = useState("");
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [openingStockMedicineIds, setOpeningStockMedicineIds] = useState<string[]>([]);
  const [stockActivityMedicineIds, setStockActivityMedicineIds] = useState<string[]>([]);
  const [stockActivityLoaded, setStockActivityLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showOpeningStock, setShowOpeningStock] = useState(false);
  const [openingMedicineId, setOpeningMedicineId] = useState("");
  const [openingQuantity, setOpeningQuantity] = useState("");
  const [openingSaving, setOpeningSaving] = useState(false);
  const [medicineId, setMedicineId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [totalPurchaseCost, setTotalPurchaseCost] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState<Medicine | null>(null);
  const [newQuantity, setNewQuantity] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const [initialCostMedicine, setInitialCostMedicine] = useState<Medicine | null>(null);
  const [initialCostValue, setInitialCostValue] = useState("");
  const [initialCostReason, setInitialCostReason] = useState("");
  const [initialCostSaving, setInitialCostSaving] = useState(false);
  const [initialCostError, setInitialCostError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true); setError(""); setStockActivityLoaded(false);
    const [medicineResult, movementResult, activityResult] = await Promise.all([
      supabase.from("medicines").select("id,name,generic_name,strength,dosage_form,category,stock_quantity,purchase_cost_avg,selling_price,min_stock_level,is_active").order("name"),
      supabase.from("medicine_stock_movements").select("id,medicine_id,movement_type,quantity_delta,previous_quantity,resulting_quantity,purchase_cost,reason,actor_id,related_invoice_id,created_at").order("created_at", { ascending: false }).limit(100),
      loadAllMovementActivity(),
    ]);
    if (medicineResult.error) setError(`Medicines could not be loaded: ${medicineResult.error.message}`);
    else setMedicines((medicineResult.data ?? []) as Medicine[]);
    if (movementResult.error) setError((current) => [current, `Movement history could not be loaded: ${movementResult.error.message}`].filter(Boolean).join(" "));
    else setMovements((movementResult.data ?? []) as Movement[]);
    if (activityResult.error) {
      setError((current) => [current, `Stock activity status could not be loaded: ${activityResult.error}`].filter(Boolean).join(" "));
      setOpeningStockMedicineIds([]);
      setStockActivityMedicineIds([]);
    } else {
      const activity = activityResult.data ?? [];
      setOpeningStockMedicineIds([...new Set(activity.filter((row) => row.movement_type === "OPENING_STOCK").map((row) => row.medicine_id))]);
      setStockActivityMedicineIds([...new Set(activity.map((row) => row.medicine_id))]);
      setStockActivityLoaded(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    async function checkAccess() {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError || !session?.user) { router.replace("/login"); return; }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
      if (!active) return;
      if (profileError || !["owner", "manager", "inventory_manager"].includes(profile?.role ?? "")) {
        setAccessError(profileError?.message ?? "This page is available to authorized inventory staff."); setAccess("denied"); return;
      }
      setRole(profile.role); setAccess("allowed");
    }
    checkAccess().catch((cause: unknown) => { if (active) { setAccessError(cause instanceof Error ? cause.message : "Unable to verify access."); setAccess("denied"); } });
    return () => { active = false; };
  }, [router]);
  useEffect(() => { if (access === "allowed") void loadData(); }, [access, loadData]);

  const visible = useMemo(() => medicines.filter((medicine) => {
    const text = `${medicine.name} ${medicine.generic_name ?? ""} ${medicine.strength ?? ""}`.toLowerCase();
    return medicine.is_active && text.includes(search.toLowerCase()) && (!lowOnly || medicine.stock_quantity <= medicine.min_stock_level);
  }), [medicines, search, lowOnly]);
  const initializableMedicines = medicines.filter((medicine) => stockActivityLoaded && medicine.is_active && medicine.stock_quantity === 0 && !openingStockMedicineIds.includes(medicine.id));
  const totals = useMemo(() => ({ units: medicines.reduce((sum, medicine) => sum + Number(medicine.stock_quantity || 0), 0), low: medicines.filter((medicine) => medicine.is_active && medicine.stock_quantity <= medicine.min_stock_level).length, value: medicines.reduce((sum, medicine) => sum + Number(medicine.stock_quantity || 0) * Number(medicine.purchase_cost_avg || 0), 0) }), [medicines]);

  async function receiveStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    const qty = Number(quantity);
    if (!medicineId) { setNotice("Select a medicine first."); return; }
    if (!/^\d{1,10}$/.test(quantity) || !Number.isSafeInteger(qty) || qty < 1 || qty > 2147483647) { setNotice("Quantity must be a whole number between 1 and 2,147,483,647."); return; }
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(totalPurchaseCost)) { setNotice("Enter a valid total purchase cost in BDT with up to two decimal places."); return; }
    setSaving(true); setNotice("");
    const { error: rpcError } = await supabase.rpc("receive_medicine_stock", { p_medicine_id: medicineId, p_quantity: qty, p_total_purchase_cost: totalPurchaseCost, p_notes: receiptNotes.trim() || null });
    if (rpcError) setNotice(rpcError.message.toLowerCase().includes("not authorized") ? "Your account cannot receive stock." : `Stock receipt failed: ${rpcError.message}`);
    else { setNotice("Stock received. Quantity, weighted-average cost, and movement history were updated."); setQuantity(""); setTotalPurchaseCost(""); setReceiptNotes(""); setShowReceive(false); await loadData(); }
    setSaving(false);
  }

  async function initializeOpeningStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (openingSaving) return;
    const qty = Number(openingQuantity);
    if (!openingMedicineId) { setNotice("Select a medicine first."); return; }
    if (!Number.isSafeInteger(qty) || qty < 0) { setNotice("Opening quantity must be a nonnegative whole number."); return; }
    setOpeningSaving(true); setNotice("");
    const { error: rpcError } = await supabase.rpc("add_medicine_opening_stock", { p_medicine_id: openingMedicineId, p_quantity: qty });
    if (rpcError) setNotice(rpcError.message.toLowerCase().includes("already") ? "Opening stock was already initialized for this medicine." : `Opening stock initialization failed: ${rpcError.message}`);
    else { setNotice("Opening quantity initialized. The existing purchase cost and selling price were preserved."); setOpeningMedicineId(""); setOpeningQuantity(""); setShowOpeningStock(false); await loadData(); }
    setOpeningSaving(false);
  }

  async function saveCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!adjusting || adjustmentSaving) return;
    const corrected = Number(newQuantity);
    if (!Number.isSafeInteger(corrected) || corrected < 0) { setNotice("Corrected stock must be a nonnegative whole number."); return; }
    if (!reason.trim()) { setNotice("Enter a reason for the stock correction."); return; }
    setAdjustmentSaving(true); setNotice("");
    const { error: rpcError } = await supabase.rpc("adjust_medicine_stock", { p_medicine_id: adjusting.id, p_new_quantity: corrected, p_reason: reason.trim(), p_password: password });
    if (rpcError) setNotice(rpcError.message.toLowerCase().includes("password") ? "The stock adjustment password was not accepted." : `Stock correction failed: ${rpcError.message}`);
    else { setNotice(`${adjusting.name} stock corrected and recorded.`); setAdjusting(null); setPassword(""); setReason(""); setNewQuantity(""); await loadData(); }
    setAdjustmentSaving(false);
  }

  async function initializeMedicineCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!initialCostMedicine || initialCostSaving) return;
    const cost = Number(initialCostValue);
    const reasonText = initialCostReason.trim();
    if (!/^\d{1,12}(?:\.\d{1,4})?$/.test(initialCostValue) || !Number.isFinite(cost) || cost < 0 || cost > 999999999999.9999) {
      setInitialCostError("Enter a finite, nonnegative purchase cost with up to four decimal places.");
      return;
    }
    if (!reasonText || reasonText.length > 500) {
      setInitialCostError("Enter a reason of 1 to 500 characters for the cost change.");
      return;
    }
    setInitialCostSaving(true); setInitialCostError(""); setNotice("");
    const { error: rpcError } = await supabase.rpc("set_medicine_initial_cost", {
      p_medicine_id: initialCostMedicine.id,
      p_purchase_cost: initialCostValue,
      p_reason: reasonText,
    });
    if (rpcError) {
      const message = rpcError.message.toLowerCase();
      setInitialCostError(message.includes("stock activity")
        ? "Cost initialization is only available before stock activity begins. Refresh inventory to see the current status."
        : message.includes("not authorized")
          ? "Your account cannot initialize medicine purchase cost."
          : `Purchase cost was not changed: ${rpcError.message}`);
    } else {
      const medicineName = initialCostMedicine.name;
      setInitialCostMedicine(null); setInitialCostValue(""); setInitialCostReason(""); setInitialCostError("");
      setNotice(`${medicineName} purchase cost initialized. Stock quantity was unchanged.`);
      await loadData();
    }
    setInitialCostSaving(false);
  }

  if (access === "checking") return <main className="inv-gate">Checking access…</main>;
  if (access === "denied") return <main className="inv-gate"><section><span className="inv-kicker">INVENTORY WORKSPACE</span><h1>Access denied</h1><p>{accessError}</p><Link href="/admin">Return to dashboard</Link></section></main>;

  return <main className="inventory-page"><header className="inv-header"><Link href={dashboardHref} className="inv-brand"><span>R</span><b>RETINA<small>MARKETING SOLUTION</small></b></Link><nav>{role === "owner" && <button className="inv-nav-opening" type="button" onClick={() => { setShowOpeningStock((open) => !open); setShowReceive(false); setNotice(""); }}>Opening stock</button>}<Link href={dashboardHref}>Dashboard</Link><Link href="/admin/medicines">Medicines</Link>{role !== "inventory_manager" && <Link href="/admin/sales/history">Sales history</Link>}</nav></header>
    {showOpeningStock && <div className="inv-shell inv-opening-shell"><section className="inv-form-panel"><div className="inv-form-title"><div><span className="inv-kicker">OWNER ONLY / INITIAL CUTOVER</span><h2>Initialize opening stock</h2></div><button type="button" aria-label="Close form" onClick={() => setShowOpeningStock(false)}>×</button></div><p className="inv-form-help">Enter the current count. Existing purchase cost and selling price stay unchanged.</p>{initializableMedicines.length ? <form onSubmit={initializeOpeningStock} className="inv-form inv-opening-form"><label>Medicine<select required value={openingMedicineId} onChange={(event) => setOpeningMedicineId(event.target.value)}><option value="">Select medicine</option>{initializableMedicines.map((medicine) => <option key={medicine.id} value={medicine.id}>{medicine.name}{medicine.strength ? ` · ${medicine.strength}` : ""}</option>)}</select></label><label>Stock quantity<input required type="number" min="0" step="1" inputMode="numeric" value={openingQuantity} onChange={(event) => setOpeningQuantity(event.target.value)} placeholder="0"/></label><div className="inv-form-actions"><button type="button" className="inv-quiet" onClick={() => setShowOpeningStock(false)}>Cancel</button><button className="inv-primary" disabled={openingSaving}>{openingSaving ? "Initializing…" : "Initialize stock"}</button></div></form> : <p className="inv-form-help">Every active medicine either already has stock or has already been initialized.</p>}</section></div>}
    <div className="inv-shell"><div className="inv-intro"><div><span className="inv-kicker">STOCK CONTROL / MEDICINE-WISE</span><h1>Inventory</h1><p>One live stock total and weighted-average cost for each medicine.</p></div><button className="inv-primary" type="button" onClick={() => { setShowReceive((open) => !open); setNotice(""); }}><span>＋</span> Receive stock</button></div>
      {error && <div className="inv-error" role="alert">{error}<button onClick={() => void loadData()}>Retry</button></div>}{notice && <div className="inv-notice" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}>×</button></div>}
      <section className="inv-metrics" aria-label="Inventory summary"><article><span>AVAILABLE UNITS</span><strong>{loading ? "—" : totals.units.toLocaleString("en-BD")}</strong><small>Across active medicines</small></article><article><span>LOW STOCK</span><strong className={totals.low ? "inv-alert-value" : ""}>{loading ? "—" : totals.low}</strong><small>At or below minimum level</small></article><article><span>STOCK AT PURCHASE COST</span><strong>{loading ? "—" : money(totals.value)}</strong><small>Quantity × weighted average cost</small></article></section>
      {showReceive && <section className="inv-form-panel"><div className="inv-form-title"><div><span className="inv-kicker">STOCK IN</span><h2>Receive medicine</h2></div><button type="button" aria-label="Close form" onClick={() => setShowReceive(false)}>×</button></div><form onSubmit={receiveStock} className="inv-form"><label>Medicine<select required value={medicineId} onChange={(event) => setMedicineId(event.target.value)}><option value="">Select medicine</option>{medicines.filter((medicine) => medicine.is_active).map((medicine) => <option key={medicine.id} value={medicine.id}>{medicine.name}{medicine.strength ? ` · ${medicine.strength}` : ""}</option>)}</select></label><label>Quantity received<input required type="number" min="1" max="2147483647" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="0"/></label><label>Total purchase cost (&#2547;)<input required type="number" min="0" max="999999999999.99" step="0.01" inputMode="decimal" value={totalPurchaseCost} onChange={(event) => setTotalPurchaseCost(event.target.value)} placeholder="0.00"/><small>Include acquisition or delivery expenses in inventory cost</small></label><label>Calculated cost per unit<output aria-live="polite" style={{ display: "block", minHeight: 45, padding: "14px 11px", border: "1px solid #b7cbc0", background: "#f7faf7", color: "#173e39", fontSize: 13, fontWeight: 600 }}>{calculatedUnitCost(totalPurchaseCost, quantity) || "Enter quantity and total cost"}</output></label><label>Note <span className="optional">OPTIONAL</span><input maxLength={500} value={receiptNotes} onChange={(event) => setReceiptNotes(event.target.value)} placeholder="Supplier or receipt reference"/></label><div className="inv-form-actions"><button type="button" className="inv-quiet" onClick={() => setShowReceive(false)}>Cancel</button><button className="inv-primary" disabled={saving}>{saving ? "Saving receipt…" : "Confirm receipt"}</button></div></form></section>}
      <section className="inv-stock-section"><div className="inv-section-head"><div><span className="inv-kicker">MEDICINE STOCK</span><h2>Current quantities</h2></div><div className="inv-controls"><label className="inv-search"><span>⌕</span><input aria-label="Search medicines" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search medicines"/></label><button className={lowOnly ? "inv-filter selected" : "inv-filter"} type="button" aria-pressed={lowOnly} onClick={() => setLowOnly((value) => !value)}>Low stock <span>{loading ? "—" : totals.low}</span></button></div></div>
        {loading ? <div className="inv-loading"><i/><i/><i/></div> : !visible.length ? <div className="inv-empty"><span>□</span><b>{medicines.length ? "No medicines match this view" : "No medicines yet"}</b><small>{medicines.length ? "Change the search or low-stock filter." : "Add a medicine, then receive its first stock."}</small></div> : <div className="inv-stock-list">{visible.map((medicine) => { const low = medicine.stock_quantity <= medicine.min_stock_level; return <article className="inv-stock-row" key={medicine.id}><div className="inv-med-name"><span className="inv-med-mark">Rx</span><div><b>{medicine.name}</b><small>{[medicine.generic_name, medicine.strength, medicine.dosage_form].filter(Boolean).join(" · ") || "Medicine"}</small></div></div><div className="inv-stock-cell"><span>IN STOCK</span><strong>{medicine.stock_quantity.toLocaleString("en-BD")} <small>units</small></strong></div><div className="inv-stock-cell"><span>AVERAGE COST</span><strong>{moneyCost(medicine.purchase_cost_avg)}</strong></div><div className="inv-stock-cell"><span>SELLING PRICE</span><strong>{money(medicine.selling_price)}</strong></div><div className="inv-status"><span className={low ? "inv-status-pill low" : "inv-status-pill good"}>{low ? "Low stock" : "In stock"}</span><small>Minimum {medicine.min_stock_level}</small></div><div className="inv-row-actions"><button className="inv-adjust" type="button" disabled={!stockActivityLoaded || medicine.stock_quantity !== 0 || stockActivityMedicineIds.includes(medicine.id)} title={!stockActivityLoaded ? "Loading stock activity status" : medicine.stock_quantity !== 0 || stockActivityMedicineIds.includes(medicine.id) ? "Cost can only be set before stock activity begins" : undefined} onClick={() => { setInitialCostMedicine(medicine); setInitialCostValue(""); setInitialCostReason(""); setInitialCostError(""); setNotice(""); }}>Set initial cost</button>{role === "owner" && <button className="inv-adjust" type="button" onClick={() => { setAdjusting(medicine); setNewQuantity(String(medicine.stock_quantity)); setNotice(""); }}>Correct count</button>}</div></article>; })}</div>}
      </section>
      <section className="inv-history"><div className="inv-section-head"><div><span className="inv-kicker">AUDIT TRAIL</span><h2>Stock movements</h2><p>Latest 100 medicine-level receipts, sales, and corrections.</p></div><button className="inv-filter" type="button" aria-expanded={showHistory} onClick={() => setShowHistory((open) => !open)}>{showHistory ? "Hide history" : "Show history"}</button></div>{showHistory && (movements.length ? <div className="inv-movement-list">{movements.map((movement) => { const medicine = medicines.find((item) => item.id === movement.medicine_id); const movementName = movement.movement_type.replaceAll("_", " ").toLowerCase(); return <article className="inv-movement" key={movement.id}><span className={`inv-movement-sign ${movement.quantity_delta < 0 ? "out" : "in"}`}>{movement.quantity_delta > 0 ? "+" : ""}{movement.quantity_delta}</span><div className="inv-movement-detail"><b>{medicine?.name ?? "Medicine"} <span>· {movementName}</span></b><small>{movement.reason || (movement.related_invoice_id ? `Invoice ${movement.related_invoice_id}` : "No additional note")} · {dateTime(movement.created_at)}</small></div><div className="inv-movement-balance"><b>{movement.previous_quantity} → {movement.resulting_quantity}</b><small>{movement.purchase_cost == null ? "" : `${money(movement.purchase_cost)} / unit`}</small></div></article>; })}</div> : <div className="inv-empty compact"><b>No stock movements recorded</b><small>Receipts, sales, and corrections will appear here.</small></div>)}</section>
      <footer className="inv-footer"><span>RETINA · MEDICINE-WISE INVENTORY</span><span>Weighted-average purchase cost</span></footer>
    </div>
    {initialCostMedicine && <div className="inv-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !initialCostSaving) setInitialCostMedicine(null); }}><section className="inv-modal" role="dialog" aria-modal="true" aria-labelledby="initial-cost-title"><span className="inv-kicker">COST INITIALIZATION</span><h2 id="initial-cost-title">Set purchase cost</h2><p>{initialCostMedicine.name} | current average cost <b>{moneyCost(initialCostMedicine.purchase_cost_avg)}</b></p><p>Enter the confirmed current unit purchase cost. Historical batch prices are not used. This does not change stock quantity and is available only before stock activity begins.</p>{initialCostError && <div className="inv-error" role="alert">{initialCostError}</div>}<form onSubmit={initializeMedicineCost}><label>Current purchase cost per unit<input required type="number" min="0" max="999999999999.9999" step="0.0001" inputMode="decimal" value={initialCostValue} onChange={(event) => setInitialCostValue(event.target.value)} placeholder="Enter confirmed cost"/><small>Up to four decimal places; leave blank until the current cost is confirmed.</small></label><label>Reason<input required maxLength={500} value={initialCostReason} onChange={(event) => setInitialCostReason(event.target.value)} placeholder="Explain the source or reason for this cost"/></label><div className="inv-form-actions"><button className="inv-quiet" type="button" disabled={initialCostSaving} onClick={() => setInitialCostMedicine(null)}>Cancel</button><button className="inv-primary" disabled={initialCostSaving}>{initialCostSaving ? "Saving cost..." : "Save initial cost"}</button></div></form></section></div>}
    {adjusting && <div className="inv-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdjusting(null); }}><section className="inv-modal" role="dialog" aria-modal="true" aria-labelledby="adjust-title"><span className="inv-kicker">OWNER CONTROL</span><h2 id="adjust-title">Correct stock count</h2><p>{adjusting.name} · current total <b>{adjusting.stock_quantity} units</b></p><form onSubmit={saveCorrection}><label>Corrected total quantity<input required type="number" min="0" step="1" inputMode="numeric" value={newQuantity} onChange={(event) => setNewQuantity(event.target.value)}/></label><label>Reason<input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the count correction"/></label><label>Stock adjustment password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)}/></label><div className="inv-form-actions"><button className="inv-quiet" type="button" onClick={() => setAdjusting(null)}>Cancel</button><button className="inv-primary" disabled={adjustmentSaving}>{adjustmentSaving ? "Saving…" : "Confirm correction"}</button></div></form></section></div>}
    <style jsx global>{`
      .inv-nav-opening{padding:0;border:0;background:transparent;color:#087c73;font:700 12px Arial,sans-serif;cursor:pointer}.inv-opening-shell{padding-top:0}.inv-form-help{margin:0 0 14px;color:#64776e;font-size:12px;line-height:1.5}.inv-opening-form{grid-template-columns:minmax(220px,1fr) minmax(150px,.7fr)}.inv-opening-form .inv-form-actions{grid-column:1/-1}
      .inventory-page{--inv-ink:#123d3a;--inv-teal:#087c73;--inv-paper:#f2f6f3;min-height:100vh;background:var(--inv-paper);color:var(--inv-ink);font-family:Arial,Helvetica,sans-serif;font-size:14px}.inventory-page *{box-sizing:border-box}.inv-header{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 max(24px,calc((100vw - 1320px)/2));background:#fbfcfa;border-bottom:1px solid #d5e1da}.inv-brand{display:flex;align-items:center;gap:11px;color:var(--inv-ink);text-decoration:none;font-weight:900;letter-spacing:.1em}.inv-brand>span{display:grid;width:37px;height:37px;place-items:center;border:1px solid #123d3a;background:#b1e2d5;font:24px Georgia,serif;box-shadow:3px 3px #123d3a}.inv-brand small{display:block;margin-top:4px;color:#70817a;font-size:8px;letter-spacing:.15em}.inv-header nav{display:flex;gap:22px}.inv-header nav a{color:#527068;text-decoration:none;font-size:12px;font-weight:700}.inv-header nav a:hover{color:var(--inv-teal)}.inv-shell{width:min(1320px,100%);margin:auto;padding:34px 26px 22px}.inv-intro,.inv-section-head{display:flex;align-items:center;justify-content:space-between;gap:18px}.inv-intro{padding-bottom:25px;border-bottom:1px solid #d1ddd5}.inv-kicker{color:#4e766c;font-size:9px;font-weight:800;letter-spacing:.15em}.inv-intro h1{margin:8px 0 5px;font-size:34px;letter-spacing:-.04em}.inv-intro p,.inv-section-head p{margin:0;color:#64776e;font-size:13px;line-height:1.5}.inv-primary{display:inline-flex;min-height:48px;align-items:center;justify-content:center;gap:9px;padding:0 17px;border:1.5px solid #102725;background:#087c73;color:#fff;font-size:13px;font-weight:800;cursor:pointer;box-shadow:3px 3px #102725;transition:background .18s,color .18s,transform .18s}.inv-primary:hover{background:#c7e9dd;color:var(--inv-ink)}.inv-primary:active{transform:translate(2px,2px);box-shadow:1px 1px #102725}.inv-primary:disabled{opacity:.6;cursor:wait}.inv-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:22px 0 28px;border:1px solid #cbd9d1;background:#fff;box-shadow:3px 3px #dce7df}.inv-metrics article{display:grid;min-height:119px;align-content:center;gap:8px;padding:16px 22px}.inv-metrics article+article{border-left:1px solid #dce6df}.inv-metrics article>span,.inv-stock-cell>span{color:#657970;font-size:9px;font-weight:800;letter-spacing:.12em}.inv-metrics strong{font-size:27px;letter-spacing:-.03em}.inv-metrics small{color:#73847b;font-size:11px}.inv-alert-value{color:#a64d3e}.inv-form-panel{margin:0 0 28px;padding:21px;border:1px solid #bdcec4;background:#e4f1e9;box-shadow:3px 3px #c8d8ce}.inv-form-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.inv-form-title h2,.inv-section-head h2{margin:5px 0 0;font-size:21px;letter-spacing:-.02em}.inv-form-title>button{width:40px;height:40px;border:1px solid #aec2b6;background:#fff;color:var(--inv-ink);font-size:22px;cursor:pointer}.inv-form{display:grid;grid-template-columns:1.5fr .8fr 1fr 1.2fr;align-items:start;gap:13px}.inv-form label,.inv-modal label{display:grid;gap:7px;color:#34574e;font-size:11px;font-weight:800}.inv-form input,.inv-form select,.inv-modal input{width:100%;min-width:0;min-height:45px;padding:0 11px;border:1px solid #b7cbc0;border-radius:0;background:#fff;color:#173e39;font:13px Arial,sans-serif}.inv-form input:focus,.inv-form select:focus,.inv-modal input:focus,.inv-search input:focus{outline:2px solid #e6ac4e;outline-offset:1px}.inv-form label small{color:#75867d;font-size:10px;font-weight:400}.optional{color:#8b9a93;font-size:8px}.inv-form-actions{display:flex;grid-column:1/-1;justify-content:flex-end;gap:10px;padding-top:4px}.inv-quiet{min-height:44px;padding:0 16px;border:1px solid #aebfb5;background:#fff;color:#31574e;font-weight:700;cursor:pointer}.inv-stock-section,.inv-history{margin-top:27px}.inv-section-head{align-items:end;margin-bottom:14px}.inv-section-head h2{font-size:21px}.inv-section-head p{margin-top:5px;font-size:11px}.inv-controls{display:flex;align-items:center;gap:9px}.inv-search{display:flex;width:min(270px,35vw);height:42px;align-items:center;gap:7px;padding:0 10px;border:1px solid #c4d3cb;background:#fff;color:#6d8177}.inv-search>span{font-size:19px}.inv-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:#183d39;font:12px Arial,sans-serif}.inv-filter{display:flex;min-height:42px;align-items:center;gap:9px;padding:0 12px;border:1px solid #c4d3cb;background:#fff;color:#355b51;font-size:11px;font-weight:700;cursor:pointer}.inv-filter>span{display:grid;min-width:21px;height:21px;place-items:center;background:#eff4f0;color:#587065;font-size:10px}.inv-filter.selected{border-color:#087c73;background:#e1f2ec;color:#087c73}.inv-stock-list{display:grid;border:1px solid #cedbd3;background:#fff;box-shadow:2px 2px #dce7df}.inv-stock-row{display:grid;grid-template-columns:minmax(180px,1.7fr) repeat(3,minmax(115px,.85fr)) minmax(110px,.8fr) auto;align-items:center;gap:16px;min-height:88px;padding:13px 16px;border-bottom:1px solid #e6ece7}.inv-stock-row:last-child{border-bottom:0}.inv-med-name{display:flex;min-width:0;align-items:center;gap:11px}.inv-med-mark{display:grid;width:38px;height:38px;flex:0 0 38px;place-items:center;border:1px solid #cddbd2;background:#e9f3ed;color:#148074;font-size:11px;font-weight:800}.inv-med-name>div{min-width:0}.inv-med-name b,.inv-med-name small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.inv-med-name b{font-size:13px}.inv-med-name small{margin-top:4px;color:#718178;font-size:10px}.inv-stock-cell{display:grid;gap:6px;min-width:0}.inv-stock-cell>strong{overflow:hidden;font-size:14px;text-overflow:ellipsis;white-space:nowrap}.inv-stock-cell>strong small{color:#75867e;font-size:10px;font-weight:500}.inv-status{display:grid;justify-items:start;gap:6px}.inv-status-pill{padding:5px 7px;font-size:9px;font-weight:800}.inv-status-pill.good{background:#e4f3e9;color:#25806a}.inv-status-pill.low{background:#fff1e1;color:#a16d23}.inv-status>small{color:#7b8982;font-size:9px}.inv-row-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end}.inv-adjust{min-height:38px;padding:0 9px;border:1px solid #b9cbc1;background:#fff;color:#34584f;font-size:10px;font-weight:700;white-space:nowrap;cursor:pointer}.inv-adjust:hover{border-color:#087c73;color:#087c73}.inv-history{padding-top:20px;border-top:1px solid #d1ddd5}.inv-movement-list{border-top:1px solid #dbe5de}.inv-movement{display:flex;min-height:65px;align-items:center;gap:12px;padding:9px 12px;border-bottom:1px solid #e0e8e2;background:#fff}.inv-movement-sign{display:grid;min-width:55px;height:32px;place-items:center;font-size:12px;font-weight:800}.inv-movement-sign.in{background:#e6f3eb;color:#16806e}.inv-movement-sign.out{background:#fff0ec;color:#aa5046}.inv-movement-detail{min-width:0;flex:1}.inv-movement-detail b,.inv-movement-detail small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.inv-movement-detail b{font-size:11px;text-transform:capitalize}.inv-movement-detail b span{color:#60756b;font-weight:500}.inv-movement-detail small{margin-top:4px;color:#77877f;font-size:10px}.inv-movement-balance{display:grid;justify-items:end;gap:4px;font-size:11px;white-space:nowrap}.inv-movement-balance small{color:#74847b;font-size:9px}.inv-empty{display:grid;min-height:170px;align-content:center;justify-items:center;gap:8px;border:1px solid #d4e0d8;background:#fff;text-align:center}.inv-empty>span{color:#168074;font-size:24px}.inv-empty b{font-size:14px}.inv-empty small{color:#75857d;font-size:11px}.inv-empty.compact{min-height:85px}.inv-loading{display:grid;gap:7px}.inv-loading i{height:67px;background:linear-gradient(90deg,#e8eee9,#f8faf8,#e8eee9);background-size:200% 100%;animation:inv-shimmer 1.4s infinite}.inv-error,.inv-notice{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:15px 0;padding:12px 15px;border:1px solid #e0bdb7;background:#fff4f1;color:#82463d;font-size:12px}.inv-notice{border-color:#bfd8ca;background:#eaf5ed;color:#285d4e}.inv-error button,.inv-notice button{min-width:34px;min-height:34px;border:1px solid currentColor;background:#fff;color:inherit;cursor:pointer}.inv-footer{display:flex;justify-content:space-between;gap:12px;margin-top:24px;padding:14px 2px;border-top:1px solid #d5dfd8;color:#798981;font-size:9px;font-weight:700;letter-spacing:.1em}.inv-modal-backdrop{position:fixed;z-index:100;inset:0;display:grid;place-items:center;padding:18px;background:#092d2bb8}.inv-modal{width:min(480px,100%);padding:23px;border:1.5px solid #102725;background:#f8faf7;box-shadow:5px 5px #102725}.inv-modal h2{margin:7px 0;font-size:24px}.inv-modal>p{margin:0 0 20px;color:#5e746a;font-size:12px}.inv-modal form{display:grid;gap:15px}.inv-modal .inv-form-actions{padding-top:5px}.inv-gate{min-height:100vh;display:grid;place-items:center;padding:20px;background:#f2f6f3;color:#153e39;font:14px Arial,sans-serif}.inv-gate section{width:min(440px,100%);padding:27px;border:1px solid #153e39;background:white;box-shadow:4px 4px #153e39}.inv-gate h1{margin:8px 0}.inv-gate p{color:#63766e;line-height:1.6}.inv-gate a{color:#087c73;font-weight:700}.inventory-page :is(a,button):focus-visible{outline:3px solid #e4a63e;outline-offset:2px}@keyframes inv-shimmer{to{background-position:-200% 0}}@media(prefers-reduced-motion:reduce){.inventory-page *{animation:none!important;transition:none!important}}
      @media(max-width:1000px){.inv-stock-row{grid-template-columns:minmax(160px,1.5fr) repeat(2,minmax(110px,1fr)) minmax(100px,.8fr);gap:12px}.inv-status{grid-column:2}.inv-row-actions{grid-column:4;grid-row:2;flex-direction:column}.inv-row-actions .inv-adjust{width:100%}.inv-stock-cell:nth-of-type(4){grid-column:3;grid-row:2}}
      @media(max-width:680px){.inv-header{height:60px;padding:0 14px}.inv-header nav{gap:12px}.inv-header nav a{font-size:10px}.inv-brand{gap:8px;font-size:12px}.inv-brand>span{width:31px;height:31px;font-size:20px}.inv-brand small{font-size:6px}.inv-shell{padding:23px 14px 18px}.inv-intro{align-items:flex-end;gap:10px;padding-bottom:19px}.inv-intro h1{font-size:29px}.inv-intro p{max-width:250px;font-size:11px}.inv-primary{min-height:45px;padding:0 11px;font-size:11px}.inv-metrics{grid-template-columns:1fr;margin:17px 0 23px}.inv-metrics article{min-height:86px;grid-template-columns:1fr auto;align-items:center;gap:4px 10px;padding:12px 15px}.inv-metrics article+article{border-top:1px solid #dce6df;border-left:0}.inv-metrics article>span{align-self:end}.inv-metrics strong{grid-column:2;grid-row:1/3;font-size:23px}.inv-metrics small{font-size:10px}.inv-form-panel{padding:15px}.inv-form{grid-template-columns:1fr 1fr}.inv-form label:first-child,.inv-form label:last-of-type{grid-column:1/-1}.inv-form-actions{grid-column:1/-1}.inv-section-head{align-items:flex-start;flex-direction:column;gap:12px}.inv-controls{width:100%}.inv-search{width:auto;flex:1}.inv-stock-row{grid-template-columns:minmax(0,1fr) minmax(110px,.65fr);gap:12px;padding:14px}.inv-med-name{grid-column:1/-1}.inv-stock-cell{padding-top:2px}.inv-stock-cell:nth-of-type(4){grid-column:2;grid-row:auto}.inv-status{grid-column:1;grid-row:auto}.inv-row-actions{grid-column:2;grid-row:auto;align-items:flex-end;flex-direction:column}.inv-row-actions .inv-adjust{justify-self:end}.inv-stock-cell>strong{font-size:13px}.inv-movement{gap:8px;padding:9px 7px}.inv-movement-sign{min-width:45px}.inv-movement-balance{font-size:10px}.inv-footer{flex-direction:column;gap:7px;font-size:8px}}
      @media(max-width:390px){.inv-header{padding:0 10px}.inv-header nav{gap:8px}.inv-header nav a{font-size:9px}.inv-shell{padding-right:11px;padding-left:11px}.inv-intro h1{font-size:27px}.inv-intro p{font-size:10px}.inv-primary{gap:5px;padding:0 8px;font-size:10px}.inv-form{grid-template-columns:1fr}.inv-form label{grid-column:1/-1}.inv-stock-row{gap:10px;padding:12px 10px}.inv-stock-cell>strong{font-size:12px}.inv-status-pill{font-size:8px}}
    `}</style>
  </main>;
}
