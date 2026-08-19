"use client";

import { useState, useEffect } from "react";
import { Printer, X, Loader2 } from "lucide-react";
import { monthLabel } from "@/lib/session-utils";

interface LevelData {
  class_name: string;
  inscrits: [number, number, number];
  presents: [number, number, number];
  admis: [number, number, number];
  pct_admis: [number, number, number];
}
interface Totals {
  inscrits_g: number; inscrits_f: number; inscrits_t: number;
  presents_g: number; presents_f: number; presents_t: number;
  admis_g: number; admis_f: number; admis_t: number;
  pct_g: number; pct_f: number; pct_t: number;
}
interface SyntheseData {
  iep_name: string;
  iep_region: string;
  school_name: string;
  school_code: string;
  school_addr: string;
  eval_label: string;
  eval_number: number;
  month: number;
  year: number;
  levels: LevelData[];
  totals: Totals;
}

const CLASS_NAMES = ["CP1", "CP2", "CE1", "CE2", "CM1"];
const NAVY = "#000080";

export default function SynthesePage() {
  const [data, setData] = useState<SyntheseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");

    // Récupérer le token depuis localStorage
    let token = "";
    try {
      const raw = localStorage.getItem("sygren-auth");
      if (raw) {
        const parsed = JSON.parse(raw);
        token = parsed?.state?.token ?? "";
      }
    } catch {}

    if (!sessionId) {
      // Use a microtask to avoid synchronous setState in effect
      Promise.resolve().then(() => {
        setLoading(false);
        setError("Session ID manquant");
      });
      return;
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
    const url = `${apiBase}/api/reports/synthese-data?session_id=${sessionId}`;

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        return res.json();
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: NAVY }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 font-semibold">{error || "Erreur"}</p>
          <button
            onClick={() => window.close()}
            className="mt-4 px-4 py-2 bg-gray-200 rounded"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  const fmt = (v: number) => (v > 0 ? String(v) : "—");
  const fmtPct = (v: number) => (v > 0 ? v.toFixed(2) : "—");

  const getLevel = (name: string): LevelData =>
    data.levels.find((l) => l.class_name === name) || {
      class_name: name,
      inscrits: [0, 0, 0],
      presents: [0, 0, 0],
      admis: [0, 0, 0],
      pct_admis: [0, 0, 0],
    };

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm" style={{ color: NAVY }}>
          Document de Synthèse — Aperçu
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-white rounded-md text-sm"
            style={{ background: NAVY }}
          >
            <Printer className="w-4 h-4" />
            Imprimer / PDF
          </button>
          <button
            onClick={() => window.close()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 rounded-md text-sm"
          >
            <X className="w-4 h-4" />
            Fermer
          </button>
        </div>
      </div>

      {/* === DOCUMENT === */}
      <div
        id="synthese-doc"
        className="bg-white mx-auto shadow-lg print:shadow-none print:p-0"
        style={{
          width: "100%",
          maxWidth: "297mm",
          minHeight: "210mm",
          padding: "20px",
          fontFamily: "Helvetica, Arial, sans-serif",
          color: NAVY,
        }}
      >
        {/* En-tête */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div style={{ fontSize: "10px", fontWeight: "bold", lineHeight: "1.5", textAlign: "left" }}>
            <div>République de Côte d&apos;Ivoire</div>
            <div>Ministère de l&apos;Éducation Nationale</div>
            <div>Et de l&apos;Alphabétisation</div>
            <div>Direction Régionale de {data.iep_region}</div>
            <div>Inspection de l&apos;Enseignement</div>
            <div>Préscolaire et Primaire de {data.iep_name}</div>
            <div>BP : {data.school_addr || "—"} / Tél : ............</div>
          </div>
          <div style={{ fontSize: "10px", fontWeight: "bold", textAlign: "right" }}>
            <div style={{ marginBottom: "4px" }}>Union - Discipline - Travail</div>
            <img
              src="/ci-coat-of-arms.png"
              alt="Armoiries Côte d'Ivoire"
              style={{ width: "60px", height: "60px", objectFit: "contain", marginLeft: "auto" }}
            />
            <div style={{ marginTop: "4px" }}>ÉCOLE : {data.school_name}</div>
          </div>
        </div>

        {/* Trait */}
        <hr style={{ borderColor: NAVY, borderWidth: "1px", margin: "8px 0 12px 0" }} />

        {/* Titre */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
          <div style={{ border: `2px solid ${NAVY}`, borderRadius: "8px", padding: "4px 48px", textAlign: "center" }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", letterSpacing: "1px" }}>
              SYNTHÈSE DES RESULTATS
            </div>
            <div style={{ fontSize: "12px", fontWeight: "bold", marginTop: "2px" }}>
              {data.eval_label.toUpperCase()} N°{data.eval_number} DU MOIS DE {monthLabel(data.month).toUpperCase()} {data.year}
            </div>
          </div>
        </div>

        {/* Tableau */}
        <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${NAVY}`, color: NAVY, fontSize: "11px", fontWeight: "bold" }}>
          <thead>
            <tr>
              <th style={{ border: `1px solid ${NAVY}`, background: NAVY, color: "white", padding: "6px", width: "8%" }}></th>
              {CLASS_NAMES.map((cn) => (
                <th key={`h-${cn}`} colSpan={3} style={{ border: `1px solid ${NAVY}`, background: NAVY, color: "white", padding: "6px", textAlign: "center" }}>
                  {cn}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ border: `1px solid ${NAVY}`, background: NAVY, color: "white", padding: "4px" }}></th>
              {CLASS_NAMES.map((cn) => (
                <th key={`g-${cn}`} style={{ border: `1px solid ${NAVY}`, background: NAVY, color: "white", padding: "4px", textAlign: "center", fontSize: "10px", width: "6%" }}>G</th>
              ))}
              {CLASS_NAMES.map((cn) => (
                <th key={`f-${cn}`} style={{ border: `1px solid ${NAVY}`, background: NAVY, color: "white", padding: "4px", textAlign: "center", fontSize: "10px", width: "6%" }}>F</th>
              ))}
              {CLASS_NAMES.map((cn) => (
                <th key={`t-${cn}`} style={{ border: `1px solid ${NAVY}`, background: NAVY, color: "white", padding: "4px", textAlign: "center", fontSize: "10px", width: "6%" }}>T</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* INSCRITS */}
            <tr>
              <td style={{ border: `1px solid ${NAVY}`, padding: "6px 8px" }}>INSCRITS</td>
              {CLASS_NAMES.map((cn) => {
                const lvl = getLevel(cn);
                return (
                  <td key={`ins-${cn}-g`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center" }}>{fmt(lvl.inscrits[0])}</td>
                );
              })}
              {CLASS_NAMES.map((cn) => {
                const lvl = getLevel(cn);
                return (
                  <td key={`ins-${cn}-f`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center" }}>{fmt(lvl.inscrits[1])}</td>
                );
              })}
              {CLASS_NAMES.map((cn) => {
                const lvl = getLevel(cn);
                return (
                  <td key={`ins-${cn}-t`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center" }}>{fmt(lvl.inscrits[2])}</td>
                );
              })}
            </tr>
            {/* PRESENTS */}
            <tr style={{ background: "#f5f5f8" }}>
              <td style={{ border: `1px solid ${NAVY}`, padding: "6px 8px", background: "#f5f5f8" }}>PRÉSENTS</td>
              {CLASS_NAMES.map((cn) => { const lvl = getLevel(cn); return <td key={`pre-${cn}-g`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center", background: "#f5f5f8" }}>{fmt(lvl.presents[0])}</td>; })}
              {CLASS_NAMES.map((cn) => { const lvl = getLevel(cn); return <td key={`pre-${cn}-f`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center", background: "#f5f5f8" }}>{fmt(lvl.presents[1])}</td>; })}
              {CLASS_NAMES.map((cn) => { const lvl = getLevel(cn); return <td key={`pre-${cn}-t`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center", background: "#f5f5f8" }}>{fmt(lvl.presents[2])}</td>; })}
            </tr>
            {/* ADMIS */}
            <tr>
              <td style={{ border: `1px solid ${NAVY}`, padding: "6px 8px" }}>ADMIS</td>
              {CLASS_NAMES.map((cn) => { const lvl = getLevel(cn); return <td key={`adm-${cn}-g`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center" }}>{fmt(lvl.admis[0])}</td>; })}
              {CLASS_NAMES.map((cn) => { const lvl = getLevel(cn); return <td key={`adm-${cn}-f`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center" }}>{fmt(lvl.admis[1])}</td>; })}
              {CLASS_NAMES.map((cn) => { const lvl = getLevel(cn); return <td key={`adm-${cn}-t`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center" }}>{fmt(lvl.admis[2])}</td>; })}
            </tr>
            {/* % ADMIS */}
            <tr style={{ background: "#f5f5f8" }}>
              <td style={{ border: `1px solid ${NAVY}`, padding: "6px 8px", background: "#f5f5f8" }}>% ADMIS</td>
              {CLASS_NAMES.map((cn) => { const lvl = getLevel(cn); return <td key={`pct-${cn}-g`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center", background: "#f5f5f8" }}>{fmtPct(lvl.pct_admis[0])}</td>; })}
              {CLASS_NAMES.map((cn) => { const lvl = getLevel(cn); return <td key={`pct-${cn}-f`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center", background: "#f5f5f8" }}>{fmtPct(lvl.pct_admis[1])}</td>; })}
              {CLASS_NAMES.map((cn) => { const lvl = getLevel(cn); return <td key={`pct-${cn}-t`} style={{ border: `1px solid ${NAVY}`, padding: "6px", textAlign: "center", background: "#f5f5f8" }}>{fmtPct(lvl.pct_admis[2])}</td>; })}
            </tr>
            {/* Récapitulatif */}
            <tr>
              <td colSpan={8} style={{ border: `1px solid ${NAVY}`, padding: "8px", textAlign: "center", fontSize: "13px" }}>
                FILLES : {fmtPct(data.totals.pct_f)} %
              </td>
              <td colSpan={8} style={{ border: `1px solid ${NAVY}`, padding: "8px", textAlign: "center", fontSize: "13px" }}>
                GARÇONS : {fmtPct(data.totals.pct_g)} %
              </td>
            </tr>
            <tr>
              <td colSpan={16} style={{ border: `1px solid ${NAVY}`, padding: "10px", textAlign: "center", fontSize: "16px" }}>
                {fmtPct(data.totals.pct_t)} %
              </td>
            </tr>
          </tbody>
        </table>

        {/* Signatures */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "40px" }}>
          <div style={{ textAlign: "center", width: "40%" }}>
            <div style={{ fontSize: "12px", fontWeight: "bold", textDecoration: "underline" }}>Le Directeur</div>
            <div style={{ height: "60px" }}></div>
            <div style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>
              {data.school_name}
            </div>
          </div>
          <div style={{ textAlign: "right", width: "40%" }}>
            <div style={{ fontSize: "11px", marginBottom: "20px" }}>
              Fait à {data.iep_region}, le ...../...../.....
            </div>
            <div style={{ fontSize: "12px", fontWeight: "bold", textDecoration: "underline" }}>
              L&apos;Inspecteur
            </div>
            <div style={{ height: "40px" }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}
