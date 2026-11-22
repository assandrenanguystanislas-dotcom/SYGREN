"use client";

// === Document imprimable « FICHIER SECTEUR {X} — ÉLÈVES DE CM2 » (module
// === Résultats — Task 86) ===
//
// Demande utilisateur : « mettre aussi en version pdf et word imprimable »
// — le fichier CM2 (Task 84/85 : notes GÉNÉRÉES depuis le module
// Évaluations, entête EXACTE 13 colonnes) devient imprimable comme les
// autres documents officiels, selon le pattern maison des 3 modèles :
//
//   - PDF   : impression navigateur (window.print) sur la route dédiée
//             /cm2-file-doc — A4 PAYSAGE, entête 13 colonnes RÉPÉTÉE sur
//             chaque page (thead display:table-header-group), lignes
//             insécables (tr break-inside:avoid) ;
//   - WORD  : fichier .doc HTML MSO (buildWordShell A4 paysage) — Word
//             pagine naturellement, la bande école + l'entête 13 colonnes
//             (dans le thead) se répètent à chaque page ;
//   - EXCEL : export existant (cm2-export.ts, inchangé) — accessible
//             depuis la même barre pour le Super Admin.
//
// FIDÉLITÉ AU FICHIER : le document reprend À L'IDENTIQUE la mise en page
// de l'export Excel (Task 84) validée par l'utilisateur :
//   - 3 lignes de titres centrées : « FICHIER SECTEUR {X} — ÉLÈVES DE
//     CM2 » / « IEP DABOU 1 — CODE IEP : 000045 — ANNÉE SCOLAIRE … » /
//     « COMPOSITION N°X — notes issues du module Évaluations — C1 = … » ;
//   - bandeau gris par école « ECOLE : … — CODE : … — n élève(s) » ;
//   - entête EXACTEMENT celle de la demande (CM2_HEADERS partagé avec
//     l'Excel) : matricule, nom, prenoms, libecole, codeecole, libiep,
//     iep, exploitation, eveil, orthographe, math, Total, C1 ;
//   - libecole = nom de l'école, codeecole = code de l'école,
//     libiep = DABOU 1, iep = 000045 (constantes CM2_IEP_* partagées) ;
//   - Total = Σ dès 1 note, C1 = Σ/8,5 dès les 4 notes (calculés serveur,
//     affichage 2 décimales pour C1 comme le numFmt Excel).
//
// POLITIQUE D'ACCÈS (print-guard + doc-export, Tasks 24/71) :
//   - PDF (impression papier) : admin + inspector uniquement ;
//   - Word / Excel (production de FICHIERS transférables) : Super Admin.
// Les autres rôles voient le document en consultation avec badges de
// verrou + remplacement à l'impression (PrintLockDocumentMessage).

import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Loader2, Printer, X } from "lucide-react";
import { useState } from "react";

import { cm2Api } from "@/lib/api";
import {
  cm2SecteurFileBase,
  CM2_HEADERS,
  CM2_IEP_CODE,
  CM2_IEP_LIB,
  exportCm2SecteurExcel,
} from "@/lib/cm2-export";
import { buildWordShell, canExportFiles, escHtml, ExportLockBadge, saveBlob } from "@/lib/doc-export";
import type { Cm2FileData, Cm2SchoolGroup, Cm2SectorGroup } from "@/lib/types";
import {
  canPrintDocument,
  PrintLockBadge,
  PrintLockDocumentMessage,
  usePrintRole,
} from "@/lib/print-guard";

const DOC_FONT = '"Arial", "Helvetica", "Liberation Sans", sans-serif';

// Bordure grille grise fine (même rendu que l'Excel — BOX #B0B0B0).
const GRID = "1px solid #b0b0b0";

