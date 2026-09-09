"use client";

// === Document officiel « LISTE DES CANDIDATS DE {classe} A L'EXAMEN DU
// === CEPE {année} » (module Élèves — image ELEVES IA_1 / IA_2 reçue de
// l'utilisateur) ===
//
// C'EST CE DOCUMENT (et non le « RESULTATS DE FIN D'ANNEE », resté
// inchangé, ni l'ancienne fiche individuelle supprimée) qui doit
// apparaître dans le module Élèves — demande utilisateur : « le résultat
// de fin d'année ne doit pas être modifié ; c'est plutôt le document que
// je vous ai envoyé qui doit apparaître dans le module élève ».
//
// Conforme à l'image (A4 PAYSAGE) :
//   - En-tête : Ministère de l'Education Nationale / Et de l'Alphabétisation,
//     Direction Régionale + Inspection Préscolaire et Primaire (italique
//     gras), BP/Tel/Courriel à gauche ; République de Côte d'Ivoire +
//     Union-Discipline-Travail + armoiries à droite ;
//   - Titre encadré (bord arrondi, ombre portée) : « LISTE DES CANDIDATS
//     DE {CLASSE} A L'EXAMEN / DU CEPE {année} » — année de l'examen =
//     année de fin de l'année scolaire en cours (rentrée août/septembre) ;
//   - ECOLE : {nom} + CODE : {code ministériel} (gauche) ;
//   - Effectifs « G {garçons}  F {filles}  T {total} » + Date (droite) ;
//   - Tableau 14 colonnes exactement comme le modèle : n° | matricule |
//     nom | prenoms | sexe | jour | mois | annee | lieu de naissance |
//     nationalite | père | mere | nacte | lieuacte ;
//   - Lignes vides pour compléter la page (modèle papier) ;
//   - Pagination multipage : « ELEVES (n) » en bas de CHAQUE page, numéro
//     de page en haut au centre, signature « LE DIRECTEUR » (soulignée)
//     en bas à gauche de la DERNIÈRE page ;
//   - Convention maison : noms/prénoms des FILLES en rouge (comme les
//     tableaux de classement et « RESULTATS DE FIN D'ANNEE »).

import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";
import type { CSSProperties } from "react";

import { studentsApi } from "@/lib/api";
import type { StudentWithClass } from "@/lib/types";

import { INK, OFFICIAL_FONT } from "./official-doc";
import { PRINT_COLOR_STYLE } from "@/components/ci-decor";
import {
  canPrintDocument,
  PrintLockBadge,
  PrintLockDocumentMessage,
  usePrintRole,
} from "@/lib/print-guard";

// === Pagination (hauteurs calibrées A4 paysage : zone imprimable 194mm) ===
// Ligne de tableau : 6mm fixe. Page 1 : en-tête ~41mm + thead 8mm + 21
// lignes (126mm) + pied 6mm ≈ 181mm ≤ 194mm. Pages suivantes : numéro 5mm
// + thead 8mm + 27 lignes (162mm) ≈ 175mm. Dernière page : 25 lignes +
// place pour la signature « LE DIRECTEUR ».
const ROWS_FIRST_PAGE = 21;
const ROWS_PER_PAGE = 27;
const ROWS_LAST_PAGE = 25;
const ROW_HEIGHT = "6mm";

// Date du jour au format jj/mm/aaaa (rendu identique serveur/client).
function todayFr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Année de l'examen du CEPE : année de FIN de l'année scolaire en cours
// (rentrée août/septembre → examen juin/juillet suivant). Septembre 2026 →
// année scolaire 2026 2027 → CEPE 2027 (comme le modèle de l'utilisateur).
function cepeExamYear(): number {
  const now = new Date();
  return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
}

// Prénoms « en minuscule » : initiale en majuscule, lettres suivantes en
// minuscules (segments séparés par espace, tiret ou apostrophe).
function titleCasePrenoms(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'\-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

// Cellule texte : null/undefined → vide (la grille reste propre comme le
// modèle papier — les champs manquants se complètent à la main).
function cell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v).trim();
  return s === "0" ? "" : s;
}

