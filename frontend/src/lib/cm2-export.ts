"use client";

// === Export Excel du FICHIER CM2 PAR SECTEUR (module Résultats — Task 84) ===
//
// Demande : « les fichiers concernent uniquement les élèves de CM2 ; ces
// fichiers doivent être dans le module Résultats » — libellés de colonnes
// EXACTS : matricule, nom, prenoms, libecole, codeecole, libiep, iep,
// exploitation, eveil, orthographe, math, Total, C1 avec :
//   - libecole  = nom de l'école, codeecole = code de l'école ;
//   - iep = 000045, libiep = DABOU 1 (constantes de la demande) ;
//   - C1 = (exploitation + eveil + orthographe + math) / 8,5.
//
// Task 84 : les notes NE SONT PAS SAISIES dans le module Résultats — elles
// sont GÉNÉRÉES depuis le module Évaluations (compositions) et exportées
// PÉREMPLIES. Structure reprise À L'IDENTIQUE des fichiers par secteur CP
// (Task 82) : 3 lignes de titres fusionnées A:M, ligne d'en-têtes sombre,
// bandeau gris par école « ECOLE : … — CODE : … — n élève(s) », Total =
// SOMME dès 1 note, C1 = Σ/8,5 dès les 4 notes (formules live), A4 paysage
// échelle 68 %, marges 0,3", en-têtes répétés (4:4), volets figés sous les
// en-têtes, zoom 85 %.
//
// Politique d'accès : production de fichiers réservée au Super Admin
// (canExportFiles — même règle anti-fuite que les autres exports).

import { saveBlob, XLSX_MIME } from "@/lib/doc-export";
import type { Cm2Round, Cm2SchoolGroup, Cm2StudentRow } from "@/lib/types";

// Les 13 libellés EXACTS demandés (ordre et casse respectés)
const HEADERS = [
  "matricule", "nom", "prenoms", "libecole", "codeecole", "libiep", "iep",
  "exploitation", "eveil", "orthographe", "math", "Total", "C1",
];
// Largeurs (caractères) identiques aux fichiers CP Task 82
const WIDTHS = [12, 34, 35, 34, 10, 11, 10, 11, 9, 11, 9, 9, 9];
const CENTERED = new Set([0, 4, 5, 6, 7, 8, 9, 10, 11, 12]); // tout sauf nom/prenoms/libecole

// Constantes IEP de la demande — partagées avec la vue écran (cm2-files-view.tsx)
// pour que le fichier Excel et le tableau à l'écran aient EXACTEMENT les
// mêmes libellés de colonnes (13 colonnes de la demande).
export const CM2_IEP_LIB = "DABOU 1";
export const CM2_IEP_CODE = "000045";
const IEP_LIB = CM2_IEP_LIB;
const IEP_CODE = CM2_IEP_CODE;

const BOX = {
  top: { style: "thin" as const, color: { argb: "FFB0B0B0" } },
  left: { style: "thin" as const, color: { argb: "FFB0B0B0" } },
  bottom: { style: "thin" as const, color: { argb: "FFB0B0B0" } },
  right: { style: "thin" as const, color: { argb: "FFB0B0B0" } },
};

function font(size: number, bold = false, argb?: string, italic = false) {
  return {
    name: "Arial",
    size,
    bold,
    italic,
    ...(argb ? { color: { argb } } : {}),
  };
}

