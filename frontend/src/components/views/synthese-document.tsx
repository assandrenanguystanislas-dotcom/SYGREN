"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer, X, Loader2 } from "lucide-react";
import { reportsApi } from "@/lib/api";
import { monthLabel } from "@/lib/session-utils";

// Types pour les données de synthèse
interface SyntheseLevelData {
  class_name: string;
  inscrits: [number, number, number];
  presents: [number, number, number];
  admis: [number, number, number];
  pct_admis: [number, number, number];
}
interface SyntheseTotals {
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
  levels: SyntheseLevelData[];
  totals: SyntheseTotals;
}

const CLASS_NAMES = ["CP1", "CP2", "CE1", "CE2", "CM1"];

export function SyntheseDocument({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["synthese-data", sessionId],
    queryFn: () => reportsApi.getSyntheseData(sessionId),
  });

  function handlePrint() {
    window.print();
  }

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

  const fmt = (v: number) => v > 0 ? v.toString() : "—";
  const fmtPct = (v: number) => v > 0 ? v.toFixed(2) : "—";

  return (
    <>
      {/* Barre d'outils (non imprimée) */}
      <div className="fixed inset-0 z-50 bg-black/50 overflow-auto print:bg-white print:static print:overflow-visible">
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
          <h3 className="font-semibold text-sm">Document de Synthèse — Aperçu</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
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

        {/* === DOCUMENT (rendu identique au modèle) === */}
        <div
          id="synthese-doc"
          className="bg-white mx-auto p-8 shadow-lg print:shadow-none print:p-0"
          style={{
            width: "297mm",
            minHeight: "210mm",
            fontFamily: "'Helvetica', 'Arial', sans-serif",
            color: "#000080",
          }}
        >
          {/* === En-tête === */}
          <div className="flex justify-between items-start mb-2" style={{ color: "#000080" }}>
            {/* Gauche : Administration */}
            <div className="text-left" style={{ fontSize: "10px", fontWeight: "bold", lineHeight: "1.5" }}>
              <div>République de Côte d'Ivoire</div>
              <div>Ministère de l'Éducation Nationale</div>
              <div>Et de l'Alphabétisation</div>
              <div>Direction Régionale de {data.iep_region}</div>
              <div>Inspection de l'Enseignement</div>
              <div>Préscolaire et Primaire de {data.iep_name}</div>
              <div>BP : {data.school_addr} / Tél : ............</div>
              <div>Courriel : ............</div>
            </div>
            {/* Droite : République + Écusson + École */}
            <div className="text-right flex flex-col items-end" style={{ fontSize: "10px", fontWeight: "bold" }}>
              <div style={{ marginBottom: "4px" }}>Union - Discipline - Travail</div>
              <img
                src="/ci-coat-of-arms.png"
                alt="Armoiries Côte d'Ivoire"
                style={{ width: "60px", height: "60px", objectFit: "contain" }}
              />
              <div style={{ marginTop: "4px" }}>ÉCOLE : {data.school_name}</div>
            </div>
          </div>

          {/* Trait de séparation */}
          <hr style={{ borderColor: "#000080", borderWidth: "1px", margin: "8px 0 12px 0" }} />

          {/* === Titre encadré arrondi === */}
          <div className="flex justify-center mb-4">
            <div
              className="text-center px-12 py-2"
              style={{
                border: "2px solid #000080",
                borderRadius: "8px",
                color: "#000080",
              }}
            >
              <div style={{ fontSize: "16px", fontWeight: "bold", letterSpacing: "1px" }}>
                SYNTHÈSE DES RESULTATS
              </div>
              <div style={{ fontSize: "12px", fontWeight: "bold", marginTop: "2px" }}>
                {data.eval_label.toUpperCase()} N°{data.eval_number} DU MOIS DE {monthLabel(data.month).toUpperCase()} {data.year}
              </div>
            </div>
          </div>

          {/* === Tableau principal === */}
          <table
            className="w-full border-collapse"
            style={{ borderColor: "#000080", borderWidth: "1px", borderStyle: "solid", color: "#000080" }}
          >
            {/* En-tête niveaux */}
            <thead>
              <tr>
                <th
                  className="border"
                  style={{
                    borderColor: "#000080",
                    background: "#000080",
                    color: "white",
                    padding: "6px",
                    fontSize: "11px",
                    width: "8%",
                  }}
                >
                  &nbsp;
                </th>
                {CLASS_NAMES.map((cn) => (
                  <th
                    key={cn}
                    colSpan={3}
                    className="border text-center"
                    style={{
                      borderColor: "#000080",
                      background: "#000080",
                      color: "white",
                      padding: "6px",
                      fontSize: "11px",
                    }}
                  >
                    {cn}
                  </th>
                ))}
              </tr>
              {/* Sous-en-têtes G/F/T */}
              <tr>
                <th className="border" style={{ borderColor: "#000080", background: "#000080", color: "white", padding: "4px", fontSize: "10px" }}>
                  &nbsp;
                </th>
                {CLASS_NAMES.map((cn) => (
                  <>
                    <th key={`${cn}-G`} className="border" style={{ borderColor: "#000080", background: "#000080", color: "white", padding: "4px", fontSize: "10px", width: "6%" }}>G</th>
                    <th key={`${cn}-F`} className="border" style={{ borderColor: "#000080", background: "#000080", color: "white", padding: "4px", fontSize: "10px", width: "6%" }}>F</th>
                    <th key={`${cn}-T`} className="border" style={{ borderColor: "#000080", background: "#000080", color: "white", padding: "4px", fontSize: "10px", width: "6%" }}>T</th>
                  </>
                ))}
              </tr>
            </thead>
            <tbody style={{ fontSize: "11px", fontWeight: "bold" }}>
              {/* Ligne INSCRITS */}
              <tr>
                <td className="border px-2" style={{ borderColor: "#000080" }}>INSCRITS</td>
                {data.levels.map((lvl) => (
                  <>
                    <td key={`${lvl.class_name}-ins-G`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmt(lvl.inscrits[0])}</td>
                    <td key={`${lvl.class_name}-ins-F`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmt(lvl.inscrits[1])}</td>
                    <td key={`${lvl.class_name}-ins-T`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmt(lvl.inscrits[2])}</td>
                  </>
                ))}
              </tr>
              {/* Ligne PRÉSENTS */}
              <tr style={{ background: "#f5f5f8" }}>
                <td className="border px-2" style={{ borderColor: "#000080" }}>PRÉSENTS</td>
                {data.levels.map((lvl) => (
                  <>
                    <td key={`${lvl.class_name}-pre-G`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmt(lvl.presents[0])}</td>
                    <td key={`${lvl.class_name}-pre-F`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmt(lvl.presents[1])}</td>
                    <td key={`${lvl.class_name}-pre-T`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmt(lvl.presents[2])}</td>
                  </>
                ))}
              </tr>
              {/* Ligne ADMIS */}
              <tr>
                <td className="border px-2" style={{ borderColor: "#000080" }}>ADMIS</td>
                {data.levels.map((lvl) => (
                  <>
                    <td key={`${lvl.class_name}-adm-G`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmt(lvl.admis[0])}</td>
                    <td key={`${lvl.class_name}-adm-F`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmt(lvl.admis[1])}</td>
                    <td key={`${lvl.class_name}-adm-T`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmt(lvl.admis[2])}</td>
                  </>
                ))}
              </tr>
              {/* Ligne % ADMIS */}
              <tr style={{ background: "#f5f5f8" }}>
                <td className="border px-2" style={{ borderColor: "#000080" }}>% ADMIS</td>
                {data.levels.map((lvl) => (
                  <>
                    <td key={`${lvl.class_name}-pct-G`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmtPct(lvl.pct_admis[0])}</td>
                    <td key={`${lvl.class_name}-pct-F`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmtPct(lvl.pct_admis[1])}</td>
                    <td key={`${lvl.class_name}-pct-T`} className="border text-center" style={{ borderColor: "#000080", padding: "6px" }}>{fmtPct(lvl.pct_admis[2])}</td>
                  </>
                ))}
              </tr>
              {/* Récapitulatif FILLES + GARÇONS */}
              <tr style={{ borderColor: "#000080" }}>
                <td
                  colSpan={8}
                  className="border text-center"
                  style={{ borderColor: "#000080", padding: "8px", fontSize: "13px", fontWeight: "bold" }}
                >
                  FILLES : {fmtPct(data.totals.pct_f)} %
                </td>
                <td
                  colSpan={8}
                  className="border text-center"
                  style={{ borderColor: "#000080", padding: "8px", fontSize: "13px", fontWeight: "bold" }}
                >
                  GARÇONS : {fmtPct(data.totals.pct_g)} %
                </td>
              </tr>
              {/* Total global */}
              <tr>
                <td
                  colSpan={16}
                  className="border text-center"
                  style={{ borderColor: "#000080", padding: "10px", fontSize: "16px", fontWeight: "bold" }}
                >
                  {fmtPct(data.totals.pct_t)} %
                </td>
              </tr>
            </tbody>
          </table>

          {/* === Pied de page : Signatures === */}
          <div className="flex justify-between items-end mt-10" style={{ color: "#000080" }}>
            {/* Gauche : Le Directeur */}
            <div className="text-center" style={{ width: "40%" }}>
              <div style={{ fontSize: "12px", fontWeight: "bold", textDecoration: "underline" }}>Le Directeur</div>
              <div style={{ height: "60px" }} />
              <div style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>
                {data.school_name}
              </div>
            </div>
            {/* Droite : Date + L'Inspecteur */}
            <div className="text-right" style={{ width: "40%" }}>
              <div style={{ fontSize: "11px", marginBottom: "20px" }}>
                Fait à {data.iep_region}, le ...../...../.....
              </div>
              <div style={{ fontSize: "12px", fontWeight: "bold", textDecoration: "underline" }}>
                L'Inspecteur
              </div>
              <div style={{ height: "40px" }} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
