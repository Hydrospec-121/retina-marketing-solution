"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

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
  purchase_cost_avg: number;
  min_stock_level?: number | null;
  requires_prescription: boolean;
  is_active: boolean;
};

const emptyForm = {
  name: "",
  generic_name: "",
  strength: "",
  dosage_form: "",
  pack_size: "",
  category: "",
  purchase_price: "",
  selling_price: "",
  min_stock_level: "10",
  requires_prescription: false,
};

export default function MedicinesPage() {
  const router = useRouter();
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [accessError, setAccessError] = useState("");
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submissionLock = useRef(false);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">("active");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  async function loadMedicines() {
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("medicines")
        .select(
          "id,name,generic_name,strength,dosage_form,pack_size,category,stock_quantity,purchase_cost_avg,selling_price,min_stock_level,requires_prescription,is_active"
        )
        .order("name", { ascending: true });

      if (error) {
        setMessage("Could not load medicines: " + error.message);
        return false;
      }

      setMedicines((data ?? []) as Medicine[]);
      return true;
    } catch (error) {
      setMessage(
        "Could not load medicines: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    async function checkAccess() {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError || !session?.user) { router.replace("/login"); return; }
      const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
      if (!active) return;
      if (profileError) { setAccessError(`Unable to verify your access: ${profileError.message}`); setAccess("denied"); }
      else if (!( ["owner", "manager", "inventory_manager"] as string[]).includes(profile?.role ?? "")) { setAccessError("Access denied. This page is available to authorized inventory staff only."); setAccess("denied"); }
      else setAccess("allowed");
    }
    checkAccess().catch((reason: unknown) => {
      if (!active) return;
      setAccessError(`Unable to verify your access: ${reason instanceof Error ? reason.message : "Unexpected error."}`);
      setAccess("denied");
    });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (access === "allowed") void loadMedicines();
  }, [access]);

  async function addMedicine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLock.current) return;

    const name = form.name.trim();
    const purchasePriceText = form.purchase_price.trim();
    const sellingPriceText = form.selling_price.trim();
    const pricePattern = /^\d{1,12}(?:\.\d{1,2})?$/;
    const purchasePrice = Number(purchasePriceText);
    const sellingPrice = Number(sellingPriceText);
    const minStockLevelText = form.min_stock_level.trim();
    const minStockLevel = Number(form.min_stock_level);

    if (!name) {
      setMessage('Enter the medicine name.');
      return;
    }
    if (!pricePattern.test(purchasePriceText) || !Number.isFinite(purchasePrice) || purchasePrice < 0) {
      setMessage('Enter a valid purchase price with up to two decimal places.');
      return;
    }
    if (!pricePattern.test(sellingPriceText) || !Number.isFinite(sellingPrice) || sellingPrice < 0) {
      setMessage('Enter a valid selling price with up to two decimal places.');
      return;
    }
    if (!minStockLevelText || !Number.isInteger(minStockLevel) || minStockLevel < 0) {
      setMessage('Minimum stock level must be a whole number (0 or higher).');
      return;
    }

    submissionLock.current = true;
    setSaving(true);
    setMessage('');

    try {
      const { data, error } = await supabase.rpc('create_medicine', {
        p_name: name,
        p_generic_name: form.generic_name.trim() || null,
        p_strength: form.strength.trim() || null,
        p_dosage_form: form.dosage_form.trim() || null,
        p_pack_size: form.pack_size.trim() || null,
        p_category: form.category.trim() || null,
        p_purchase_price: purchasePrice,
        p_selling_price: sellingPrice,
        p_min_stock_level: minStockLevel,
        p_requires_prescription: form.requires_prescription,
      });

      if (error) {
        if (error.code === '23505') {
          setMessage('A medicine with a duplicate value already exists. Check the existing catalogue.');
        } else if (error.code === '42501' || error.code === 'PGRST301') {
          setMessage('Permission denied. Check your owner or authorized staff account.');
        } else {
          setMessage('Could not add medicine: ' + error.message);
        }
        return;
      }
      if (!data) {
        setMessage('The database did not confirm the new medicine.');
        return;
      }

      setForm(emptyForm);
      setShowForm(false);
      setMessage('Medicine added successfully with zero stock.');
      await loadMedicines();
    } catch (error) {
      setMessage('Could not add medicine: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      submissionLock.current = false;
      setSaving(false);
    }
  }
  function startEdit(medicine: Medicine) {
    setEditingId(medicine.id);

    setForm({
      name: medicine.name ?? "",
      generic_name: medicine.generic_name ?? "",
      strength: medicine.strength ?? "",
      dosage_form: medicine.dosage_form ?? "",
      pack_size: medicine.pack_size ?? "",
      category: medicine.category ?? "",
      purchase_price: "",
      selling_price: String(medicine.selling_price ?? ""),
      min_stock_level: String(medicine.min_stock_level ?? 10),
      requires_prescription: Boolean(medicine.requires_prescription),
    });

    setMessage("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function updateMedicine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId || saving) return;

    const name = form.name.trim();
    const sellingPriceText = form.selling_price.trim();
    const sellingPrice = Number(sellingPriceText);
    const minStockLevelText = form.min_stock_level.trim();
    const minStockLevel = Number(form.min_stock_level);

    if (
      !name ||
      !/^\d{1,12}(?:\.\d{1,2})?$/.test(sellingPriceText) ||
      !Number.isFinite(sellingPrice) ||
      sellingPrice < 0 ||
      !Number.isInteger(minStockLevel) ||
      !minStockLevelText ||
      minStockLevel < 0
    ) {
      setMessage("Enter a valid name, selling price and minimum stock level.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const { error } = await supabase
        .from("medicines")
        .update({
          name,
          generic_name: form.generic_name.trim() || null,
          strength: form.strength.trim() || null,
          dosage_form: form.dosage_form.trim() || null,
          pack_size: form.pack_size.trim() || null,
          category: form.category.trim() || null,
          selling_price: sellingPrice,
          min_stock_level: minStockLevel,
          requires_prescription: form.requires_prescription,
        })
        .eq("id", editingId);

      if (error) {
        setMessage("Could not update medicine: " + error.message);
        return;
      }

      setMessage("Medicine updated successfully.");
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      await loadMedicines();
    } catch (error) {
      setMessage(
        "Could not update medicine: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(medicine: Medicine) {
    const action = medicine.is_active ? "archive" : "restore";
    const confirmation = medicine.is_active
      ? `Archive "${medicine.name}"? It will no longer be available for new invoices. Existing stock and invoice history will be preserved.`
      : `Restore "${medicine.name}"? It will be available for new invoices again.`;

    if (!window.confirm(confirmation)) return;

    setActionId(medicine.id);
    setMessage("");

    try {
      const { error } = await supabase
        .from("medicines")
        .update({ is_active: !medicine.is_active })
        .eq("id", medicine.id);

      if (error) {
        setMessage(`Could not ${action} medicine: ${error.message}`);
        return;
      }

      setMessage(
        medicine.is_active
          ? "Medicine archived. Its stock and history are preserved."
          : "Medicine restored."
      );

      await loadMedicines();
    } catch (error) {
      setMessage(
        `Could not ${action} medicine: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    } finally {
      setActionId(null);
    }
  }

  const filteredMedicines = medicines.filter((medicine) => {
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" ? medicine.is_active : !medicine.is_active);
    const matchesSearch = `${medicine.name} ${medicine.generic_name ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase());
    return matchesStatus && matchesSearch;
  });
  const activeMedicineCount = medicines.filter((medicine) => medicine.is_active).length;
  const archivedMedicineCount = medicines.length - activeMedicineCount;

  const inputStyle = {
    width: "100%",
    padding: "12px",
    border: "1px solid #cbd8d5",
    borderRadius: "7px",
    fontSize: "14px",
    background: "#fff",
    color: "#111817",
  };

  const labelStyle = {
    display: "block",
    fontSize: "13px",
    fontWeight: 600,
    marginBottom: "6px",
    color: "#103D3C",
  };

  if (access === "checking") return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#F1F8F6", color: "#103D3C", fontFamily: "Arial, sans-serif" }}>Checking access…</main>;
  if (access === "denied") return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "20px", background: "#F1F8F6", color: "#103D3C", fontFamily: "Arial, sans-serif" }}><section style={{ maxWidth: "460px", padding: "28px", background: "#fff", border: "1.5px solid #111817", boxShadow: "4px 4px 0 #111817" }}><h1>Access denied</h1><p>{accessError}</p><Link href="/admin" style={{ color: "#168C83", fontWeight: 700 }}>Back to dashboard</Link></section></main>;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#F1F8F6",
        color: "#111817",
        padding: "28px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <Link
          href="/admin"
          style={{
            color: "#168C83",
            textDecoration: "none",
            fontSize: "14px",
          }}
        >
          ← Back to Dashboard
        </Link>

        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "15px",
            flexWrap: "wrap",
            margin: "25px 0",
          }}
        >
          <div>
            <p
              style={{
                color: "#168C83",
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "2px",
              }}
            >
              INVENTORY MANAGEMENT
            </p>
            <h1 style={{ fontSize: "30px", margin: "5px 0" }}>Medicines</h1>
            <p style={{ color: "#6E6E6E", fontSize: "14px" }}>
              Manage your medicine catalogue.
            </p>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => {
              const closingNewForm = showForm && !editingId;
              setEditingId(null);
              setForm(emptyForm);
              setMessage("");
              setShowForm(!closingNewForm);
            }}
            style={{
              background: "#168C83",
              color: "#fff",
              border: "none",
              borderRadius: "7px",
              padding: "13px 20px",
              fontWeight: 700,
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.65 : 1,
            }}
          >
            {showForm && !editingId ? "Close Form" : "+ Add Medicine"}
          </button>
        </header>

        {message && (
          <div
            role={message.includes("successfully") ? "status" : "alert"}
            aria-live="polite"
            style={{
              background: message.includes("successfully") ? "#E5F2EF" : "#FFF0ED",
              border: `1px solid ${message.includes("successfully") ? "#168C83" : "#B42318"}`,
              padding: "13px 16px",
              borderRadius: "7px",
              marginBottom: "18px",
              fontSize: "14px",
            }}
          >
            {message}
          </div>
        )}

        {showForm && (
          <form
            onSubmit={editingId ? updateMedicine : addMedicine}
            style={{
              background: "#fff",
              padding: "22px",
              border: "1px solid #cbd8d5",
              borderRadius: "10px",
              marginBottom: "25px",
            }}
          >
            <h2 style={{ marginTop: 0 }}>
              {editingId ? "Edit Medicine" : "New Medicine"}
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "16px",
              }}
            >
              <div>
                <label style={labelStyle}>Medicine name *</label>
                <input
                  style={inputStyle}
                  required
                  maxLength={150}
                  placeholder="e.g. Napa"
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                />
              </div>

              <div>
                <label style={labelStyle}>Generic name</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. Paracetamol"
                  value={form.generic_name}
                  onChange={(e) =>
                    setForm({ ...form, generic_name: e.target.value })
                  }
                />
              </div>

              <div>
                <label style={labelStyle}>Strength</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. 500 mg"
                  value={form.strength}
                  onChange={(e) =>
                    setForm({ ...form, strength: e.target.value })
                  }
                />
              </div>

              <div>
                <label style={labelStyle}>Dosage form</label>
                <input
                  style={inputStyle}
                  placeholder="Tablet, Syrup, Capsule..."
                  value={form.dosage_form}
                  onChange={(e) =>
                    setForm({ ...form, dosage_form: e.target.value })
                  }
                />
              </div>

              <div>
                <label style={labelStyle}>Pack size</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. 10 tablets"
                  value={form.pack_size}
                  onChange={(e) =>
                    setForm({ ...form, pack_size: e.target.value })
                  }
                />
              </div>

              <div>
                <label style={labelStyle}>Category</label>
                <input
                  style={inputStyle}
                  placeholder="e.g. Analgesic"
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                />
              </div>

              {!editingId && <div>
                <label style={labelStyle}>Purchase price (buy price) ৳ *</label>
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  max="999999999999.99"
                  step="0.01"
                  inputMode="decimal"
                  required
                  placeholder="e.g. 8.50"
                  value={form.purchase_price}
                  onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                />
              </div>}

              <div>
                <label style={labelStyle}>Selling price (sell price) ৳ *</label>
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  max="999999999999.99"
                  step="0.01"
                  inputMode="decimal"
                  required
                  placeholder="e.g. 10.00"
                  value={form.selling_price}
                  onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                />
              </div>
              <div>
                <label style={labelStyle}>Min stock level *</label>
                <input
                  style={inputStyle}
                  type="number"
                  min="0"
                  step="1"
                  required
                  placeholder="e.g. 10"
                  value={form.min_stock_level}
                  onChange={(e) =>
                    setForm({ ...form, min_stock_level: e.target.value })
                  }
                />
              </div>
            </div>

            <label
              style={{
                display: "flex",
                gap: "9px",
                alignItems: "center",
                marginTop: "20px",
                fontSize: "14px",
              }}
            >
              <input
                type="checkbox"
                checked={form.requires_prescription}
                onChange={(e) =>
                  setForm({
                    ...form,
                    requires_prescription: e.target.checked,
                  })
                }
              />
              Requires prescription
            </label>

            <div
              style={{
                display: "flex",
                gap: "10px",
                marginTop: "22px",
                flexWrap: "wrap",
              }}
            >
              <button
                type="submit"
                disabled={saving}
                style={{
                  background: "#168C83",
                  color: "#fff",
                  border: "none",
                  borderRadius: "7px",
                  padding: "12px 20px",
                  fontWeight: 700,
                  cursor: saving ? "wait" : "pointer",
                  opacity: saving ? 0.65 : 1,
                }}
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Save Changes"
                    : "Save Medicine"}
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                  setForm(emptyForm);
                }}
                style={{
                  background: "#eee",
                  color: "#111",
                  border: "none",
                  borderRadius: "7px",
                  padding: "12px 20px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px",
            marginBottom: "18px",
          }}
        >
          <input
            style={inputStyle}
            aria-label="Search medicines by name or generic name"
            placeholder="Search medicines by name or generic..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label style={{ ...labelStyle, marginBottom: 0 }}>
            Medicine status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              style={{ ...inputStyle, marginTop: "6px" }}
            >
              <option value="active">Active ({activeMedicineCount})</option>
              <option value="archived">Archived ({archivedMedicineCount})</option>
              <option value="all">All medicines ({medicines.length})</option>
            </select>
          </label>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #cbd8d5",
            borderRadius: "10px",
            overflowX: "auto",
          }}
        >
          {loading ? (
            <p style={{ padding: "25px" }}>Loading medicines...</p>
          ) : filteredMedicines.length === 0 ? (
            <p style={{ padding: "25px", color: "#6E6E6E" }}>
              {search.trim()
                ? `No ${statusFilter === "all" ? "" : `${statusFilter} `}medicines match your search.`
                : statusFilter === "archived"
                  ? "No archived medicines. Archived medicines will appear here so you can restore them."
                  : statusFilter === "active"
                    ? "No active medicines. Click Add Medicine to create your first entry."
                    : "No medicines found. Click Add Medicine to create your first entry."}
            </p>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: "850px",
                textAlign: "left",
              }}
            >
              <thead>
                <tr style={{ background: "#E5F2EF" }}>
                  {[
                    "Medicine",
                    "Generic",
                    "Strength",
                    "Form",
                    "In Stock",
                    "Avg. Cost",
                    "Price",
                    "Min Stock",
                    "Status",
                    "Actions",
                  ].map((heading) => (
                    <th
                      key={heading}
                      style={{ padding: "14px", fontSize: "13px" }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredMedicines.map((medicine) => (
                  <tr key={medicine.id}>
                    <td
                      style={{
                        padding: "14px",
                        borderTop: "1px solid #eee",
                        fontWeight: 600,
                      }}
                    >
                      {medicine.name}
                    </td>

                    <td style={{ padding: "14px", borderTop: "1px solid #eee" }}>
                      {medicine.generic_name || "—"}
                    </td>

                    <td style={{ padding: "14px", borderTop: "1px solid #eee" }}>
                      {medicine.strength || "—"}
                    </td>

                    <td style={{ padding: "14px", borderTop: "1px solid #eee" }}>
                      {medicine.dosage_form || "—"}
                    </td>

                    <td style={{ padding: "14px", borderTop: "1px solid #eee" }}>
                      {Number(medicine.stock_quantity || 0).toLocaleString("en-BD")} units
                    </td>

                    <td style={{ padding: "14px", borderTop: "1px solid #eee" }}>
                      ৳{Number(medicine.purchase_cost_avg || 0).toFixed(4)}
                    </td>

                    <td style={{ padding: "14px", borderTop: "1px solid #eee" }}>
                      ৳{Number(medicine.selling_price).toFixed(2)}
                    </td>

                    <td style={{ padding: "14px", borderTop: "1px solid #eee" }}>
                      {medicine.min_stock_level ?? 10} units
                    </td>

                    <td style={{ padding: "14px", borderTop: "1px solid #eee" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "5px 9px",
                          borderRadius: "999px",
                          background: medicine.is_active ? "#E5F2EF" : "#F1F2F1",
                          color: medicine.is_active ? "#103D3C" : "#59635F",
                          fontSize: "12px",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {medicine.is_active ? "Active" : "Archived"}
                      </span>
                      <div style={{ marginTop: "5px", color: "#6E6E6E", fontSize: "11px", minWidth: "120px" }}>
                        {medicine.is_active ? "Available for new invoices" : "Not available for new invoices"}
                      </div>
                    </td>

                    <td style={{ padding: "10px", borderTop: "1px solid #eee" }}>
                      <div
                        style={{
                          display: "flex",
                          gap: "6px",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => startEdit(medicine)}
                          disabled={actionId === medicine.id}
                          style={{
                            padding: "7px 10px",
                            border: "1px solid #168C83",
                            borderRadius: "6px",
                            background: "#fff",
                            color: "#103D3C",
                            cursor: "pointer",
                          }}
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleArchive(medicine)}
                          disabled={actionId === medicine.id}
                          style={{
                            padding: "7px 10px",
                            border: "1px solid #cbd8d5",
                            borderRadius: "6px",
                            background: "#fff",
                            color: "#103D3C",
                            cursor: "pointer",
                          }}
                        >
                          {actionId === medicine.id
                            ? "Working…"
                            : medicine.is_active
                              ? "Archive"
                              : "Restore"}
                        </button>

                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p
          style={{
            color: "#6E6E6E",
            fontSize: "13px",
            marginTop: "14px",
          }}
        >
          Total medicines: {medicines.length}
        </p>
      </div>
    </main>
  );
}
