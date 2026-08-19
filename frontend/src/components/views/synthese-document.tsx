"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer, X, Loader2 } from "lucide-react";
import { reportsApi } from "@/lib/api";
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

export function SyntheseDocument({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["synthese-data", sessionId],
    queryFn: () => reportsApi.getSyntheseData(sessionId),
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <p className="text-red-600">Erreur : {(error as Error)?.message}</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-200 rounded">Fermer</button>
        </div>
      </div>
    );
  }

  const fmt = (v: number) => v > 0 ? String(v) : "—";
  const fmtPct = (v: number) => v > 0 ? v.toFixed(2) : "—";

  // Helper pour trouver un niveau par nom
  const getLevel = (name: string): LevelData => {
    return data.levels.find((l) => l.class_name === name) || {
      class_name: name, inscrits: [0, 0, 0], presents: [0, 0, 0], admis: [0, 0, 0], pct_admis: [0, 0, 0],
    };
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 overflow-auto print:bg-white print:static print:overflow-visible">
      {/* Barre d'outils */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">Document de Synthèse — Aperçu</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 text-white rounded-md text-sm hover:bg-blue-800"
          >
            <Printer className="w-4 h-4" />
            Imprimer / PDF
          </button>
          <button
            onClick={onClose}
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
          overflowX: "auto",
        }}
      >
        {/* En-tête */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          {/* Gauche */}
          <div style={{ fontSize: "10px", fontWeight: "bold", lineHeight: "1.5", textAlign: "left" }}>
            <div>République de Côte d&apos;Ivoire</div>
            <div>Ministère de l&apos;Éducation Nationale</div>
            <div>Et de l&apos;Alphabétisation</div>
            <div>Direction Régionale de {data.iep_region}</div>
            <div>Inspection de l&apos;Enseignement</div>
            <div>Préscolaire et Primaire de {data.iep_name}</div>
            <div>BP : {data.school_addr || "—"} / Tél : ............</div>
          </div>
          {/* Droite */}
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
          <div style={{
            border: `2px solid ${NAVY}`,
            borderRadius: "8px",
            padding: "4px 48px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", letterSpacing: "1px" }}>
              SYNTHÈSE DES RESULTATS
            </div>
            <div style={{ fontSize: "12px", fontWeight: "bold", marginTop: "2px" }}>
              {data.eval_label.toUpperCase()} N°{data.eval_number} DU MOIS DE {monthLabel(data.month).toUpperCase()} {data.year}
            </div>
          </div>
        </div>

        {/* Tableau */}
        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          border: `1px solid ${NAVY}`,
          color: NAVY,
          fontSize: "11px",
          fontWeight: "bold",
        }}>
          <thead>
            <tr>
              <th style={{ border: `1px solid ${NAVY}`, background: NAVY, color: "white", padding: "6px", width: "8%" }}></th>
              {CLASS_NAMES.map((cn) => (
                <th key={cn} colSpan={3} style={{ border: `1px solid ${NAVY}`, background: NAVY, color: "white", padding: "6px", textAlign: "center" }}>
                  {cn}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ border: `1px solid ${NAVY}`, background: NAVY, color: "white", padding: "4px" }}></th>
              {CLASS_NAMES.map((cn) => (
                <SubHeaders key={cn} />
              ))}
            </tr>
          </thead>
          <tbody>
            {["INSCRITS", "PRÉSENTS", "ADMIS", "% ADMIS"].map((label, rowIdx) => (
              <DataRow
                key={label}
                label={label}
                rowIdx={rowIdx}
                levels={CLASS_NAMES.map(getLevel)}
                fmt={fmt}
                fmtPct={fmtPct}
              />
            ))}
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

// Sous-composant pour les en-têtes G/F/T
function SubHeaders() {
  const navy = "#000080";
  const style = { border: `1px solid ${navy}`, background: navy, color: "white" as const, padding: "4px", textAlign: "center" as const, fontSize: "10px", width: "6%" };
  return (
    <>
      <th style={style}>G</th>
      <th style={style}>F</th>
      <th style={style}>T</th>
    </>
  );
}

// Sous-composant pour une ligne de données
function DataRow({
  label,
  rowIdx,
  levels,
  fmt,
  fmtPct,
}: {
  label: string;
  rowIdx: number;
  levels: LevelData[];
  fmt: (v: number) => string;
  fmtPct: (v: number) => string;
}) {
  const navy = "#000080";
  const bg = rowIdx % 2 === 0 ? "#f5f5f8" : "transparent";
  const cellStyle = { border: `1px solid ${navy}`, padding: "6px", textAlign: "center" as const, background: bg };

  return (
    <tr>
      <td style={{ border: `1px solid ${navy}`, padding: "6px 8px", background: bg }}>{label}</td>
      {levels.map((lvl) => {
        const vals = rowIdx === 0 ? lvl.inscrits : rowIdx === 1 ? lvl.presents : rowIdx === 2 ? lvl.admis : lvl.pct_admis;
        const fmtFn = rowIdx === 3 ? fmtPct : fmt;
        return (
          <RowCells key={lvl.class_name} vals={vals} fmtFn={fmtFn} cellStyle={cellStyle} />
        );
      })}
    </tr>
  );
}

function RowCells({
  vals,
  fmtFn,
  cellStyle,
}: {
  vals: [number, number, number];
  fmtFn: (v: number) => string;
  cellStyle: React.CSSProperties;
}) {
  return (
    <>
      <td style={cellStyle}>{fmtFn(vals[0])}</td>
      <td style={cellStyle}>{fmtFn(vals[1])}</td>
      <td style={cellStyle}>{fmtFn(vals[2])}</td>
    </>
  );
}
