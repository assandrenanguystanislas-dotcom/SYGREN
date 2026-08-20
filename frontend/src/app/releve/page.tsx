"use client";

import { useState, useEffect } from "react";
import { Printer, X, Loader2 } from "lucide-react";

// === Types ===
interface ReleveSubjectGrade {
  subject_name: string;
  value: number;
  max_score: number;
  has_grade: boolean;
}

interface ReleveStudent {
  num: number;
  matricule: string;
  last_name: string;
  first_name: string;
  gender: string;
  grades: ReleveSubjectGrade[];
  total: number;
  average: number;
  average_scale: number;
  has_average: boolean;
  observation: string;
}

interface ReleveStats {
  inscrits_g: number;
  inscrits_f: number;
  inscrits_t: number;
  presents_g: number;
  presents_f: number;
  presents_t: number;
  admis_g: number;
  admis_f: number;
  admis_t: number;
  pct_g: number;
  pct_f: number;
  pct_t: number;
}

interface ReleveData {
  iep_name: string;
  iep_region: string;
  iep_bp: string;
  inspector_name: string;
  inspector_email: string;
  inspector_phone: string;
  school_name: string;
  school_code: string;
  school_addr: string;
  class_name: string;
  class_level: string;
  director_name: string;
  eval_label: string;
  eval_number: number;
  eval_type: string;
  month: number;
  year: number;
  date: string;
  title: string;
  type_examen: string;
  total_g: number;
  total_f: number;
  total_t: number;
  students: ReleveStudent[];
  stats: ReleveStats;
}

// === Pagination dynamique ===
const PAGE_1_LIMIT = 40;
const OTHER_PAGE_LIMIT = 45;

function chunkStudents(students: ReleveStudent[]): ReleveStudent[][] {
  if (students.length === 0) return [[]];
  const pages: ReleveStudent[][] = [];
  let remaining = [...students];
  pages.push(remaining.slice(0, PAGE_1_LIMIT));
  remaining = remaining.slice(PAGE_1_LIMIT);
  while (remaining.length > 0) {
    pages.push(remaining.slice(0, OTHER_PAGE_LIMIT));
    remaining = remaining.slice(OTHER_PAGE_LIMIT);
  }
  return pages;
}

function isEPS(name: string): boolean {
  return name.trim().toUpperCase() === "EPS";
}

function fmt(v: number, hasGrade: boolean): string {
  if (!hasGrade) return "—";
  const r = Math.round(v * 100) / 100;
  return r.toFixed(2).replace(/\.?0+$/, "");
}