// Bordure grille noire fine (modèle papier de l'utilisateur).
const GRID = "1px solid #000000";

const thStyle: CSSProperties = {
  border: GRID,
  padding: "1px 2px",
  fontSize: "9px",
  fontWeight: 700,
  textAlign: "center",
  verticalAlign: "middle",
  color: INK,
  background: "#ffffff",
  lineHeight: 1.15,
  ...PRINT_COLOR_STYLE,
};

function tdStyle(align: "left" | "center", red = false): CSSProperties {
  return {
    border: GRID,
    padding: "0 3px",
    fontSize: "9.5px",
    height: ROW_HEIGHT,
    textAlign: align,
    verticalAlign: "middle",
    color: red ? "#dc2626" : INK,
    background: "#ffffff",
    whiteSpace: "nowrap",
    overflow: "hidden",
    lineHeight: 1.15,
    ...PRINT_COLOR_STYLE,
  };
}

// Les 14 colonnes EXACTES du modèle (libellés en minuscules comme l'image).
const COLS: Array<{
  w: string;
  label: string;
  align: "left" | "center";
}> = [
  { w: "3.5%", label: "n°", align: "center" },
  { w: "8%", label: "matricule", align: "center" },
  { w: "10%", label: "nom", align: "left" },
  { w: "13.5%", label: "prenoms", align: "left" },
  { w: "4.5%", label: "sexe", align: "center" },
  { w: "3.8%", label: "jour", align: "center" },
  { w: "4.7%", label: "mois", align: "center" },
  { w: "4.7%", label: "annee", align: "center" },
  { w: "9.8%", label: "lieu de naissance", align: "left" },
  { w: "8%", label: "nationalite", align: "left" },
  { w: "11%", label: "père", align: "left" },
  { w: "9%", label: "mere", align: "left" },
  { w: "4.8%", label: "nacte", align: "center" },
  { w: "4.7%", label: "lieuacte", align: "center" },
];

// Découpe la classe en pages : [21, 27, 27, …, 25] lignes (la dernière
// page garde la place de la signature « LE DIRECTEUR »).
function pageCapacities(total: number): number[] {
  if (total <= ROWS_FIRST_PAGE) return [Math.max(ROWS_FIRST_PAGE - 2, 5)];
  const caps: number[] = [ROWS_FIRST_PAGE];
  let filled = ROWS_FIRST_PAGE;
  while (filled < total) {
    const remaining = total - filled;
    caps.push(remaining <= ROWS_LAST_PAGE - 1 ? ROWS_LAST_PAGE : ROWS_PER_PAGE);
    filled += caps[caps.length - 1];
  }
  return caps;
}