// Largeurs des 13 colonnes en % (proportions de l'Excel WIDTHS /204).
const COL_WIDTHS = [
  "5.9%", "16.7%", "17.2%", "16.7%", "4.9%", "5.4%", "4.9%",
  "5.4%", "4.4%", "5.4%", "4.4%", "4.4%", "4.4%",
];
// Colonnes centrées : tout sauf nom (1), prenoms (2), libecole (3).
const CENTERED = new Set([0, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

// Date du jour au format jj/mm/aaaa (rendu identique serveur/client).
function todayFr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Nombre compact : entier sans décimale, sinon ≤ 2 décimales (notes,
// Total). C1 garde 2 décimales fixes (comme le numFmt Excel 0.00).
function fmtNote(n: number | null | undefined): string {
  if (n == null) return "";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// === Titre du document (3 lignes — miroir de l'Excel, Task 84) ===
function titleLines(group: Cm2SectorGroup, round: { year: number; number: number }) {
  return [
    `FICHIER SECTEUR ${group.secteur_name} — ÉLÈVES DE CM2`,
    `IEP ${CM2_IEP_LIB} — CODE IEP : ${CM2_IEP_CODE} — ANNÉE SCOLAIRE ${round.year}-${round.year + 1}`,
    `COMPOSITION N°${round.number} — notes issues du module Évaluations — C1 = (exploitation + eveil + orthographe + math) / 8,5`,
  ];
}

// === Modèle WORD (.doc) — HTML MSO fidèle au document imprimé ===
function buildWordHtml(group: Cm2SectorGroup, data: Cm2FileData): string {
  const [l1, l2, l3] = titleLines(group, data.round);

  const schoolTables = group.schools
    .map((sch: Cm2SchoolGroup) => {
      const band =
        `<tr><th colspan="13" style="border:${GRID}; background:#d9d9d9; ` +
        `font-weight:bold; text-align:left; padding:2px 6px; font-size:10px;">` +
        `ECOLE : ${escHtml(sch.school_name)} — CODE : ${escHtml(sch.school_code)} — ` +
        `${sch.students.length} élève(s)</th></tr>`;
      const heads =
        `<tr>` +
        CM2_HEADERS.map(
          (h, i) =>
            `<th style="border:${GRID}; background:#404040; color:#ffffff; ` +
            `font-weight:bold; text-align:center; padding:2px 3px; font-size:9px; ` +
            `width:${COL_WIDTHS[i]};">${escHtml(h)}</th>`,
        ).join("") +
        `</tr>`;
      const rows = sch.students
        .map((st) => {
          const tds = [
            escHtml(st.matricule ?? ""),
            escHtml(st.nom),
            escHtml(st.prenoms),
            escHtml(st.school_name),
            escHtml(st.school_code),
            CM2_IEP_LIB,
            CM2_IEP_CODE,
            fmtNote(st.note_exploitation),
            fmtNote(st.note_eveil),
            fmtNote(st.note_orthographe),
            fmtNote(st.note_math),
            fmtNote(st.total),
            st.c1 != null ? st.c1.toFixed(2) : "",
          ];
          return (
            `<tr>` +
            tds
              .map(
                (v, i) =>
                  `<td style="border:${GRID}; padding:1px 3px; font-size:9px; ` +
                  `text-align:${CENTERED.has(i) ? "center" : "left"}; ` +
                  `font-weight:${i >= 11 ? "bold" : "normal"}; ` +
                  `word-wrap:break-word;">${v}</td>`,
              )
              .join("") +
            `</tr>`
          );
        })
        .join("");
      return (
        `<table class="doc"><thead class="rep">${band}${heads}</thead><tbody>${rows}</tbody></table>`
      );
    })
    .join("");

  return buildWordShell({
    title: l1,
    orientation: "landscape",
    marginMm: 6,
    styles: `
p { margin:0; }
.titre1 { text-align:center; font-size:14px; font-weight:bold; letter-spacing:0.5px; }
.titre2 { text-align:center; font-size:11px; font-weight:bold; color:#00734A; margin-top:2px; }
.titre3 { text-align:center; font-size:9.5px; font-style:italic; color:#555555; margin-top:2px; }
table.doc { border-collapse:collapse; width:100%; table-layout:fixed; margin-top:4mm; }
table.doc td, table.doc th { overflow-wrap:break-word; }
thead.rep { display:table-header-group; }
tr { page-break-inside:avoid; }
`,
    bodyHtml: `
<p class="titre1">${escHtml(l1)}</p>
<p class="titre2">${escHtml(l2)}</p>
<p class="titre3">${escHtml(l3)}</p>
${schoolTables}
`,
  });
}

export function Cm2FileDocument({
  year,
  number,
  secteur,
  onClose,
}: {
  year: number;
  number: number;
  secteur: string; // id du secteur ou « hors » (HORS SECTEUR)
  onClose: () => void;
}) {
  const role = usePrintRole();
  const canPrint = canPrintDocument(role, false);
  const canExport = canExportFiles(role);
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["cm2", "file", year, number],
    queryFn: () => cm2Api.getFile(year, number),
  });

  const group: Cm2SectorGroup | null = data
    ? (data.groups.find((g) => (g.secteur_id ?? "hors") === secteur) ?? null)
    : null;
  const nStudents = group
    ? group.schools.reduce((n, s) => n + s.students.length, 0)
    : 0;

  async function handleWord() {
    if (!group || !data) return;
    setExporting("doc");
    try {
      const html = buildWordHtml(group, data);
      saveBlob(
        new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }),
        `${cm2SecteurFileBase(data.round, group.secteur_name)}.doc`,
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExcel() {
    if (!group || !data) return;
    setExporting("xlsx");
    try {
      await exportCm2SecteurExcel(
        { round: data.round, secteurName: group.secteur_name, schools: group.schools },
        `${cm2SecteurFileBase(data.round, group.secteur_name)}.xlsx`,
      );
    } finally {
      setExporting(null);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Chargement du fichier CM2…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Impossible de charger le fichier CM2
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

  if (!group) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            Secteur introuvable dans le fichier CM2 N°{number} — {year}
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

  const [l1, l2, l3] = titleLines(group, data.round);

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Fichier CM2 — secteur {group.secteur_name} · Composition N°{data.round.number} —{" "}
          {data.round.year} · {nStudents} élève(s)
        </h3>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-muted-foreground mr-1">
            Format : A4 paysage
          </span>
          {canPrint ? (
            <>
              <button
                onClick={() => window.print()}
                title="Imprimer ou enregistrer en PDF (boîte d'impression du navigateur)"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90"
              >
                <Printer className="w-4 h-4" />
                PDF
              </button>
              {canExport ? (
                <>
                  <button
                    onClick={handleWord}
                    disabled={exporting !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm hover:opacity-90 disabled:opacity-50"
                  >
                    {exporting === "doc" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                    Word
                  </button>
                  <button
                    onClick={handleExcel}
                    disabled={exporting !== null}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-md text-sm hover:opacity-90 disabled:opacity-50"
                  >
                    {exporting === "xlsx" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-4 h-4" />
                    )}
                    Excel
                  </button>
                </>
              ) : (
                <ExportLockBadge />
              )}
            </>
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

      {/* Message imprimé à la place du document si impression verrouillée */}
      {!canPrint && <PrintLockDocumentMessage />}

      {/* === DOCUMENT (isolement impression #cm2-file-doc) === */}
      <div
        id="cm2-file-doc"
        className={`mx-auto my-3 ${canPrint ? "" : "print-locked"}`}
        style={{ width: "100%", maxWidth: "281mm", fontFamily: DOC_FONT, color: "#111111" }}
      >
        {/* 3 lignes de titres — miroir de l'Excel */}
        <p style={{ textAlign: "center", fontSize: "14px", fontWeight: 700, letterSpacing: "0.5px" }}>
          {l1}
        </p>
        <p style={{ textAlign: "center", fontSize: "11px", fontWeight: 700, color: "#00734A", marginTop: "2px" }}>
          {l2}
        </p>
        <p style={{ textAlign: "center", fontSize: "9.5px", fontStyle: "italic", color: "#555555", marginTop: "2px" }}>
          {l3}
        </p>
        <p style={{ textAlign: "right", fontSize: "9px", color: "#555555", marginTop: "1mm" }}>
          Édité le {todayFr()} — {nStudents} élève(s)
        </p>

        {/* Une table par école : bandeau + entête 13 colonnes dans le
            thead → répétés à chaque page ; lignes élèves insécables. */}
        {group.schools.map((sch) => (
          <table
            key={sch.school_id}
            style={{
              borderCollapse: "collapse",
              width: "100%",
              tableLayout: "fixed",
              marginTop: "4mm",
            }}
          >
            <thead style={{ display: "table-header-group" }}>
              <tr>
                <th
                  colSpan={13}
                  style={{
                    border: GRID,
                    background: "#d9d9d9",
                    fontWeight: 700,
                    textAlign: "left",
                    padding: "2px 6px",
                    fontSize: "10px",
                    ...PRINT_COLOR,
                  }}
                >
                  ECOLE : {sch.school_name} — CODE : {sch.school_code} —{" "}
                  {sch.students.length} élève(s)
                </th>
              </tr>
              <tr>
                {CM2_HEADERS.map((h, i) => (
                  <th
                    key={h}
                    style={{
                      border: GRID,
                      background: "#404040",
                      color: "#ffffff",
                      fontWeight: 700,
                      textAlign: "center",
                      padding: "2px 3px",
                      fontSize: "9px",
                      width: COL_WIDTHS[i],
                      ...PRINT_COLOR,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sch.students.map((st) => (
                <tr key={st.student_id} style={{ pageBreakInside: "avoid" }}>
                  {[st.matricule ?? "", st.nom, st.prenoms, st.school_name, st.school_code,
                    CM2_IEP_LIB, CM2_IEP_CODE,
                    fmtNote(st.note_exploitation), fmtNote(st.note_eveil),
                    fmtNote(st.note_orthographe), fmtNote(st.note_math),
                    fmtNote(st.total), st.c1 != null ? st.c1.toFixed(2) : "",
                  ].map((v, i) => (
                    <td
                      key={i}
                      style={{
                        border: GRID,
                        padding: "1px 3px",
                        fontSize: "9px",
                        textAlign: CENTERED.has(i) ? "center" : "left",
                        fontWeight: i >= 11 ? 700 : 400,
                        overflowWrap: "break-word",
                        ...(i === 0 || i === 4 || i === 6
                          ? { fontVariantNumeric: "tabular-nums" as const }
                          : {}),
                        ...PRINT_COLOR,
                      }}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}

// Couleurs forcées à l'impression (le bandeau gris et l'entête sombre
// doivent rester visibles sur papier).
const PRINT_COLOR = {
  WebkitPrintColorAdjust: "exact" as const,
  printColorAdjust: "exact" as const,
};
