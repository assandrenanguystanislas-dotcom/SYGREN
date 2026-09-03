"use client";

import { useState, useEffect } from "react";
import { Printer, X, Loader2, User, Users, CheckCircle2, Award, TrendingUp } from "lucide-react";
import { CIArmoiriesWatermark, CIFlagRibbon } from "@/components/ci-decor";
import { canPrintDocument, PrintLockBadge, PrintLockDocumentMessage, storeUrlTokenIfPresent, usePrintRole } from "@/lib/print-guard";

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

// Abréviation des noms de matières pour libérer de la largeur.
// Les matières CP sont très abrégées car il y en a 9 (Chant, Copie, Dessin,
// Dictée, EDHC, Ecriture, Exp. écrit, Lecture, Maths) — il faut libérer
// un maximum de place pour la colonne Prénoms.
function abbreviateSubject(name: string): string {
  // Normaliser : majuscules SANS accents pour la comparaison
  const n = name.trim();
  const norm = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  switch (norm) {
    case "EXPLOITATION DE TEXTE":
      return "Expl. texte";
    case "ETUDE DU MILIEU":
      return "Et. Milieu";
    case "MATHEMATIQUES":
      return "Maths";
    case "DICTEE":
      return "Dictée";
    case "EPS":
      return "EPS";
    case "COPIE":
      return "Copie";
    case "ECRIT":
      return "Ecrit";
    case "ECRITURE":
      return "Ecrit.";
    case "EXPRESSION ECRITES":
    case "EXPRESSION ECRITE":
      return "Exp. écr.";
    case "DESSIN EDHC":
      return "D. EDHC";
    case "EDHC":
      return "EDHC";
    case "LECTURE":
    case "LECT.":
      return "Lect.";
    case "POES./CHANT":
    case "POESIE":
      return "Poés./ch.";
    case "CHANT":
      return "Chant";
    case "POESIE & CHANT":
    case "CHANT ET DESSIN":
      return "Chant";
    default:
      return n;
  }
}

// === Système d'abréviation dynamique des prénoms ===
//
// Au lieu d'abréger aveuglément à partir du 4ème prénom, on calcule l'espace
// disponible pour la colonne Prénoms en fonction du nombre de matières (plus
// il y a de matières, moins il y a de place), puis on décide dynamiquement
// combien de prénoms abréger.
//
// Étapes :
//   1. Calculer la largeur disponible (mm) selon le nombre de matières
//   2. Estimer la largeur du texte complet des prénoms
//   3. Si tout tient → afficher tel quel
//   4. Sinon → abréger progressivement : 4ème+, puis 3ème+, puis 2ème+

// Largeur disponible pour la colonne Prénoms (en mm, pour A4 portrait 210mm).
// Contenu utile = 210 - 2×8mm (@page margin) = 194mm.
// Colonnes fixes : N°(6) + Matricule(20) + Nom(20) + Total(10) + Moy(8) + Obs(6) = 70mm.
// Colonnes matières : subjectCount × (8mm si >6 matières, sinon 12mm).
// Reste pour Prénoms = 194 - 70 - (subjectCount × matiereWidth).
function getAvailableWidthForPrenoms(subjectCount: number): number {
  // Nouvelles largeurs fixes (px → mm à ~3.78px/mm) :
  // N°: 24px≈6mm, Matricule: 73px≈19mm, Nom: 60px≈16mm,
  // Total: 22px≈6mm, Moyenne: 22px≈6mm, Observat.: 22px≈6mm
  // N°: 21px≈6mm, Matricule: 67px≈18mm, Nom: 52px≈14mm,
  // Total: 22px≈6mm, Moyenne: 22px≈6mm, Observat.: 22px≈6mm
  // Total fixe = 6+18+14+6+6+6 = 56mm
  const matiereWidth = subjectCount > 6 ? 6 : 11;
  const fixedColumns = 56;
  const availableWidth = 194 - fixedColumns - subjectCount * matiereWidth;
  return Math.max(availableWidth, 20);
}

// Estime la largeur d'affichage d'un texte (en mm) pour text-[11px].
// Calibration : 1.1mm par caractère (compact pour CP, suffit pour CM).
function estimateTextWidth(text: string): number {
  return text.length * 1.1;
}