export function CandidatesListDocument({
  classId,
  onClose,
}: {
  classId: string;
  onClose: () => void;
}) {
  const role = usePrintRole();
  const canPrint = canPrintDocument(role, false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["liste-candidats", classId],
    queryFn: () => studentsApi.candidates(classId),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Chargement de la liste des candidats…
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Impossible de charger la liste des candidats
            {(error as Error)?.message ? ` — ${(error as Error).message}` : ""}
          </p>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-gray-200 rounded-md text-sm"
          >
            Fermer
          </button>
        </div>
      </div>
    );
  }

  const students: StudentWithClass[] = data.students ?? [];
  const total = data.count ?? students.length;
  const garcons = students.filter((s) => s.gender === "M").length;
  const filles = students.filter((s) => s.gender === "F").length;

  const iep = data.iep;
  const classeName = (data.class.name || "…………").toUpperCase();
  const annee = cepeExamYear();

  // Découpage en pages + lignes vides de complétion (modèle papier).
  const caps = pageCapacities(total);
  const pages: Array<Array<StudentWithClass | null>> = [];
  let idx = 0;
  for (const cap of caps) {
    const slice = students.slice(idx, idx + cap);
    pages.push([
      ...slice,
      ...Array.from({ length: Math.max(0, cap - slice.length) }, () => null),
    ]);
    idx += slice.length;
  }
  const lastPageIdx = pages.length - 1;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Liste des candidats CEPE {annee} — {data.class.name} ·{" "}
          {data.school.name}
        </h3>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-muted-foreground mr-1">
            Format : A4 paysage
          </span>
          {canPrint ? (
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90"
            >
              <Printer className="w-4 h-4" />
              Imprimer / PDF
            </button>
          ) : (
            <PrintLockBadge />
          )}
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 rounded-md text-sm"
          >
            <X className="w-4 h-4" />
            Fermer
          </button>
        </div>
      </div>

      {/* === DOCUMENT OFFICIEL (isolement impression #liste-candidats-doc) === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="liste-candidats-doc"
        className={`mx-auto my-3 ${canPrint ? "" : "print-locked"}`}
        style={{ width: "100%", maxWidth: "281mm", fontFamily: OFFICIAL_FONT, color: INK }}
      >
        {pages.map((rows, pageIdx) => {
          const isFirst = pageIdx === 0;
          const isLast = pageIdx === lastPageIdx;
          return (
            <div
              key={pageIdx}
              className={`candidats-page bg-white shadow-lg print:shadow-none ${!isLast ? "mb-4 print:mb-0" : ""}`}
              style={{
                position: "relative",
                height: "192mm", // < zone imprimable 194mm — ÉVITE la page blanche de débordement
                padding: "6mm 7mm",
                overflow: "hidden",
                pageBreakAfter: isLast ? "auto" : "always",
                breakAfter: isLast ? "auto" : "page",
              }}
            >
              {/* Numéro de page (haut centre — comme le modèle) */}
              <div
                style={{
                  position: "absolute",
                  top: "1mm",
                  left: 0,
                  right: 0,
                  textAlign: "center",
                  fontSize: "10px",
                  color: INK,
                }}
              >
                {pageIdx + 1}
              </div>

              {/* --- En-tête complet : page 1 uniquement --- */}
              {isFirst && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: "6px",
                  }}
                >
                  {/* Bloc ministériel + école (gauche) */}
                  <div style={{ width: "33%", fontSize: "10.5px", lineHeight: 1.4 }}>
                    <div>Ministère de l&apos;Education Nationale</div>
                    <div>Et de l&apos;Alphabétisation</div>
                    <div style={{ fontStyle: "italic", fontWeight: 700, marginTop: "1px" }}>
                      Direction Régionale de {iep?.region || "…………"}
                    </div>
                    <div style={{ fontStyle: "italic", fontWeight: 700 }}>
                      Inspection de l&apos;Enseignement
                    </div>
                    <div style={{ fontStyle: "italic", fontWeight: 700 }}>
                      Préscolaire et Primaire de {iep?.name || "…………"}
                    </div>
                    <div style={{ fontWeight: 700, marginTop: "1px" }}>
                      BP : {iep?.bp || "……"} / Tel : {iep?.inspector_phone || "…………"}
                    </div>
                    <div style={{ fontWeight: 700 }}>
                      Courriel :{" "}
                      <span
                        style={{
                          color: "#0563C1",
                          textDecoration: "underline",
                          ...PRINT_COLOR_STYLE,
                        }}
                      >
                        {iep?.inspector_email || "…………"}
                      </span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "12px", marginTop: "5px" }}>
                      ECOLE : {data.school.name}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "11px" }}>
                      CODE: {data.school.code || "…………"}
                    </div>
                  </div>

                  {/* Titre encadré (centre) */}
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      justifyContent: "center",
                      paddingTop: "14px",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        border: "2px solid #000000",
                        borderRadius: "12px",
                        padding: "7px 20px 8px",
                        fontSize: "16px",
                        fontWeight: 700,
                        lineHeight: 1.35,
                        letterSpacing: "0.5px",
                        textAlign: "center",
                        color: INK,
                        boxShadow: "3px 3px 0 #bfbfbf",
                        ...PRINT_COLOR_STYLE,
                      }}
                    >
                      LISTE DES CANDIDATS DE {classeName} A L&apos;EXAMEN
                      <br />
                      DU CEPE {annee}
                    </span>
                  </div>

                  {/* République + armoiries + effectifs + date (droite) */}
                  <div
                    style={{
                      width: "21%",
                      textAlign: "center",
                      fontSize: "11px",
                      lineHeight: 1.35,
                    }}
                  >
                    <div>République de Côte d&apos;Ivoire</div>
                    <div style={{ fontSize: "10.5px", padding: "1px 0" }}>
                      Union-Discipline-Travail
                    </div>
                    <img
                      src="/ci-coat-of-arms.png"
                      alt="Armoiries de la République de Côte d'Ivoire"
                      style={{ height: "42px", margin: "2px auto", display: "block" }}
                    />
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "12.5px",
                        letterSpacing: "1.5px",
                        marginTop: "3px",
                      }}
                    >
                      G {garcons}&nbsp;&nbsp;F {filles}&nbsp;&nbsp;T {total}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "10.5px", marginTop: "1px" }}>
                      Date: {todayFr()}
                    </div>
                  </div>
                </div>
              )}

              {/* Espace entre en-tête et tableau (page 1) */}
              <div style={{ height: isFirst ? "3mm" : "4mm" }} />

              {/* --- Tableau 14 colonnes (modèle exact de l'utilisateur) --- */}
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  tableLayout: "fixed",
                  color: INK,
                }}
              >
                <colgroup>
                  {COLS.map((c) => (
                    <col key={c.label} style={{ width: c.w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {COLS.map((c) => (
                      <th key={c.label} style={thStyle}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, i) => {
                    const numero = idxOffset(pages, pageIdx) + i + 1;
                    const isGirl = s?.gender === "F";
                    return (
                      <tr key={s?.id ?? `empty-${i}`} style={{ pageBreakInside: "avoid" }}>
                        <td style={tdStyle("center")}>{s ? numero : ""}</td>
                        <td style={tdStyle("center")}>{cell(s?.matricule)}</td>
                        <td style={tdStyle("left", isGirl)}>
                          {cell(s?.last_name).toUpperCase()}
                        </td>
                        <td style={tdStyle("left", isGirl)}>
                          {s?.first_name ? titleCasePrenoms(s.first_name) : ""}
                        </td>
                        <td style={tdStyle("center")}>{cell(s?.gender)}</td>
                        <td style={tdStyle("center")}>{cell(s?.birth_day)}</td>
                        <td style={tdStyle("center")}>{cell(s?.birth_month)}</td>
                        <td style={tdStyle("center")}>{cell(s?.birth_year)}</td>
                        <td style={tdStyle("left")}>{cell(s?.birth_place)}</td>
                        <td style={tdStyle("left")}>{cell(s?.nationality)}</td>
                        <td style={tdStyle("left")}>{cell(s?.father_name)}</td>
                        <td style={tdStyle("left")}>{cell(s?.mother_name)}</td>
                        <td style={tdStyle("center")}>{cell(s?.acte_number)}</td>
                        <td style={tdStyle("center")}>{cell(s?.acte_place)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Signature « LE DIRECTEUR » — bas gauche de la DERNIÈRE page */}
              {isLast && (
                <div
                  style={{
                    marginTop: "5mm",
                    fontWeight: 700,
                    fontSize: "12px",
                    textDecoration: "underline",
                    color: INK,
                    ...PRINT_COLOR_STYLE,
                  }}
                >
                  LE DIRECTEUR
                </div>
              )}

              {/* Pied de page « ELEVES (n) » — CHAQUE page (comme le modèle) */}
              <div
                style={{
                  position: "absolute",
                  bottom: "2mm",
                  left: 0,
                  right: 0,
                  textAlign: "center",
                  fontSize: "11px",
                  color: INK,
                }}
              >
                ELEVES ({total})
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Numéro de départ (n°) des lignes d'une page : somme des capacités des
 *  pages précédentes — la numérotation continue d'une page à l'autre. */
function idxOffset(pages: Array<Array<unknown>>, pageIdx: number): number {
  let n = 0;
  for (let i = 0; i < pageIdx; i++) n += pages[i].length;
  return n;
}