export default function RelevePage() {
  const [data, setData] = useState<ReleveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const classId = params.get("class_id");
    let token = "";
    const urlToken = params.get("t");
    if (urlToken) {
      token = urlToken;
    } else {
      try {
        const raw = localStorage.getItem("sygren-auth");
        if (raw) token = JSON.parse(raw)?.state?.token ?? "";
      } catch {}
    }

    if (!sessionId || !classId) {
      Promise.resolve().then(() => {
        setLoading(false);
        setError("session_id et class_id sont requis dans l'URL");
      });
      return;
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
    const separator = apiBase ? "" : "?XTransformPort=8080";
    const url = `${apiBase}/api/reports/releve-data?session_id=${encodeURIComponent(sessionId)}&class_id=${encodeURIComponent(classId)}${apiBase ? "" : separator}`;

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          let msg = `HTTP ${res.status}`;
          try {
            const j = JSON.parse(text);
            if (j?.error) msg = j.error;
          } catch {}
          throw new Error(msg);
        }
        return res.json();
      })
      .then((d: ReleveData) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: Error) => {
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

  const pages = chunkStudents(data.students);
  const subjects: { name: string; max_score: number }[] =
    data.students[0]?.grades?.map((g) => ({
      name: g.subject_name,
      max_score: g.max_score,
    })) ?? [];
  const stats = data.stats;

  return (
    <div className="bg-gray-100 min-h-screen py-8 print:bg-white print:p-0 print:py-0">
      {/* Barre d'outils — cachée à l'impression */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Relevé de Notes — {data.class_name} · Aperçu
        </h3>
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

      {/* === DOCUMENT MULTI-PAGES === */}
      <div id="releve-doc">
        {pages.map((pageData, pageIndex) => {
          const isFirstPage = pageIndex === 0;
          const isLastPage = pageIndex === pages.length - 1;

          return (
            <div
              key={pageIndex}
              className="w-[210mm] min-h-[297mm] p-6 bg-white mx-auto mb-8 shadow-md print:shadow-none print:m-0 print:p-4 print:w-full font-sans text-xs text-black flex flex-col justify-between break-after-page"
              style={{ pageBreakAfter: 'always' }}
            >
              <div>
                {/* === 1. EN-TÊTE SUPÉRIEUR (Page 1 uniquement) === */}
                {isFirstPage ? (
                  <div>
                    <div className="grid grid-cols-3 items-start mb-3">
                      {/* Bloc Gauche : Ministère */}
                      <div className="text-left space-y-0.5 text-[10px] leading-tight">
                        <p className="font-semibold">Ministère de l&apos;Education Nationale</p>
                        <p className="font-semibold">Et de l&apos;Alphabétisation</p>
                        <p className="italic">Direction Régionale de {data.iep_region}</p>
                        <p className="font-bold">Inspection de l&apos;Enseignement</p>
                        <p className="font-bold">Préscolaire et Primaire de {data.iep_name}</p>
                        <p>BP : {data.iep_bp || "........."} / Tel : {data.inspector_phone || "............."}</p>
                        <p className="text-blue-700 underline">{data.inspector_email || "............"}</p>
                      </div>

                      {/* Bloc Centre : Titres */}
                      <div className="flex flex-col items-center justify-center pt-1">
                        <div className="border-2 border-black rounded-2xl px-6 py-1.5 font-bold text-sm tracking-wide bg-white">
                          {data.title}
                        </div>
                        <div className="border border-red-500 text-red-600 font-bold text-base px-6 py-1 mt-3 uppercase tracking-wider">
                          {data.type_examen}
                        </div>
                      </div>

                      {/* Bloc Droit : Armoiries (Centré en interne) */}
                      <div className="flex flex-col items-center text-center space-y-0.5">
                        <p className="font-semibold text-xs">République de Côte d&apos;Ivoire</p>
                        <p className="text-[9px] tracking-wide italic">Union-Discipline-Travail</p>

                        <div className="my-1 flex justify-center">
                          <img
                            src="/ci-coat-of-arms.png"
                            alt="Armoiries Côte d'Ivoire"
                            className="h-12 object-contain"
                          />
                        </div>

                        <div className="font-bold text-xs pt-1">
                          G {data.total_g} &nbsp; F {data.total_f} &nbsp; T {data.total_t}
                        </div>
                        <div className="text-[10px]">
                          Date: {data.date}
                        </div>
                      </div>
                    </div>

                    {/* 2. LIGNE ÉCOLE & CODE ÉCOLE */}
                    <div className="flex justify-between items-center font-bold text-xs my-2 pt-1 border-t border-gray-200">
                      <span>ECOLE : {data.school_name}</span>
                      <span>CODE : {data.school_code}</span>
                    </div>
                  </div>
                ) : (
                  /* Rappel de titre discret sur les pages suivantes */
                  <div className="flex justify-between items-center border-b border-black pb-1 mb-3 text-[10px] font-bold">
                    <span>{data.school_name} — {data.title}</span>
                    <span>Page {pageIndex + 1} / {pages.length}</span>
                  </div>
                )}

                {/* === 3. TABLEAU DES NOTES (Colonnes optimisées) === */}
                <table className="w-full border-collapse border border-black text-center text-[10px]">
                  <thead>
                    <tr className="font-bold border-b border-black bg-gray-100">
                      <th className="border border-black py-1 w-6">N°</th>
                      <th className="border border-black py-1 w-20">Matricule</th>
                      <th className="border border-black py-1 w-28">Nom</th>
                      <th className="border border-black py-1">Prénoms</th>
                      {subjects.map((s, idx) => (
                        <th
                          key={idx}
                          className={`border border-black py-1 text-[9px] ${isEPS(s.name) ? "bg-yellow-300" : ""}`}
                          style={{ width: isEPS(s.name) ? "w-10" : s.name.length > 15 ? "w-14" : "w-12" }}
                        >
                          {s.name}
                        </th>
                      ))}
                      <th className="border border-black py-1 w-11">Total</th>
                      <th className="border border-black py-1 w-11">Moy</th>
                      <th className="border border-black py-1 w-8">Obs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageData.map((e, i) => {
                      const num = (isFirstPage ? 0 : PAGE_1_LIMIT + (pageIndex - 1) * OTHER_PAGE_LIMIT) + i + 1;
                      const isFille = e.gender === "F";
                      return (
                        <tr key={num} className="h-5">
                          <td className="border border-black">{num}</td>
                          <td className="border border-black font-semibold">{e.matricule}</td>
                          <td className={`border border-black text-left px-1 font-bold ${isFille ? 'text-red-600' : ''}`}>
                            {e.last_name}
                          </td>
                          <td className={`border border-black text-left px-1 font-semibold truncate max-w-[150px] ${isFille ? 'text-red-600' : ''}`}>
                            {e.first_name}
                          </td>
                          {subjects.map((subj, idx) => {
                            const g = e.grades[idx];
                            const val = g ? fmt(g.value, g.has_grade) : "—";
                            return (
                              <td
                                key={idx}
                                className={`border border-black ${isEPS(subj.name) ? "bg-yellow-200 font-bold" : ""}`}
                              >
                                {val}
                              </td>
                            );
                          })}
                          <td className="border border-black font-bold">
                            {e.has_average ? fmt(e.total, true) : "—"}
                          </td>
                          <td className="border border-black font-bold">
                            {e.has_average ? fmt(e.average, true) : "—"}
                          </td>
                          <td className="border border-black font-bold">{e.observation}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* === 4. BLOC FINAL (Statistiques + Signatures) ===
                  Placé DIRECTEMENT sous le tableau (mt-3, pas de justify-between).
                  Uniquement sur la dernière page. */}
              {isLastPage && (
                <div className="mt-3 break-inside-avoid">
                  <div className="grid grid-cols-3 gap-3 text-center font-bold text-xs">

                    {/* Boîte Statistiques */}
                    <div className="border border-black p-1.5 text-left space-y-1 text-[10px]">
                      <div className="flex justify-between">
                        <span>Inscrits G: {stats.inscrits_g}</span>
                        <span>F: {stats.inscrits_f}</span>
                        <span>T: {stats.inscrits_t}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Présents: G {stats.presents_g}</span>
                        <span>F {stats.presents_f}</span>
                        <span>T {stats.presents_t}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Admis: G {stats.admis_g}</span>
                        <span>F {stats.admis_f}</span>
                        <span>T {stats.admis_t}</span>
                      </div>
                      <div className="pt-1 border-t border-gray-400 text-[9px]">
                        % des Admis G {stats.pct_g.toFixed(2)}% | F {stats.pct_f.toFixed(2)}% | T {stats.pct_t.toFixed(2)}%
                      </div>
                    </div>

                    {/* Boîte Directeur */}
                    <div className="border border-black p-2 flex flex-col justify-between h-28">
                      <span className="underline uppercase text-xs">LE DIRECTEUR</span>
                      <span className="uppercase text-[10px] tracking-wider">
                        {data.director_name || "................................"}
                      </span>
                    </div>

                    {/* Boîte Inspecteur */}
                    <div className="border border-black p-2 flex flex-col justify-between h-28">
                      <span className="underline uppercase text-xs">L&apos;INSPECTEUR</span>
                      <span className="uppercase text-[10px] tracking-wider">
                        {data.inspector_name || "................................"}
                      </span>
                    </div>

                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