function sanitize(name: string): string {
  return name.trim().replace(/\s+/g, "-").replace(/\//g, "-");
}

/** Base du nom de fichier : FICHIER-CM2-{SECTEUR}-S{composition}-{année}.xlsx */
export function cm2SecteurFileBase(round: Cm2Round, secteurName: string): string {
  return `FICHIER-CM2-${sanitize(secteurName)}-S${round.number}-${round.year}`;
}

export interface Cm2ExportInput {
  round: Cm2Round;
  secteurName: string;
  schools: Cm2SchoolGroup[];
}

/** Génère le fichier Excel du secteur (notes péremplies + formules Total/C1). */
export async function exportCm2SecteurExcel(
  input: Cm2ExportInput,
  filename: string,
): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";
  const ws = wb.addWorksheet("CM2", {
    views: [{ state: "frozen", ySplit: 4, zoomScale: 85, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      scale: 68,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printTitlesRow: "4:4",
    },
  });
  ws.columns = WIDTHS.map((w) => ({ width: w }));

  const totalStudents = input.schools.reduce((n, s) => n + s.students.length, 0);

  // --- 3 lignes de titres fusionnées A:M ---
  const titles = [
    {
      text: `FICHIER SECTEUR ${input.secteurName} — ÉLÈVES DE CM2`,
      size: 14, bold: true, color: undefined as string | undefined, italic: false,
    },
    {
      text: `IEP ${IEP_LIB} — CODE IEP : ${IEP_CODE} — ANNÉE SCOLAIRE ${input.round.year}-${input.round.year + 1}`,
      size: 11, bold: true, color: "FF00734A", italic: false,
    },
    {
      text: `COMPOSITION N°${input.round.number} — notes issues du module Évaluations — C1 = (exploitation + eveil + orthographe + math) / 8,5`,
      size: 10, bold: false, color: "FF555555", italic: true,
    },
  ];
  titles.forEach((t, i) => {
    const row = i + 1;
    ws.mergeCells(row, 1, row, 13);
    const c = ws.getCell(row, 1);
    c.value = t.text;
    c.font = font(t.size, t.bold, t.color, t.italic);
    c.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(row).height = i === 0 ? 22 : i === 1 ? 16 : 14;
  });

  // --- ligne d'en-têtes (row 4) — fond sombre, blanc gras ---
  const headerRow = ws.getRow(4);
  headerRow.height = 18;
  HEADERS.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = font(10, true, "FFFFFFFF");
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF404040" } };
    c.border = BOX;
    c.alignment = { horizontal: "center", vertical: "middle" };
  });

  // --- bandeaux par école + lignes élèves (notes péremplies) ---
  let r = 5;
  for (const school of input.schools) {
    ws.mergeCells(r, 1, r, 13);
    const band = ws.getCell(r, 1);
    band.value = `ECOLE : ${school.school_name} — CODE : ${school.school_code} — ${school.students.length} élève(s)`;
    band.font = font(10, true);
    band.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    band.alignment = { horizontal: "left", vertical: "middle" };
    ws.getRow(r).height = 16;
    for (let col = 1; col <= 13; col++) {
      const c = ws.getCell(r, col);
      c.border = BOX;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    }
    r += 1;

    for (const st of school.students) {
      writeStudentRow(ws, r, st, school);
      r += 1;
    }
  }
  void totalStudents;

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: XLSX_MIME }), filename);
}

/** Une ligne élève : 7 colonnes identité (avec iep/libiep fixes), 4 notes,
 *  Total et C1 en formules live (SOMME dès 1 note, Σ/8,5 dès 4 notes). */
function writeStudentRow(
  ws: import("exceljs").Worksheet,
  r: number,
  st: Cm2StudentRow,
  school: Cm2SchoolGroup,
): void {
  const identity: (string | number | null)[] = [
    st.matricule ?? null,
    st.nom,
    st.prenoms,
    school.school_name,
    school.school_code,
    IEP_LIB,
    IEP_CODE,
  ];
  const notes: (number | null)[] = [
    st.note_exploitation, st.note_eveil, st.note_orthographe, st.note_math,
  ];

  identity.forEach((v, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = v ?? "";
    c.font = font(10);
    c.border = BOX;
    c.alignment = { horizontal: CENTERED.has(i) ? "center" : "left", vertical: "middle" };
  });
  // colonnes texte sensibles : matricule (A), codeecole (E), iep (G) en
  // format texte pour préserver les zéros initiaux
  ws.getCell(r, 1).numFmt = "@";
  ws.getCell(r, 5).numFmt = "@";
  ws.getCell(r, 7).numFmt = "@";

  notes.forEach((v, i) => {
    const c = ws.getCell(r, 8 + i);
    c.value = v ?? "";
    c.font = font(10);
    c.border = BOX;
    c.alignment = { horizontal: "center", vertical: "middle" };
  });

  // Total (L) : somme dès qu'au moins une note est saisie
  const total = ws.getCell(r, 12);
  total.value = `=IF(COUNT(H${r}:K${r})=0,"",SUM(H${r}:K${r}))`;
  total.font = font(10, true);
  total.border = BOX;
  total.alignment = { horizontal: "center", vertical: "middle" };
  // C1 (M) : Σ / 8,5 dès que les 4 notes sont saisies
  const c1 = ws.getCell(r, 13);
  c1.value = `=IF(COUNT(H${r}:K${r})=4,SUM(H${r}:K${r})/8.5,"")`;
  c1.font = font(10, true);
  c1.border = BOX;
  c1.alignment = { horizontal: "center", vertical: "middle" };
  c1.numFmt = "0.00";
  ws.getRow(r).height = 16;
}