// Abréviation progressive : initialise un prénom en "X." (première lettre + point).
function toInitial(name: string): string {
  return name.charAt(0).toUpperCase() + ".";
}

// Décide dynamiquement combien de prénoms abréger selon l'espace disponible.
// Stratégie :
//   - Si tout tient → afficher tel quel
//   - Sinon → abréger le 4ème+ en initiales, re-tester
//   - Si ça ne suffit pas → abréger aussi le 3ème+, re-tester
//   - En dernier recours → abréger le 2ème+ (garder seulement le 1er entier)
function smartAbbreviate(fullName: string, availableWidthMm: number): string {
  const parts = fullName.trim().split(/\s+/);

  // Cas simple : 1-3 prénoms, on teste si ça tient
  const fullWidth = estimateTextWidth(fullName);
  if (fullWidth <= availableWidthMm) return fullName;

  // Si 4 prénoms ou plus : abréger progressivement
  if (parts.length >= 4) {
    // Niveau 1 : garder 3 premiers entiers, abréger le reste
    const lvl1 = [...parts.slice(0, 3), ...parts.slice(3).map(toInitial)].join(" ");
    if (estimateTextWidth(lvl1) <= availableWidthMm) return lvl1;

    // Niveau 2 : garder 2 premiers, abréger le reste
    const lvl2 = [...parts.slice(0, 2), ...parts.slice(2).map(toInitial)].join(" ");
    if (estimateTextWidth(lvl2) <= availableWidthMm) return lvl2;

    // Niveau 3 : garder 1 seul, abréger le reste
    const lvl3 = [parts[0], ...parts.slice(1).map(toInitial)].join(" ");
    return lvl3;
  }

  // 2-3 prénoms qui ne tiennent pas : abréger le dernier
  if (parts.length === 3) {
    const lvl1 = [parts[0], parts[1], toInitial(parts[2])].join(" ");
    if (estimateTextWidth(lvl1) <= availableWidthMm) return lvl1;
    const lvl2 = [parts[0], toInitial(parts[1]), toInitial(parts[2])].join(" ");
    return lvl2;
  }

  if (parts.length === 2) {
    const lvl1 = [parts[0], toInitial(parts[1])].join(" ");
    return lvl1;
  }

  return fullName;
}

function fmt(v: number, hasGrade: boolean): string {
  if (!hasGrade) return "—";
  const r = Math.round(v * 100) / 100;
  return r.toFixed(2).replace(/\.?0+$/, "");
}

