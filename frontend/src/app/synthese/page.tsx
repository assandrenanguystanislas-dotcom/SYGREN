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

export default function SynthesePage() {
  const [data, setData] = useState<SyntheseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");

    let token = "";
    // D'abord essayer le token dans l'URL (t=...)
    const urlToken = params.get("t");
    if (urlToken) {
      token = urlToken;
    } else {
      // Sinon, essayer localStorage
      try {
        const raw = localStorage.getItem("sygren-auth");
        if (raw) {
          token = JSON.parse(raw)?.state?.token ?? "";
        }
      } catch {}
    }

    if (!sessionId) {
      Promise.resolve().then(() => {
        setLoading(false);
        setError("Session ID manquant");
      });
      return;
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
    // Nouveau : school_code + eval_type + eval_number + year (au lieu de session_id)
    const schoolCode = params.get("school_code") || "";
    const evalType = params.get("eval_type") || "composition";
    const evalNumber = params.get("eval_number") || "1";
    const year = params.get("year") || "2026";

    let url: string;
    if (schoolCode) {
      url = `${apiBase}/api/reports/synthese-data?school_code=${encodeURIComponent(schoolCode)}&eval_type=${evalType}&eval_number=${evalNumber}&year=${year}`;
    } else {
      // Rétrocompatibilité : session_id
      const sessionId = params.get("session_id") || "";
      url = `${apiBase}/api/reports/synthese-data?session_id=${sessionId}`;
    }

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        <Loader2 className="w-8 h-8 animate-spin text-gray-800" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 font-semibold">{error || "Erreur"}</p>
          <button onClick={() => window.close()} className="mt-4 px-4 py-2 bg-gray-200 rounded">
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

  const levelsData = CLASS_NAMES.map(getLevel);

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">Document de Synthèse — Aperçu</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800"
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

      {/* === DOCUMENT (modèle exact avec données dynamiques) === */}
      <div
        id="synthese-doc"
        className="w-[297mm] h-[210mm] p-8 bg-white text-black font-sans text-xs border border-gray-300 mx-auto print:p-0 print:border-none flex flex-col justify-between"
      >
        {/* Partie supérieure */}
        <div>
          {/* En-tête supérieur */}
          <div className="flex justify-between items-start mb-2">
            {/* Bloc Gauche */}
            <div className="text-left space-y-0.5">
              <p className="font-semibold">Ministère de l&apos;Education Nationale</p>
              <p className="font-semibold">Et de l&apos;Alphabétisation</p>
              <p className="italic">Direction Régionale de {data.iep_region}</p>
              <p className="font-bold">Inspection de l&apos;Enseignement</p>
              <p className="font-bold">Préscolaire et Primaire de {data.iep_name}</p>
              <p>BP : {data.school_addr || "—"} / Tel : .............</p>
              <p>Courriel : <span className="underline text-blue-800">............</span></p>
            </div>

            {/* Bloc Droit : Centré en interne */}
            <div className="flex flex-col items-center text-center space-y-1 min-w-[250px]">
              <p className="font-semibold text-sm">République de Côte d&apos;Ivoire</p>
              <p className="text-[10px] tracking-wide uppercase italic">Union - Discipline - Travail</p>

              {/* Armoiries au centre */}
              <div className="my-1 flex justify-center">
                <img
                  src="/ci-coat-of-arms.png"
                  alt="Armoiries Côte d'Ivoire"
                  className="h-16 object-contain"
                />
              </div>

              <p className="font-bold text-sm">ECOLE : {data.school_name}</p>
            </div>
          </div>

          {/* Titre central encadré avec lignes d'union */}
          <div className="flex items-center my-4">
            <div className="flex-1 border-t border-black"></div>
            <div className="border-2 border-black rounded-xl px-8 py-1.5 mx-4">
              <h1 className="text-base font-bold tracking-wider uppercase">SYNTHÈSE DES RÉSULTATS</h1>
            </div>
            <div className="flex-1 border-t border-black"></div>
          </div>

          {/* Sous-titre */}
          <div className="text-center font-bold text-sm mb-3">
            {data.eval_label.toUpperCase()} N°{data.eval_number} {data.month > 0 ? `DU MOIS DE ${monthLabel(data.month).toUpperCase()} ` : ""}{data.year}
          </div>

          {/* Tableau des résultats */}
          <table className="w-full border-collapse border border-black text-center font-bold">
            <thead>
              {/* Ligne 1 : Niveaux */}
              <tr>
                <th className="border border-black p-1 w-1/6"></th>
                {CLASS_NAMES.map((cn) => (
                  <th key={cn} colSpan={3} className="border border-black p-1">{cn}</th>
                ))}
              </tr>
              {/* Ligne 2 : Genre (G, F, T) */}
              <tr className="bg-gray-50">
                <th className="border border-black p-1"></th>
                {CLASS_NAMES.map((cn) => (
                  <>
                    <th key={`${cn}-g`} className="border border-black p-1">G</th>
                    <th key={`${cn}-f`} className="border border-black p-1">F</th>
                    <th key={`${cn}-t`} className="border border-black p-1">T</th>
                  </>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* INSCRITS */}
              <tr>
                <td className="border border-black p-2 text-left uppercase">Inscrits</td>
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-ins-g`} className="border border-black p-1">{fmt(lvl.inscrits[0])}</td>
                ))}
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-ins-f`} className="border border-black p-1">{fmt(lvl.inscrits[1])}</td>
                ))}
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-ins-t`} className="border border-black p-1">{fmt(lvl.inscrits[2])}</td>
                ))}
              </tr>
              {/* PRÉSENTS */}
              <tr>
                <td className="border border-black p-2 text-left uppercase">Présents</td>
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-pre-g`} className="border border-black p-1">{fmt(lvl.presents[0])}</td>
                ))}
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-pre-f`} className="border border-black p-1">{fmt(lvl.presents[1])}</td>
                ))}
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-pre-t`} className="border border-black p-1">{fmt(lvl.presents[2])}</td>
                ))}
              </tr>
              {/* ADMIS */}
              <tr>
                <td className="border border-black p-2 text-left uppercase">Admis</td>
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-adm-g`} className="border border-black p-1">{fmt(lvl.admis[0])}</td>
                ))}
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-adm-f`} className="border border-black p-1">{fmt(lvl.admis[1])}</td>
                ))}
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-adm-t`} className="border border-black p-1">{fmt(lvl.admis[2])}</td>
                ))}
              </tr>
              {/* % ADMIS */}
              <tr>
                <td className="border border-black p-2 text-left uppercase">% Admis</td>
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-pct-g`} className="border border-black p-1">{fmtPct(lvl.pct_admis[0])}</td>
                ))}
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-pct-f`} className="border border-black p-1">{fmtPct(lvl.pct_admis[1])}</td>
                ))}
                {levelsData.map((lvl) => (
                  <td key={`${lvl.class_name}-pct-t`} className="border border-black p-1">{fmtPct(lvl.pct_admis[2])}</td>
                ))}
              </tr>
              {/* Ligne % Total d'Admis par Genre */}
              <tr>
                <td className="border border-black p-2 text-left font-normal">% total d&apos;ADMIS</td>
                <td colSpan={15} className="border border-black p-2">
                  <div className="flex justify-around items-center font-bold">
                    <span>FILLES : {fmtPct(data.totals.pct_f)} %</span>
                    <span>GARÇONS : {fmtPct(data.totals.pct_g)} %</span>
                  </div>
                </td>
              </tr>
              {/* Ligne % Total Global */}
              <tr>
                <td className="border border-black p-2 text-left font-normal">% total d&apos;ADMIS</td>
                <td colSpan={15} className="border border-black p-2 text-center text-base font-bold">
                  {fmtPct(data.totals.pct_t)} %
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Date/lieu juste sous le tableau + signatures sur la même ligne */}
        <div className="mt-4">
          {/* Date/lieu alignée à droite */}
          <p className="text-right font-bold mb-6">
            Fait à {data.iep_region}, le ......................... {data.year}
          </p>

          {/* Signatures sur la même ligne */}
          <div className="flex justify-between items-start font-bold">
            {/* Côté Directeur */}
            <div className="text-left w-1/2">
              <p className="underline mb-1">Le Directeur</p>
              <div className="h-16"></div>
              <p className="text-xs uppercase">{data.school_name}</p>
            </div>

            {/* Côté Inspecteur */}
            <div className="text-right w-1/2">
              <p className="underline mb-1">L&apos;Inspecteur</p>
              <div className="h-16"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
