"use client";

import { useState, useEffect } from "react";
import { Printer, X, Loader2 } from "lucide-react";

// === Types — correspondent à la réponse du backend (ReleveData) ===

interface ReleveSubjectGrade {
  subject_name: string;
  value: number; // note brute (ex: 18.5/20, 44/50)
  max_score: number;
  has_grade: boolean;
}

interface ReleveStudent {
  num: number;
  matricule: string;
  last_name: string;
  first_name: string;
  gender: string; // "M" | "F"
  grades: ReleveSubjectGrade[];
  total: number;
  average: number;
  average_scale: number;
  has_average: boolean;
  observation: string; // "A" (Admis) | "R" (Refusé)
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
//
// Le relevé est un document A4 PORTRAIT multi-pages :
//   - Page 1 : en-tête institutionnel complet (~80mm) + tableau (40 élèves max)
//   - Pages 2..N-1 : en-tête réduit (~15mm) + tableau (45 élèves max)
//   - Page N (dernière) : tableau + bloc statistiques + signatures
//
// Les seuils 40/45 sont calibrés pour tenir sur A4 portrait avec des lignes
// de ~5mm de hauteur et des marges de ~10mm. Si une page déborde malgré tout,
// le navigateur ajoutera une page supplémentaire (CSS break-inside: avoid sur
// les lignes du tableau pour ne pas les couper en deux).
const PAGE_1_SIZE = 40;
const PAGE_N_SIZE = 45;

function chunkStudents(students: ReleveStudent[]): ReleveStudent[][] {
  // Toujours au moins 1 page (pour rendre l'en-tête + le footer même si 0 élève).
  if (students.length === 0) return [[]];
  const pages: ReleveStudent[][] = [];
  let i = 0;
  while (i < students.length) {
    const size = pages.length === 0 ? PAGE_1_SIZE : PAGE_N_SIZE;
    pages.push(students.slice(i, i + size));
    i += size;
  }
  return pages;
}

// isEPS : détection de la colonne EPS (barème spécial /50, fond jaune dans le
// tableau). Comparaison insensible à la casse et aux espaces.
function isEPS(name: string): boolean {
  return name.trim().toUpperCase() === "EPS";
}

// fmt : formate une note brute — "" si pas de note, sinon la valeur sans zéros inutiles.
function fmt(v: number, hasGrade: boolean): string {
  if (!hasGrade) return "—";
  // Arrondi à 2 décimales, suppression des zéros en queue (ex: 18.50 → 18.5, 18.00 → 18)
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

    // Token JWT : d'abord dans l'URL (t=...), sinon dans localStorage (zustand-persist).
    let token = "";
    const urlToken = params.get("t");
    if (urlToken) {
      token = urlToken;
    } else {
      try {
        const raw = localStorage.getItem("sygren-auth");
        if (raw) {
          token = JSON.parse(raw)?.state?.token ?? "";
        }
      } catch {}
    }

    if (!sessionId || !classId) {
      // Déférer les setState via une microtask pour éviter le warning
      // react-hooks/set-state-in-effect (cascading renders dans le corps de l'effet).
      Promise.resolve().then(() => {
        setLoading(false);
        setError("session_id et class_id sont requis dans l'URL");
      });
      return;
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL || "";
    // Mode dev (sandbox) : chemin relatif + ?XTransformPort=8080 pour le gateway Caddy.
    // Mode prod : URL absolue vers le backend déployé.
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

  // Pagination dynamique : chunker les élèves en pages (40 sur la 1ère, 45 sur les suivantes).
  const pages = chunkStudents(data.students);
  // Liste des matières — extraite du 1er élève (tous les élèves d'une même classe
  // ont la même liste de matières côté backend).
  const subjects: { name: string; max_score: number }[] =
    data.students[0]?.grades?.map((g) => ({
      name: g.subject_name,
      max_score: g.max_score,
    })) ?? [];
  // Niveau CM → moyenne sur /20 ; CP/CE → /10.
  const avgScale = data.students[0]?.average_scale ?? (data.class_level === "CM" ? 20 : 10);
  // Y a-t-il une colonne EPS ? (fond jaune — pour CM2 / exam_blanc)
  const hasEPS = subjects.some((s) => isEPS(s.name));

  // Formatage
  const fmtPct = (v: number) => (v > 0 ? v.toFixed(2) + " %" : "—");

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
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

      {/* === DOCUMENT — A4 portrait multi-pages === */}
      <div id="releve-doc" className="mx-auto bg-white text-black font-sans text-[10px]">
        {pages.map((pageStudents, pageIndex) => {
          const isLast = pageIndex === pages.length - 1;
          return (
            <div
              key={pageIndex}
              className={`relative w-[210mm] min-h-[297mm] p-[8mm] mx-auto print:p-0 ${
                !isLast ? "break-after-page" : ""
              }`}
            >
              {/* === En-tête : complet sur la page 1, réduit sur les suivantes === */}
              {pageIndex === 0 ? (
                <FullHeader data={data} />
              ) : (
                <SmallHeader
                  data={data}
                  pageNum={pageIndex + 1}
                  totalPages={pages.length}
                />
              )}

              {/* === Tableau des élèves === */}
              <StudentsTable
                pageStudents={pageStudents}
                subjects={subjects}
                avgScale={avgScale}
                startIndex={pageIndex === 0
                  ? 0
                  : PAGE_1_SIZE + (pageIndex - 1) * PAGE_N_SIZE}
                hasEPS={hasEPS}
              />

              {/* === Pied de page : stats + signatures uniquement sur la dernière page === */}
              {isLast && <FooterBlock data={data} fmtPct={fmtPct} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === En-tête institutionnel complet (page 1 uniquement) ===
// Layout 3 colonnes :
//   - Gauche  : infos Ministère + IEP (BP/Tel/Courriel)
//   - Centre  : titre "RELEVE DE NOTES [classe]" + type d'examen
//   - Droite  : République + écusson + totaux G/F/T + date
function FullHeader({ data }: { data: ReleveData }) {
  return (
    <div className="flex justify-between items-start mb-3 gap-2">
      {/* Colonne gauche — infos Ministère + IEP */}
      <div className="text-left space-y-0.5 w-1/3">
        <p className="font-semibold">Ministère de l&apos;Education Nationale</p>
        <p className="font-semibold">Et de l&apos;Alphabétisation</p>
        <p className="italic">Direction Régionale de {data.iep_region}</p>
        <p className="font-bold">Inspection de l&apos;Enseignement</p>
        <p className="font-bold">Préscolaire et Primaire de {data.iep_name}</p>
        <p>BP : {data.iep_bp || "........."} / Tel : {data.inspector_phone || "............."}</p>
        <p>Courriel : <span className="underline text-blue-800">{data.inspector_email || "............"}</span></p>
      </div>

      {/* Colonne centre — titre + type d'examen */}
      <div className="text-center w-1/3 flex flex-col items-center justify-center pt-4">
        <h1 className="text-base font-bold tracking-wider uppercase border-2 border-black rounded-lg px-4 py-1.5">
          {data.title}
        </h1>
        <p className="font-bold text-xs mt-2">{data.type_examen}</p>
        <p className="text-[9px] mt-1 text-gray-700 italic">
          Année scolaire {data.year}
        </p>
      </div>

      {/* Colonne droite — République + écusson + totaux G/F/T + date */}
      <div className="flex flex-col items-center text-center space-y-1 w-1/3">
        <p className="font-semibold text-xs">République de Côte d&apos;Ivoire</p>
        <p className="text-[8px] tracking-wide uppercase italic">
          Union - Discipline - Travail
        </p>
        <img
          src="/ci-coat-of-arms.png"
          alt="Armoiries Côte d'Ivoire"
          className="h-12 object-contain"
        />
        <div className="font-bold text-[10px] w-full">
          <table className="w-full border-collapse border border-black text-center">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black px-1 py-0.5">G</th>
                <th className="border border-black px-1 py-0.5">F</th>
                <th className="border border-black px-1 py-0.5">T</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-black px-1 py-0.5">{data.total_g}</td>
                <td className="border border-black px-1 py-0.5">{data.total_f}</td>
                <td className="border border-black px-1 py-0.5">{data.total_t}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="font-bold text-[10px]">Date : {data.date}</p>
      </div>
    </div>
  );
}

// === En-tête réduit (pages 2..N) ===
function SmallHeader({
  data,
  pageNum,
  totalPages,
}: {
  data: ReleveData;
  pageNum: number;
  totalPages: number;
}) {
  return (
    <div className="flex justify-between items-center mb-2 border-b border-black pb-1">
      <p className="font-bold text-[11px]">
        {data.school_name} — {data.class_name}
      </p>
      <p className="text-[10px]">
        {data.title} — {data.type_examen}
      </p>
      <p className="font-semibold text-[10px]">
        Page {pageNum} / {totalPages}
      </p>
    </div>
  );
}

// === Tableau des élèves ===
function StudentsTable({
  pageStudents,
  subjects,
  avgScale,
  startIndex,
  hasEPS,
}: {
  pageStudents: ReleveStudent[];
  subjects: { name: string; max_score: number }[];
  avgScale: number;
  startIndex: number;
  hasEPS: boolean;
}) {
  // Largeur des colonnes — calculée pour tenir sur A4 portrait (≈ 194mm de contenu utile).
  //   - N° : 8mm
  //   - Matricule : 22mm
  //   - Nom : 25mm
  //   - Prénoms : 25mm
  //   - Notes : variable (chaque matière ~12-18mm selon le nom)
  //   - Total : 12mm
  //   - Moy : 12mm
  //   - Obs : 8mm
  // Si trop de matières, le tableau peut déborder — on garde overflow-x:auto en
  // mode aperçu (mais en print, on accepte la compression).
  return (
    <table className="w-full border-collapse border border-black text-center">
      <thead>
        {/* Ligne 1 : en-têtes principaux */}
        <tr className="bg-gray-100">
          <th className="border border-black px-1 py-0.5 w-[6mm] font-bold">N°</th>
          <th className="border border-black px-1 py-0.5 font-bold">Matricule</th>
          <th className="border border-black px-1 py-0.5 font-bold">Nom</th>
          <th className="border border-black px-1 py-0.5 font-bold">Prénoms</th>
          {subjects.map((s, idx) => (
            <th
              key={idx}
              className={`border border-black px-1 py-0.5 font-bold ${
                isEPS(s.name) ? "bg-yellow-200" : ""
              }`}
              title={`${s.name} (sur ${s.max_score})`}
            >
              <div className="leading-tight">
                <div className="font-bold">{s.name}</div>
                <div className="font-normal text-[8px]">/{s.max_score}</div>
              </div>
            </th>
          ))}
          <th className="border border-black px-1 py-0.5 font-bold">Total</th>
          <th className="border border-black px-1 py-0.5 font-bold">
            Moy <span className="font-normal text-[8px]">/{avgScale}</span>
          </th>
          <th className="border border-black px-1 py-0.5 font-bold">Obs</th>
        </tr>
      </thead>
      <tbody>
        {pageStudents.map((s, i) => {
          const num = startIndex + i + 1;
          // Fille (gender === "F") → rouge, Garçon → noir (cahier des charges).
          const nameColor = s.gender === "F" ? "text-red-600" : "text-black";
          // Observation : A=Admis (vert gras), R=Refusé (rouge).
          const obsColor =
            s.observation === "A"
              ? "text-emerald-700 font-bold"
              : "text-red-600 font-bold";
          return (
            <tr key={num} className="break-inside-avoid hover:bg-gray-50">
              <td className="border border-black px-1 py-0.5 text-center">{num}</td>
              <td className="border border-black px-1 py-0.5 text-center font-mono text-[9px]">
                {s.matricule}
              </td>
              <td className={`border border-black px-1 py-0.5 text-left ${nameColor} font-semibold`}>
                {s.last_name}
              </td>
              <td className={`border border-black px-1 py-0.5 text-left ${nameColor}`}>
                {s.first_name}
              </td>
              {subjects.map((subj, idx) => {
                const g = s.grades[idx];
                const val = g ? fmt(g.value, g.has_grade) : "—";
                return (
                  <td
                    key={idx}
                    className={`border border-black px-1 py-0.5 text-center ${
                      isEPS(subj.name) ? "bg-yellow-100" : ""
                    }`}
                  >
                    {val}
                  </td>
                );
              })}
              <td className="border border-black px-1 py-0.5 text-center font-semibold">
                {s.has_average ? s.total.toFixed(2).replace(/\.?0+$/, "") : "—"}
              </td>
              <td className="border border-black px-1 py-0.5 text-center font-bold">
                {s.has_average ? s.average.toFixed(2).replace(/\.?0+$/, "") : "—"}
              </td>
              <td className={`border border-black px-1 py-0.5 text-center ${obsColor}`}>
                {s.observation}
              </td>
            </tr>
          );
        })}
        {/* Page vide — on rend quand même une ligne vide pour la lisibilité */}
        {pageStudents.length === 0 && (
          <tr>
            <td
              colSpan={4 + subjects.length + 3}
              className="border border-black px-2 py-4 text-center text-gray-500 italic"
            >
              Aucun élève dans cette classe.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// === Pied de page (dernière page uniquement) ===
// Layout 3 colonnes :
//   - Gauche  : statistiques Inscrits/Présents/Admis G/F/T + %
//   - Centre  : signature Directeur
//   - Droite  : signature Inspecteur
function FooterBlock({
  data,
  fmtPct,
}: {
  data: ReleveData;
  fmtPct: (v: number) => string;
}) {
  const stats = data.stats;
  return (
    <div className="mt-6">
      {/* Date/lieu alignée à droite */}
      <p className="text-right font-bold text-[10px] mb-4">
        Fait à {data.iep_region}, le {data.date}
      </p>

      <div className="flex justify-between items-start gap-4">
        {/* Colonne gauche — statistiques */}
        <div className="w-1/2">
          <table className="w-full border-collapse border border-black text-center text-[9px]">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black px-1 py-0.5 text-left">&nbsp;</th>
                <th className="border border-black px-1 py-0.5">G</th>
                <th className="border border-black px-1 py-0.5">F</th>
                <th className="border border-black px-1 py-0.5">T</th>
                <th className="border border-black px-1 py-0.5">%</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-bold">
                <td className="border border-black px-1 py-0.5 text-left uppercase">Inscrits</td>
                <td className="border border-black px-1 py-0.5">{stats.inscrits_g}</td>
                <td className="border border-black px-1 py-0.5">{stats.inscrits_f}</td>
                <td className="border border-black px-1 py-0.5">{stats.inscrits_t}</td>
                <td className="border border-black px-1 py-0.5">—</td>
              </tr>
              <tr className="font-bold">
                <td className="border border-black px-1 py-0.5 text-left uppercase">Présents</td>
                <td className="border border-black px-1 py-0.5">{stats.presents_g}</td>
                <td className="border border-black px-1 py-0.5">{stats.presents_f}</td>
                <td className="border border-black px-1 py-0.5">{stats.presents_t}</td>
                <td className="border border-black px-1 py-0.5">—</td>
              </tr>
              <tr className="font-bold">
                <td className="border border-black px-1 py-0.5 text-left uppercase">Admis</td>
                <td className="border border-black px-1 py-0.5">{stats.admis_g}</td>
                <td className="border border-black px-1 py-0.5">{stats.admis_f}</td>
                <td className="border border-black px-1 py-0.5">{stats.admis_t}</td>
                <td className="border border-black px-1 py-0.5 bg-yellow-50">{fmtPct(stats.pct_t)}</td>
              </tr>
              <tr>
                <td className="border border-black px-1 py-0.5 text-left uppercase font-normal">% Admis</td>
                <td className="border border-black px-1 py-0.5">{fmtPct(stats.pct_g)}</td>
                <td className="border border-black px-1 py-0.5">{fmtPct(stats.pct_f)}</td>
                <td className="border border-black px-1 py-0.5">{fmtPct(stats.pct_t)}</td>
                <td className="border border-black px-1 py-0.5">—</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Colonne droite — signatures Directeur + Inspecteur */}
        <div className="w-1/2 flex justify-between gap-2">
          {/* Directeur */}
          <div className="text-center w-1/2">
            <p className="underline font-bold text-[10px] mb-1">Le Directeur</p>
            <div className="h-12"></div>
            <p className="text-[9px] uppercase font-bold">
              {data.director_name || "................................"}
            </p>
          </div>
          {/* Inspecteur */}
          <div className="text-center w-1/2">
            <p className="underline font-bold text-[10px] mb-1">L&apos;Inspecteur</p>
            <div className="h-12"></div>
            <p className="text-[9px] uppercase font-bold">
              {data.inspector_name || "................................"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