export default function RelevePage() {
  // v2 — VERROU D'IMPRESSION : réservé à l'Admin IEP + Super Admin
  // (consultation écran pour le directeur) — hook AVANT tout early return.
  storeUrlTokenIfPresent();
  const role = usePrintRole();
  const canPrint = canPrintDocument(role, false);
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
        // Nom du PDF dynamique : le navigateur utilise document.title comme nom
        // de fichier par défaut dans le dialog "Enregistrer au format PDF".
        // Format D : "Relevé CP1 — EPP COTIERE PALMERAIE (COMPOSITION N°2 — 12-2026)"
        // — "—" (em dash) sûr pour les filesystems, "-" au lieu de "/" dans la date,
        // accents gardés (COTIÈRE, Février, etc.) pour la lisibilité.
        // NB : la page /releve/batch charge N iframes de /releve → chaque iframe
        // a son propre document.title → chaque PDF bulk a aussi le bon nom auto.
        document.title = `Relevé ${d.class_name} — ${d.school_name} (${d.type_examen} — ${d.month}-${d.year})`;
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
  // Liste des matières — extraite du 1er élève (tous partagent la même liste)
  const subjects: { name: string; display_name: string; max_score: number }[] =
    data.students[0]?.grades?.map((g) => ({
      name: g.subject_name,
      display_name: abbreviateSubject(g.subject_name),
      max_score: g.max_score,
    })) ?? [];
  const stats = data.stats;
  // Largeur disponible pour la colonne Prénoms (dépend du nombre de matières).
  // CP a 9 matières → peu de place → abréviation agressive.
  // CM a 5 matières → beaucoup de place → prénoms souvent entiers.
  const prenomWidth = getAvailableWidthForPrenoms(subjects.length);

  return (
    <div className="bg-gray-100 min-h-screen py-8 print:bg-white print:p-0 print:py-0">
      {/* Barre d'outils — cachée à l'impression */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Relevé de Notes — {data.class_name} · Aperçu
        </h3>
        <div className="flex items-center gap-2">
          {canPrint ? (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800"
            >
              <Printer className="w-4 h-4" />
              Imprimer / PDF
            </button>
          ) : (
            <PrintLockBadge />
          )}
          <button
            onClick={() => window.close()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 rounded-md text-sm"
          >
            <X className="w-4 h-4" />
            Fermer
          </button>
        </div>
      </div>

      {!canPrint && <PrintLockDocumentMessage />}
      {/* === DOCUMENT MULTI-PAGES === */}
      <div id="releve-doc" className={canPrint ? undefined : "print-locked"}>
        {pages.map((pageData, pageIndex) => {
          const isFirstPage = pageIndex === 0;
          const isLastPage = pageIndex === pages.length - 1;

          return (
            <div
              key={pageIndex}
              className={`w-[210mm] min-h-[297mm] print:min-h-0 p-6 bg-white mx-auto mb-8 print:mb-0 shadow-md print:shadow-none print:m-0 print:p-0 print:w-full font-sans text-xs text-black relative overflow-hidden ${!isLastPage ? 'break-after-page' : ''}`}
              style={{ pageBreakAfter: isLastPage ? 'auto' : 'always' }}
            >
              {/* v2 — décor drapeau CI : armoiries en FILIGRANE
                  (fond) + rubans tricolores haut/bas en absolu
                  (zéro impact sur la mise en page) */}
              <CIArmoiriesWatermark opacity={0.06} width="52%" />
              <div className="absolute top-0 left-0 right-0">
                <CIFlagRibbon height="2.2mm" bordered={false} />
              </div>
              <div className="absolute bottom-0 left-0 right-0">
                <CIFlagRibbon height="2.2mm" bordered={false} />
              </div>
              <div>
                {/* === 1. EN-TÊTE DU DOCUMENT (Page 1 uniquement) === */}
                {isFirstPage ? (
                  <div>
                    <div className="flex justify-between items-start">
                      {/* Inspection Gauche */}
                      <div className="text-left space-y-0.5 text-[11px]">
                        <p className="font-semibold">Ministère de l&apos;Education Nationale</p>
                        <p className="font-semibold">Et de l&apos;Alphabétisation</p>
                        <p className="italic">Direction Régionale de {data.iep_region}</p>
                        <p className="font-bold">Inspection de l&apos;Enseignement</p>
                        <p className="font-bold">Préscolaire et Primaire de {data.iep_name}</p>
                        <p>BP : {data.iep_bp || "........."} / Tel : {data.inspector_phone || "............."}</p>
                        <p>Courriel : <span className="text-blue-700 underline">{data.inspector_email || "............"}</span></p>
                      </div>

                      {/* Titre Centre */}
                      <div className="flex flex-col items-center mt-2">
                        <div className="border-2 border-black rounded-[2rem] px-8 py-2 font-bold text-sm tracking-wide">
                          {data.title}
                        </div>
                        <div className="border border-red-500 text-red-600 font-bold text-base px-8 py-1.5 mt-4 tracking-widest uppercase">
                          {data.type_examen}
                        </div>
                      </div>

                      {/* Armoiries Droite */}
                      <div className="flex flex-col items-center text-center min-w-[200px]">
                        <p className="font-semibold text-xs">République de Côte d&apos;Ivoire</p>
                        <p className="italic text-[11px] tracking-wide">Union-Discipline-Travail</p>
                        <img
                          src="/ci-coat-of-arms.png"
                          alt="Armoiries Côte d'Ivoire"
                          className="h-14 my-1 object-contain"
                        />
                      </div>
                    </div>

                    {/* 2. LIGNE ÉCOLE + CODE (gauche) et G/F/T + DATE (droite)
                        Le CODE est juste sous le nom de l'école (même bloc gauche).
                        G/F/T et Date sont alignés à droite au même niveau. */}
                    <div className="flex justify-between items-end font-bold text-xs mt-6 mb-2 uppercase">
                      {/* Bloc gauche : ÉCOLE + CODE empilés */}
                      <div className="text-left">
                        <div>ECOLE : {data.school_name}</div>
                        <div>CODE : {data.school_code}</div>
                      </div>
                      {/* Bloc droit : G/F/T + Date (alignés à droite, même hauteur que ÉCOLE) */}
                      <div className="text-right text-[11px]">
                        <p className="tracking-widest">G {data.total_g} &nbsp; F {data.total_f} &nbsp; T {data.total_t}</p>
                        <p>Date: {data.date}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Rappel de titre discret sur les pages suivantes */
                  <div className="flex justify-between items-center border-b border-black pb-1 mb-3 text-[11px] font-bold">
                    <span>{data.school_name} — {data.title}</span>
                    <span>Page {pageIndex + 1} / {pages.length}</span>
                  </div>
                )}

                {/* === 3. TABLEAU DES NOTES (Colonnes dynamiques, sans barème) === */}
                <table className="w-full border-collapse border border-black text-center text-[11px]">
                  <thead>
                    <tr className="bg-gray-50 font-bold">
                      <th className="border border-black p-0 text-[11px]" style={{ minWidth: "18px", maxWidth: "24px" }}>N°</th>
                      <th className="border border-black p-0 text-[11px] whitespace-nowrap" style={{ minWidth: "65px", maxWidth: "75px" }}>Matricule</th>
                      <th className="border border-black p-0 text-[11px] whitespace-nowrap" style={{ minWidth: "48px", maxWidth: "65px" }}>Nom</th>
                      {/* Prénoms : pas de largeur fixe → s'étend dynamiquement */}
                      <th className="border border-black p-0.5 text-[11px]">Prénoms</th>
                      {/* Matières dynamiques : abrégées, sans barème.
                          Quand il y a beaucoup de matières (CP = 9), on utilise
                          une écriture verticale (writing-mode) qui est plus
                          fiable que transform:rotate pour l'impression.
                          Le texte est lu de bas en haut, ce qui permet d'avoir
                          des noms de matières complets et lisibles tout en
                          ne prenant que ~22px de largeur par colonne. */}
                      {subjects.map((s, idx) => {
                        const isCompact = subjects.length > 6;
                        return (
                          <th
                            key={idx}
                            className={`border border-black p-0.5 text-center ${isEPS(s.name) ? "bg-yellow-300" : ""}`}
                            style={{
                              minWidth: isCompact ? "22px" : "40px",
                              maxWidth: isCompact ? "26px" : "50px",
                              height: isCompact ? "50px" : "auto",
                              // Centrage vertical du texte vertical (CP = 9 matières → mode compact)
                              verticalAlign: "middle",
                            }}
                          >
                            {isCompact ? (
                              <div
                                style={{
                                  writingMode: "vertical-rl",
                                  textOrientation: "mixed",
                                  fontSize: "9px",
                                  fontWeight: "bold",
                                  lineHeight: "1.1",
                                  whiteSpace: "nowrap",
                                  letterSpacing: "0.2px",
                                  paddingBottom: "0px",
                                  // Garantit le centrage vertical aussi dans le flux flex du th
                                  margin: "auto",
                                }}
                              >
                                {s.display_name}
                              </div>
                            ) : (
                              <div
                                style={{
                                  whiteSpace: "nowrap",
                                  fontSize: "9px",
                                  fontWeight: "bold",
                                }}
                              >
                                {s.display_name}
                              </div>
                            )}
                          </th>
                        );
                      })}
                      {/* Total, Moyenne, Observation : vertical quand compact.
                          Hauteur ajustée pour ne pas avoir de vide vertical. */}
                      {[{ label: "Total", short: "Total" }, { label: "Moy.", short: "Moy." }, { label: "Obs.", short: "Obs." }].map(({ label, short }) => (
                        <th
                          key={label}
                          className={`border border-black p-0.5 text-center`}
                          style={{
                            minWidth: subjects.length > 6 ? "22px" : "auto",
                            maxWidth: subjects.length > 6 ? "26px" : "auto",
                            height: subjects.length > 6 ? "50px" : "auto",
                            // Centrage vertical du texte vertical (Total/Moy./Obs. en mode compact)
                            verticalAlign: "middle",
                          }}
                        >
                          {subjects.length > 6 ? (
                            <div
                              style={{
                                writingMode: "vertical-rl",
                                textOrientation: "mixed",
                                fontSize: "9px",
                                fontWeight: "bold",
                                lineHeight: "1",
                                whiteSpace: "nowrap",
                                letterSpacing: "0.1px",
                                paddingBottom: "0px",
                                // Garantit le centrage vertical aussi dans le flux flex du th
                                margin: "auto",
                              }}
                            >
                              {short}
                            </div>
                          ) : (
                            <div
                              style={{
                                whiteSpace: "nowrap",
                                fontSize: "9px",
                                fontWeight: "bold",
                              }}
                            >
                              {label}
                            </div>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageData.map((e, i) => {
                      const num = (isFirstPage ? 0 : PAGE_1_LIMIT + (pageIndex - 1) * OTHER_PAGE_LIMIT) + i + 1;
                      const isFille = e.gender === "F";
                      return (
                        <tr key={num} className="h-4">
                          <td className="border border-black p-0 font-semibold text-[11px]">{num}</td>
                          <td className="border border-black p-0 font-bold text-[11px] font-mono">{e.matricule}</td>
                          <td className={`border border-black p-0 px-0.5 text-left font-bold whitespace-nowrap overflow-hidden text-ellipsis text-[11px] ${isFille ? 'text-red-600' : ''}`}>
                            {e.last_name.toUpperCase()}
                          </td>
                          <td className={`border border-black p-0 px-0.5 text-left font-bold whitespace-nowrap overflow-hidden text-ellipsis text-[11px] ${isFille ? 'text-red-600' : ''}`}>
                            {smartAbbreviate(e.first_name, prenomWidth).toUpperCase()}
                          </td>
                          {subjects.map((subj, idx) => {
                            const g = e.grades[idx];
                            const val = g ? fmt(g.value, g.has_grade) : "—";
                            return (
                              <td
                                key={idx}
                                className={`border border-black p-0 text-[11px] ${isEPS(subj.name) ? "bg-yellow-200 font-bold" : ""}`}
                              >
                                {val}
                              </td>
                            );
                          })}
                          <td className="border border-black p-0 font-bold text-[11px]">
                            {e.has_average ? fmt(e.total, true) : "—"}
                          </td>
                          <td className="border border-black p-0 font-bold text-[11px]">
                            {e.has_average ? fmt(e.average, true) : "—"}
                          </td>
                          <td className="border border-black p-0 font-bold text-[11px]">{e.observation}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* === 4. BLOC FINAL (Statistiques + Signatures collés au tableau) ===
                  Pas de justify-between → le bloc remonte juste sous le tableau.
                  Uniquement sur la dernière page. */}
              {isLastPage && (
                <div className="mt-3 grid grid-cols-3 gap-3 text-center font-bold text-xs break-inside-avoid">
                  {/* === Bloc Statistiques compact === */}
                  <div className="border-2 border-black rounded-lg overflow-hidden">
                    {/* En-tête avec images garçon/fille */}
                    <div className="grid grid-cols-4 bg-white text-[11px] font-bold border-b-2 border-black">
                      <div className="px-1 py-0.5 text-left"></div>
                      <div className="px-1 py-0.5 flex items-center justify-center gap-0.5">
                        <img src="/homme.webp" alt="G" className="w-3 h-3 object-contain" />
                        <span className="text-blue-700">G</span>
                      </div>
                      <div className="px-1 py-0.5 flex items-center justify-center gap-0.5">
                        <img src="/femme.webp" alt="F" className="w-3 h-3 object-contain" />
                        <span className="text-red-600">F</span>
                      </div>
                      <div className="px-1 py-0.5 flex items-center justify-center gap-0.5">
                        <Users className="w-2.5 h-2.5 text-gray-600" />
                        <span className="text-gray-600">T</span>
                      </div>
                    </div>

                    {/* Ligne Inscrits */}
                    <div className="grid grid-cols-4 text-[11px] border-b border-gray-300 bg-gray-50">
                      <div className="px-1 py-0.5 text-left font-bold">Inscrits</div>
                      <div className="px-1 py-0.5 text-center text-blue-700 font-bold">{stats.inscrits_g}</div>
                      <div className="px-1 py-0.5 text-center text-red-600 font-bold">{stats.inscrits_f}</div>
                      <div className="px-1 py-0.5 text-center font-bold">{stats.inscrits_t}</div>
                    </div>

                    {/* Ligne Présents */}
                    <div className="grid grid-cols-4 text-[11px] border-b border-gray-300 bg-gray-50">
                      <div className="px-1 py-0.5 text-left font-bold">Présents</div>
                      <div className="px-1 py-0.5 text-center text-blue-700 font-bold">{stats.presents_g}</div>
                      <div className="px-1 py-0.5 text-center text-red-600 font-bold">{stats.presents_f}</div>
                      <div className="px-1 py-0.5 text-center font-bold">{stats.presents_t}</div>
                    </div>

                    {/* Ligne Admis — vert */}
                    <div className="grid grid-cols-4 text-[11px] border-b border-gray-300 bg-emerald-50">
                      <div className="px-1 py-0.5 text-left font-bold flex items-center gap-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                        Admis
                      </div>
                      <div className="px-1 py-0.5 text-center text-emerald-700 font-bold">{stats.admis_g}</div>
                      <div className="px-1 py-0.5 text-center text-emerald-700 font-bold">{stats.admis_f}</div>
                      <div className="px-1 py-0.5 text-center text-emerald-700 font-bold">{stats.admis_t}</div>
                    </div>

                    {/* Ligne % par genre */}
                    <div className="grid grid-cols-4 text-[11px] bg-gray-100">
                      <div className="px-1 py-0.5 text-left font-bold flex items-center gap-0.5">
                        <TrendingUp className="w-2.5 h-2.5 text-gray-500" />
                        % Admis
                      </div>
                      <div className="px-1 py-0.5 text-center text-blue-700 font-bold">{fmt(stats.pct_g, true)}%</div>
                      <div className="px-1 py-0.5 text-center text-red-600 font-bold">{fmt(stats.pct_f, true)}%</div>
                      <div className="px-1 py-0.5 text-center font-bold">{fmt(stats.pct_t, true)}%</div>
                    </div>

                    {/* Barre de progression + % total */}
                    <div className="bg-white px-2 py-1 border-t-2 border-gray-800">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] font-bold text-gray-700 flex items-center gap-0.5">
                          <Award className="w-3 h-3 text-amber-500" />
                          Taux de Réussite
                        </span>
                        <span className="text-lg font-black text-emerald-600 leading-none">
                          {fmt(stats.pct_t, true)}%
                        </span>
                      </div>
                      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full flex items-center justify-end pr-1"
                          style={{
                            width: `${Math.min(stats.pct_t, 100)}%`,
                            background: stats.pct_t >= 75
                              ? "linear-gradient(90deg, #10b981, #059669)"
                              : stats.pct_t >= 50
                                ? "linear-gradient(90deg, #f59e0b, #d97706)"
                                : "linear-gradient(90deg, #ef4444, #dc2626)",
                          }}
                        >
                          {stats.pct_t >= 20 && (
                            <span className="text-[7px] text-white font-bold">
                              {stats.admis_t}/{stats.presents_t}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bloc Directeur compact */}
                  <div className="border-2 border-black rounded-lg p-1.5 flex flex-col justify-between min-h-[90px]">
                    <span className="underline uppercase text-[11px]">Le Directeur</span>
                    <div className="flex-grow"></div>
                    <span className="uppercase text-[11px] tracking-wide">
                      {data.director_name || "................................"}
                    </span>
                  </div>

                  {/* Bloc Inspecteur compact */}
                  <div className="border-2 border-black rounded-lg p-1.5 flex flex-col justify-between min-h-[90px]">
                    <span className="underline uppercase text-[11px]">L&apos;Inspecteur</span>
                    <div className="flex-grow"></div>
                    <span className="uppercase text-[11px] tracking-wide">
                      {data.inspector_name || "................................"}
                    </span>
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
