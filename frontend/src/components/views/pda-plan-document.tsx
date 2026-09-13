"use client";

// === PDA IEPP — Document réseau « PLAN D'ACTION PLURIANNUEL DE L'IEPP » ===
// Reproduction FIDÈLE de l'architecture du document officiel reçu de
// l'IEPP (SUIVI PLURIANNUEL_1..4, 4 pages A4 paysage) : les écoles y sont
// GROUPÉES PAR CENTRE D'EXAMEN, ligne TOTAL de l'inspection en bas.
//
// Architecture du modèle reçu :
//   - En-tête institutionnel (bloc ministériel + République + armoiries)
//   - Boîte jaune de l'évaluation : « EXAMEN BLANC N°1 DU 13/03/2025 »
//   - Bandeau jaune pleine largeur : « PLAN D'ACTION PLURIANNUEL DE
//     L'IEPP DABOU-1 »
//   - Section A (pages 1-2) : NOMBRE D'ELEVES DU CM2 AYANT ATTEINT LE
//     SEUIL SUFFISANT DE MAÎTRISE EN LECTURE (EXPLOITATION DE TEXTE),
//     MATHEMATIQUES. Colonnes par discipline : Total | Filles |
//     Présents (admis) | % Admis | Admis (Filles) | % Admis (Filles).
//   - Section B (pages 3-4, NOUVELLE PAGE) : ACCROÎTRE LES ACQUIS
//     SCOLAIRES… — 3 indicateurs × (TOTAL | FILLES), bande grise sur la
//     ligne d'entête CENTRE/ECOLES (comme le modèle).
//   - PAS de sous-totaux par centre (le modèle n'en a pas : uniquement
//     les lignes écoles + la ligne TOTAL finale, fond gris, en gras) et
//     PAS de répétition des entêtes sur les pages suivantes (le modèle
//     poursuit les lignes directement).
//   - Bordures « Excel » : cadre épais, séparations de groupes épaisses,
//     filets intérieurs fins. Effectifs zéro-padés (07), « 00 » pour les
//     zéros calculés ou saisis, cases vides sans données (les #DIV/0! du
//     modèle), % à 2 décimales (89,26%), encre noire, Calibri (Carlito).
//   - Aucune signature sur le document reçu (il s'achève sur le TOTAL).
//
// CALCULS (directives IEPP, formules vérifiées sur la ligne TOTAL du
// modèle : 1105/1238 = 89,26% ; 579/622 = 93,09%) :
//   - « Présents (admis) » = les ADMIS de la discipline : élèves présents
//     ayant atteint le seuil de maîtrise (les non admis = présents
//     évalués − admis alimentent les difficultés de la section B).
//   - % Admis          = Admis / Inscrits
//   - % Admis (Filles) = Admises / Filles inscrites
//   Chaque pourcentage imprimé est donc recalculable depuis les colonnes
//   visibles — les admis et les non admis de chaque colonne sont calculés.
//   - Périmètre : seules les écoles rattachées à un CENTRE D'EXAMEN
//     figurent dans le document (directive IEPP) ; les écoles sans centre
//     sont signalées à l'écran uniquement (jamais imprimées).
//
// PAGINATION (directive IEPP : le plan tient sur 4 pages A4 paysage) :
//   - lignes compactes (9px, entêtes non répétées, saut de ligne évité
//     dans les tr) ;
//   - saut de page AVANT la section B (pages 1-2 = section A, pages 3-4
//     = section B, comme le document reçu).
//
// v3 — EMBELLISSEMENT DRAPEAU CI (inspiré des bulletins individuels) :
// les anciens JAUNES deviennent ORANGE/VERT DRAPEAU (bandeau du titre en
// vert drapeau texte blanc, boîte de l'évaluation en orange drapeau),
// toutes les bordures passent au VERT DRAPEAU, entêtes sur fond vert
// (texte blanc), lignes TOTAL sur fond pastel vert ; ARMOIRIES en
// filigrane (répétées à chaque page imprimée). Les rubans tricolores
// haut/bas sont RETIRÉS des feuilles imprimables (documents sans
// drapeaux sur les bordures).
//
// Toutes les données viennent de /api/pda/plan-action (source unique de
// vérité — le document ne recalcule rien). Impression 100 % navigateur
// A4 paysage (isolement #pda-plan-doc, page nommée pda-plan).
//
// v4 — 3 MODÈLES D'IMPRESSION (demande utilisateur : « étendre les 3
// modèles PDF / Word / Excel à tous les documents, en respectant les
// en-têtes d'origine ») : modèle WORD (.doc HTML MSO A4 paysage, sections
// A et B séparées par un saut de page) et modèle EXCEL (.xlsx exceljs)
// reproduisant l'en-tête institutionnel, les 2 sections et la ligne
// TOTAL. Aucune signature sur ce document (le modèle reçu s'achève sur
// le TOTAL).

import { Fragment, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";

import { pdaApi } from "@/lib/api";
import {
  DocExportButtons,
  XLSX_MIME,
  buildWordShell,
  escHtml,
  saveBlob,
  saveWordDoc,
  slugFile,
} from "@/lib/doc-export";
import {
  canPrintDocument,
  PrintLockBadge,
  PrintLockDocumentMessage,
  usePrintRole,
} from "@/lib/print-guard";
import { monthLabel } from "@/lib/session-utils";
import type {
  PdaPlanCenterGroup,
  PdaPlanDisciplineStats,
  PdaPlanSchoolRow,
} from "@/lib/types";

import {
  INK,
  OFFICIAL_FONT,
  OfficialDocHeader,
  fmtDocNum,
  fmtDocPct,
} from "./official-doc";
import {
  CIArmoiriesWatermark,
  CI_GREEN,
  CI_GREEN_BG,
  CI_GREEN_TEXT,
  CI_ORANGE,
  PRINT_COLOR_STYLE,
} from "@/components/ci-decor";

// v3 — bordures « Excel » du modèle, en VERT DRAPEAU (au lieu du noir) :
// cadre épais, séparations de groupes épaisses, filets intérieurs fins.
const THICK = `2px solid ${CI_GREEN}`;
const THIN = `1px solid ${CI_GREEN}`;
/** Fond des lignes TOTAL / bande d'entête — pastel vert drapeau. */
const TOTAL_BG = CI_GREEN_BG;

/** Effectif avec zéro CALCULÉ affiché « 00 » (zéros saisis du modèle
 *  reçu) — les cases sans donnée restent vides (fmtDocNum). */
function fmtNum0(n: number | undefined | null): string {
  if (n == null) return "";
  return n <= 0 ? "00" : fmtDocNum(n);
}

/** Pourcentage affiché même à zéro (« 0,00% ») dès que la case est
 *  calculée ; case vide seulement si aucune évaluation (#DIV/0!). */
function fmtPct0(n: number | undefined | null): string {
  if (n == null) return "";
  return `${n.toFixed(2).replace(".", ",")}%`;
}

const thBase: CSSProperties = {
  border: THIN,
  padding: "1px 3px",
  fontSize: "12px", // Task 37 — police d'écriture portée à 12
  lineHeight: 1.15,
  fontWeight: 400, // le modèle reçu : entêtes de colonnes en régulier
  textAlign: "center",
  verticalAlign: "middle",
  color: "#ffffff",
  background: CI_GREEN,
  ...PRINT_COLOR_STYLE,
};

const tdBase: CSSProperties = {
  border: THIN,
  padding: "0.5px 3px",
  fontSize: "12px", // Task 37 — police d'écriture portée à 12
  lineHeight: 1.15,
  textAlign: "center",
  color: INK,
};

const centreTd: CSSProperties = {
  ...tdBase,
  fontWeight: 700,
  verticalAlign: "middle",
  borderRight: THICK,
};

const schoolTd: CSSProperties = {
  ...tdBase,
  textAlign: "left",
  fontWeight: 700,
  whiteSpace: "nowrap",
  borderRight: THICK,
};

/** Les 14 cellules de données de la section A pour une ligne école.
 *  Ordre par discipline (Task 37) : Total | Filles (inscrits) |
 *  PRÉSENTS | ADMIS | % Admis | Admis (Filles) | % Admis (Filles).
 *  « Présents » = élèves évalués (au moins une note) ; « Admis » =
 *  présents ayant atteint le seuil ; les % suivent les formules du
 *  modèle (Admis/Inscrits). Une discipline non évaluée (aucune note)
 *  laisse ses 5 cases vides (#DIV/0! du modèle). Première colonne des
 *  MATHÉMATIQUES = séparation épaisse (modèle). */
function DisciplineCells({
  row,
  discipline,
}: {
  row: PdaPlanSchoolRow;
  discipline: "exploitation" | "math";
}) {
  const d: PdaPlanDisciplineStats | undefined = row.disciplines?.[discipline];
  const first = discipline === "math";
  // Trait épais UNIQUEMENT sur la 1re colonne du groupe MATHÉMATIQUES
  // (séparation entre disciplines) — filets fins à l'intérieur (modèle).
  const tdFirst = first ? { ...tdBase, borderLeft: THICK } : tdBase;
  const assessed = (d?.presents?.total ?? 0) > 0; // au moins une note saisie
  const inscrits = row.inscrits?.total ?? 0;
  const filles = row.inscrits?.filles ?? 0;
  return (
    <>
      <td style={tdFirst}>{fmtDocNum(inscrits)}</td>
      <td style={tdBase}>{fmtDocNum(filles)}</td>
      <td style={tdBase}>{assessed ? fmtNum0(d?.presents?.total) : ""}</td>
      <td style={tdBase}>{assessed ? fmtNum0(d?.admis?.total) : ""}</td>
      <td style={tdBase}>{assessed && inscrits > 0 ? fmtPct0(d?.pct_admis) : ""}</td>
      <td style={tdBase}>{assessed ? fmtNum0(d?.admis?.filles) : ""}</td>
      <td style={tdBase}>
        {assessed && filles > 0 ? fmtPct0(d?.pct_admis_filles) : ""}
      </td>
    </>
  );
}

/** Les 14 cellules de données de la section A pour la ligne TOTAL
 *  (fond gris, gras — modèle reçu). Mêmes règles que les lignes écoles :
 *  Présents / Admis distincts, % = formules du modèle, cases vides si la
 *  discipline n'a été évaluée nulle part. */
function TotalRowCells({ row }: { row: PdaPlanSchoolRow }) {
  const bold: CSSProperties = { ...tdBase, fontWeight: 700, background: TOTAL_BG, color: CI_GREEN_TEXT };
  const boldMath: CSSProperties = { ...bold, borderLeft: THICK };
  const pct = (disc: "exploitation" | "math", byFilles: boolean) => {
    const d = row.disciplines?.[disc];
    const assessed = (d?.presents?.total ?? 0) > 0;
    const denom = byFilles
      ? (row.inscrits?.filles ?? 0)
      : (row.inscrits?.total ?? 0);
    return assessed && denom > 0
      ? fmtPct0(byFilles ? d?.pct_admis_filles : d?.pct_admis)
      : "";
  };
  const admis = (disc: "exploitation" | "math", byFilles: boolean) => {
    const d = row.disciplines?.[disc];
    const assessed = (d?.presents?.total ?? 0) > 0;
    return assessed ? fmtNum0(byFilles ? d?.admis?.filles : d?.admis?.total) : "";
  };
  const presents = (disc: "exploitation" | "math") => {
    const d = row.disciplines?.[disc];
    const assessed = (d?.presents?.total ?? 0) > 0;
    return assessed ? fmtNum0(d?.presents?.total) : "";
  };
  return (
    <>
      <td style={bold}>{fmtDocNum(row.inscrits?.total)}</td>
      <td style={bold}>{fmtDocNum(row.inscrits?.filles)}</td>
      <td style={bold}>{presents("exploitation")}</td>
      <td style={bold}>{admis("exploitation", false)}</td>
      <td style={bold}>{pct("exploitation", false)}</td>
      <td style={bold}>{admis("exploitation", true)}</td>
      <td style={bold}>{pct("exploitation", true)}</td>
      <td style={boldMath}>{fmtDocNum(row.inscrits?.total)}</td>
      <td style={bold}>{fmtDocNum(row.inscrits?.filles)}</td>
      <td style={boldMath}>{presents("math")}</td>
      <td style={boldMath}>{admis("math", false)}</td>
      <td style={bold}>{pct("math", false)}</td>
      <td style={bold}>{admis("math", true)}</td>
      <td style={bold}>{pct("math", true)}</td>
    </>
  );
}

// ============================================================ 3 MODÈLES ===

interface PlanExportData {
  evalTitle: string;
  iepName: string;
  iepRegion: string;
  iepBp: string;
  iepPhone: string;
  iepEmail: string;
  centers: PdaPlanCenterGroup[];
  grandTotal: PdaPlanSchoolRow;
  year: number;
  number: number;
  kind: string;
}

/** Les 7 valeurs formatées d'un groupe discipline (section A), dans
 *  l'ordre du modèle : Total | Filles | Présents | Admis | % Admis |
 *  Admis (Filles) | % Admis (Filles) — mêmes règles que DisciplineCells. */
function planDiscCells(
  row: PdaPlanSchoolRow,
  discipline: "exploitation" | "math",
): string[] {
  const d: PdaPlanDisciplineStats | undefined = row.disciplines?.[discipline];
  const assessed = (d?.presents?.total ?? 0) > 0;
  const inscrits = row.inscrits?.total ?? 0;
  const filles = row.inscrits?.filles ?? 0;
  return [
    fmtDocNum(inscrits),
    fmtDocNum(filles),
    assessed ? fmtNum0(d?.presents?.total) : "",
    assessed ? fmtNum0(d?.admis?.total) : "",
    assessed && inscrits > 0 ? fmtPct0(d?.pct_admis) : "",
    assessed ? fmtNum0(d?.admis?.filles) : "",
    assessed && filles > 0 ? fmtPct0(d?.pct_admis_filles) : "",
  ];
}

/** Les 6 valeurs formatées de la section B pour une ligne école :
 *  difficultés / mise à niveau / remédiation × (Total | Filles). */
function planSectionBCells(row: PdaPlanSchoolRow): string[] {
  const rem = (v: number | undefined) =>
    row.has_remediation ? fmtNum0(v) : fmtDocNum(v);
  return [
    row.has_data ? fmtNum0(row.difficultes?.total) : "",
    row.has_data ? fmtNum0(row.difficultes?.filles) : "",
    rem(row.mise_a_niveau?.total),
    rem(row.mise_a_niveau?.filles),
    rem(row.remediation?.total),
    rem(row.remediation?.filles),
  ];
}

/** Modèle WORD (.doc) — HTML MSO A4 PAYSAGE fidèle au document PDF :
 *  en-tête institutionnel, boîte de l'évaluation, bandeau titre, section
 *  A (tableau 16 colonnes groupé par centre), saut de page, section B,
 *  ligne TOTAL. Aucune signature (modèle reçu). */
function buildPlanWordHtml(o: PlanExportData): string {
  const esc = escHtml;
  const th =
    "border:1px solid #009E60; padding:1px 3px; font-size:11px; text-align:center; color:#fff; background:#009E60; line-height:1.15;";
  const thB =
    "border:2px solid #009E60; padding:1px 3px; font-size:11px; font-weight:bold; text-align:center; color:#fff; background:#009E60;";
  const td =
    "border:1px solid #009E60; padding:0.5px 3px; font-size:11px; text-align:center; line-height:1.15;";
  const tdc =
    `${td}; text-align:left; font-weight:bold; border-right:2px solid #009E60;`;
  const tds =
    `${td}; text-align:left; font-weight:bold; border-right:2px solid #009E60; white-space:nowrap;`;
  const tsum =
    `${td}; font-weight:bold; background:#E4F4ED; color:#00734A;`;

  // Section A : lignes écoles groupées par centre + TOTAL
  const rowsA = o.centers
    .map(
      (c) =>
        c.schools
          .map(
            (s, i) =>
              `<tr>` +
              (i === 0
                ? `<td style="${tdc}" rowspan=${c.schools.length}>${esc(c.name)}</td>`
                : "") +
              `<td style="${tds}">${esc(s.school_name)}</td>` +
              planDiscCells(s, "exploitation")
                .map((v) => `<td style="${td}">${v}</td>`)
                .join("") +
              planDiscCells(s, "math")
                .map((v) => `<td style="${td}">${v}</td>`)
                .join("") +
              `</tr>`,
          )
          .join(""),
    )
    .join("");
  const gtA = [
    ...planDiscCells(o.grandTotal, "exploitation"),
    ...planDiscCells(o.grandTotal, "math"),
  ]
    .map((v) => `<td style="${tsum}">${v}</td>`)
    .join("");

  // Section B : 3 indicateurs × (Total | Filles)
  const rowsB = o.centers
    .map(
      (c) =>
        c.schools
          .map(
            (s, i) =>
              `<tr>` +
              (i === 0
                ? `<td style="${tdc}" rowspan=${c.schools.length}>${esc(c.name)}</td>`
                : "") +
              `<td style="${tds}">${esc(s.school_name)}</td>` +
              planSectionBCells(s)
                .map((v) => `<td style="${td}">${v}</td>`)
                .join("") +
              `</tr>`,
          )
          .join(""),
    )
    .join("");
  const gtB = planSectionBCells(o.grandTotal)
    .map((v) => `<td style="${tsum}">${v}</td>`)
    .join("");

  const discSubHeaders = ["exploitation", "math"]
    .map((d, di) =>
      [
        `Total`,
        `Filles`,
        `Pr&eacute;sents`,
        `Admis`,
        `% Admis`,
        `Admis<br>(Filles)`,
        `% Admis (Filles)`,
      ]
        .map(
          (label, k) =>
            `<th style="${k === 0 && di === 1 ? thB.replace("border:1px", "border-left:2px solid #009E60; border-top:1px solid #009E60; border-right:1px solid #009E60; border-bottom:1px solid #009E60;") : thB}">${label}</th>`,
        )
        .join(""),
    )
    .join("");

  return buildWordShell({
    title: `Plan d'action pluriannuel ${o.year} N°${o.number}`,
    orientation: "landscape",
    marginMm: 6,
    styles: `
table.doc { border-collapse:collapse; width:100%; }
.titre-ev { display:inline-block; background:#F77F00; color:#fff; padding:3px 22px; font-size:12.5px; font-weight:bold; }
.bandeau { background:#009E60; color:#fff; text-align:center; padding:4px 8px; font-size:15px; font-weight:bold; width:82%; margin:0 auto 6px; }
p.section { font-size:12px; margin:4px 0 3px; font-weight:bold; color:#00734A; }
.sautpage { page-break-before:always; }
`,
    bodyHtml: `
<table style="border-collapse:collapse; width:100%;"><tr>
<td style="border:none; vertical-align:top; font-size:9.5px; line-height:1.32;">
<p>MINISTERE DE L'EDUCATION NATIONALE ET</p>
<p style="padding-left:6px;">DE L'ALPHABETISATION</p>
<p>DIRECTION REGIONALE DE ${esc((o.iepRegion || "…………").toUpperCase())}</p>
<p>INSPECTION DE L'ENSEIGNEMENT</p>
<p>PRESCOLAIRE ET PRIMAIRE DE ${esc((o.iepName || "…………").toUpperCase())}</p>
<p>BP ${esc(o.iepBp || "……")}&nbsp;&nbsp;&nbsp;T&eacute;l ${esc(o.iepPhone || "…………")}</p>
<p>Courriel : ${esc(o.iepEmail || "…………")}</p>
</td>
<td style="border:none; text-align:center; vertical-align:top; font-size:9.5px;">
<p>REPUBLIQUE DE C&Ocirc;TE D'IVOIRE</p>
<p>Union-Discipline-Travail</p>
</td>
</tr></table>
<p style="text-align:center; margin:1px 0 5px;"><span class=titre-ev>${esc(o.evalTitle)}</span></p>
<div class=bandeau>PLAN D'ACTION PLURIANNUEL DE L'IEPP ${esc((o.iepName || "…………").toUpperCase())}</div>
<p class=section>A) NOMBRE D'ELEVES DU CM2 AYANT ATTEINT LE SEUIL SUFFISANT DE MA&Icirc;TRISE EN LECTURE (EXPLOITATION DE TEXTE), MATHEMATIQUES.</p>
<table class=doc>
<tr><th style="${thB}; border-right:2px solid #009E60;" rowspan=3>CENTRES<br>D'EXAMENS</th><th style="${thB}; border-right:2px solid #009E60;" rowspan=3>ECOLES</th><th style="${thB}; border-bottom:2px solid #009E60;" colspan=14>DISCIPLINES</th></tr>
<tr><th style="${thB}; border-bottom:1px solid #009E60;" colspan=7>EXPLOITATION DE TEXTE</th><th style="${thB}; border-bottom:1px solid #009E60; border-left:2px solid #009E60;" colspan=7>MATHEMATIQUES</th></tr>
<tr>${discSubHeaders}</tr>
${rowsA}
<tr><td style="${tsum}; text-align:center;" colspan=2>TOTAL</td>${gtA}</tr>
</table>
<div class=sautpage></div>
<p class=section>B) ACCRO&Icirc;TRE LES ACQUIS SCOLAIRES ET LA PERFORMANCE AUX EXAMENS DES ELEVES DE TOUS LES NIVEAUX.</p>
<table class=doc>
<tr><th style="${thB};" colspan=2 rowspan=2></th><th style="${thB}" colspan=2>LE NOMBRE D'ELEVES EN DIFFICULTES D'APPRENTISSAGE</th><th style="${thB}; border-left:2px solid #009E60;" colspan=2>LE NOMBRE D'ELEVES AYANT BENEFICIE DES COURS DE MISE A NIVEAU</th><th style="${thB}; border-left:2px solid #009E60;" colspan=2>LE NOMBRE D'ELEVES AYANT BENEFICIE DES MECANISMES DE REMEDIATION PAR MATIERE</th></tr>
<tr>${["difficultes", "mise", "rem"].map((k, ki) => `<th style="${thB}">TOTAL</th><th style="${thB}">FILLES</th>`).join("")}</tr>
<tr><th style="${thB}; border-right:2px solid #009E60;">CENTRE</th><th style="${thB}; border-right:2px solid #009E60;">ECOLES</th><th style="${thB}" colspan=6>&nbsp;</th></tr>
${rowsB}
<tr><td style="${tsum}; text-align:center;" colspan=2>TOTAL</td>${gtB}</tr>
</table>
`,
  });
}

/** Modèle EXCEL (.xlsx) — classeur paysage (exceljs) : en-tête fusionné,
 *  section A (16 colonnes) puis section B (8 colonnes), TOTAL en gras. */
async function exportPlanExcelAsync(o: PlanExportData): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";
  const ws = wb.addWorksheet("Plan d'action", {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = [22, 30, ...Array.from({ length: 14 }, () => 8)].map((width) => ({ width }));
  const font = (size: number, bold = false, argb?: string, italic = false) => ({
    name: "Arial",
    size,
    bold,
    italic,
    ...(argb ? { color: { argb } } : {}),
  });
  const GREEN = { argb: "FF009E60" };
  const PASTEL = { argb: "FFE4F4ED" };
  const GREEN_TXT = { argb: "FF00734A" };
  const thin = { style: "thin" as const, color: { argb: "FF009E60" } };
  const thick = { style: "medium" as const, color: { argb: "FF009E60" } };
  const BOX = { top: thin, left: thin, bottom: thin, right: thin };
  const merged = (row: number, text: string, size: number, bold = false, italic = false) => {
    ws.mergeCells(row, 1, row, 16);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = font(size, bold, undefined, italic);
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  };

  merged(1, "MINISTERE DE L'EDUCATION NATIONALE ET DE L'ALPHABETISATION", 11, true);
  merged(2, `DIRECTION REGIONALE DE ${(o.iepRegion || "…………").toUpperCase()} — INSPECTION DE L'ENSEIGNEMENT PRESCOLAIRE ET PRIMAIRE DE ${(o.iepName || "…………").toUpperCase()}`, 10, true, true);
  merged(3, `BP ${o.iepBp || "……"}   Tél ${o.iepPhone || "…………"}   Courriel : ${o.iepEmail || "…………"}`, 10);
  merged(4, "REPUBLIQUE DE CÔTE D'IVOIRE — Union-Discipline-Travail", 10, true);
  merged(5, o.evalTitle, 12, true);
  merged(6, `PLAN D'ACTION PLURIANNUEL DE L'IEPP ${(o.iepName || "…………").toUpperCase()}`, 13, true);
  merged(7, "A) NOMBRE D'ELEVES DU CM2 AYANT ATTEINT LE SEUIL SUFFISANT DE MAÎTRISE EN LECTURE (EXPLOITATION DE TEXTE), MATHEMATIQUES.", 10, true, false);
  ws.getRow(7).alignment = { horizontal: "left", vertical: "middle" };

  // Entêtes section A (rangées 8-10)
  ws.mergeCells(8, 1, 10, 1);
  ws.getCell(8, 1).value = "CENTRES D'EXAMENS";
  ws.mergeCells(8, 2, 10, 2);
  ws.getCell(8, 2).value = "ECOLES";
  ws.mergeCells(8, 3, 8, 16);
  ws.getCell(8, 3).value = "DISCIPLINES";
  ws.mergeCells(9, 3, 9, 9);
  ws.getCell(9, 3).value = "EXPLOITATION DE TEXTE";
  ws.mergeCells(9, 10, 9, 16);
  ws.getCell(9, 10).value = "MATHEMATIQUES";
  const subHeads = ["Total", "Filles", "Présents", "Admis", "% Admis", "Admis (Filles)", "% Admis (Filles)"];
  subHeads.forEach((label, k) => {
    ws.getCell(10, 3 + k).value = label;
    ws.getCell(10, 10 + k).value = label;
  });
  for (let r = 8; r <= 10; r++) {
    const row = ws.getRow(r);
    row.height = r === 10 ? 24 : 16;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = font(9, r < 10, "FFFFFFFF");
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = BOX;
      c.fill = { type: "pattern", pattern: "solid", fgColor: GREEN };
    });
  }

  // Lignes écoles + TOTAL (section A)
  let r = 11;
  for (const c of o.centers) {
    for (let i = 0; i < c.schools.length; i++) {
      const s = c.schools[i];
      const row = ws.getRow(r);
      row.height = 15;
      if (i === 0) {
        ws.mergeCells(r, 1, r + c.schools.length - 1, 1);
        const cc = ws.getCell(r, 1);
        cc.value = c.name;
        cc.font = font(9, true);
        cc.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cc.border = BOX;
      }
      const ecole = ws.getCell(r, 2);
      ecole.value = s.school_name;
      ecole.font = font(9, true);
      ecole.alignment = { horizontal: "left", vertical: "middle" };
      ecole.border = BOX;
      const cells = [...planDiscCells(s, "exploitation"), ...planDiscCells(s, "math")];
      cells.forEach((v, k) => {
        const cell = ws.getCell(r, 3 + k);
        cell.value = v === "" ? "" : v;
        cell.font = font(9);
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = BOX;
      });
      r++;
    }
  }
  // TOTAL section A
  const gtRow = ws.getRow(r);
  ws.mergeCells(r, 1, r, 2);
  const gt = ws.getCell(r, 1);
  gt.value = "TOTAL";
  const gtCells = [...planDiscCells(o.grandTotal, "exploitation"), ...planDiscCells(o.grandTotal, "math")];
  gtCells.forEach((v, k) => {
    const cell = ws.getCell(r, 3 + k);
    cell.value = v;
  });
  gtRow.eachCell({ includeEmpty: true }, (c) => {
    c.font = font(9, true, "FF00734A");
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = BOX;
    c.fill = { type: "pattern", pattern: "solid", fgColor: PASTEL };
  });
  ws.getCell(r, 1).alignment = { horizontal: "center", vertical: "middle" };
  r += 2;

  // Section B (rangées suivantes)
  merged(r, "B) ACCROÎTRE LES ACQUIS SCOLAIRES ET LA PERFORMANCE AUX EXAMENS DES ELEVES DE TOUS LES NIVEAUX.", 10, true);
  ws.getRow(r).alignment = { horizontal: "left", vertical: "middle" };
  r += 1;
  const bHead = r;
  ws.mergeCells(bHead, 1, bHead + 1, 2);
  ws.getCell(bHead, 1).value = "CENTRE / ECOLES";
  const bLabels = [
    ["LE NOMBRE D'ELEVES EN DIFFICULTES D'APPRENTISSAGE", "difficultés"],
    ["COURS DE MISE A NIVEAU", "mise"],
    ["MECANISMES DE REMEDIATION", "remédiation"],
  ] as const;
  bLabels.forEach(([, label], k) => {
    ws.mergeCells(bHead, 3 + k * 2, bHead, 4 + k * 2);
    ws.getCell(bHead, 3 + k * 2).value = label;
    ws.getCell(bHead + 1, 3 + k * 2).value = "TOTAL";
    ws.getCell(bHead + 1, 4 + k * 2).value = "FILLES";
  });
  for (let rr = bHead; rr <= bHead + 1; rr++) {
    const row = ws.getRow(rr);
    row.height = rr === bHead ? 26 : 15;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = font(9, rr === bHead, "FFFFFFFF");
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = BOX;
      c.fill = { type: "pattern", pattern: "solid", fgColor: GREEN };
    });
  }
  r = bHead + 2;
  for (const c of o.centers) {
    for (let i = 0; i < c.schools.length; i++) {
      const s = c.schools[i];
      if (i === 0) {
        ws.mergeCells(r, 1, r + c.schools.length - 1, 1);
        const cc = ws.getCell(r, 1);
        cc.value = c.name;
        cc.font = font(9, true);
        cc.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cc.border = BOX;
      }
      const ecole = ws.getCell(r, 2);
      ecole.value = s.school_name;
      ecole.font = font(9, true);
      ecole.alignment = { horizontal: "left", vertical: "middle" };
      ecole.border = BOX;
      planSectionBCells(s).forEach((v, k) => {
        const cell = ws.getCell(r, 3 + k);
        cell.value = v;
        cell.font = font(9);
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = BOX;
      });
      r++;
    }
  }
  // TOTAL section B
  ws.mergeCells(r, 1, r, 2);
  const gtB = ws.getCell(r, 1);
  gtB.value = "TOTAL";
  planSectionBCells(o.grandTotal).forEach((v, k) => {
    ws.getCell(r, 3 + k).value = v;
  });
  for (let col = 1; col <= 8; col++) {
    const cell = ws.getCell(r, col);
    cell.font = font(9, true, "FF00734A");
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BOX;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: PASTEL };
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: XLSX_MIME }),
    `plan-action-${slugFile(o.iepName)}-${o.year}-n${o.number}.xlsx`,
  );
}

export function PdaPlanDocument({
  year,
  number,
  kind,
  onClose,
}: {
  year: number;
  number: number;
  kind: "blanc" | "composition";
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pda-plan-action", year, number, kind],
    queryFn: () => pdaApi.getPlanAction({ year, number, kind }),
  });

  // Task 23 — verrou d'impression : consultation à l'écran ouverte aux
  // rôles autorisés par le backend, mais la zone « Imprimer / PDF » est
  // GRISÉE (l'impression reste réservée à l'Admin IEP et au Super Admin).
  const printRole = usePrintRole();
  const canPrint = canPrintDocument(printRole, false);
  // État des exports Word/Excel (DOIT rester avant les retours conditionnels
  // — règles des Hooks React).
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Préparation du document…
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            {(error as Error)?.message ?? "Document indisponible"}
          </p>
          <button onClick={onClose} className="px-3 py-1.5 bg-gray-200 rounded-md text-sm">
            Retour
          </button>
        </div>
      </div>
    );
  }

  const plan = data;
  const centers: PdaPlanCenterGroup[] = plan.centers ?? [];
  const iep = plan.iep;
  const isComposition = plan.kind === "composition";

  // Boîte jaune de l'évaluation — format du modèle reçu :
  // « EXAMEN BLANC N°1 DU 13/03/2025 ».
  const evalTitle = isComposition
    ? `COMPOSITION N°${plan.number} — ${
        plan.session_month && plan.session_month >= 1 && plan.session_month <= 12
          ? `${monthLabel(plan.session_month)} `
          : ""
      }${plan.year}`
    : `EXAMEN BLANC N°${plan.number}${
        plan.exam_date
          ? ` DU ${new Date(plan.exam_date).toLocaleDateString("fr-FR")}`
          : ` — ANNEE ${plan.year}`
      }`;

  const toolbarTitle = isComposition
    ? `Composition N°${plan.number} — ${plan.year}`
    : `Examen Blanc N°${plan.number}`;

  const totalSchoolCount = centers.reduce((acc, c) => acc + c.schools.length, 0);

  // === 3 MODÈLES : données partagées Word/Excel ===
  const exportData: PlanExportData = {
    evalTitle,
    iepName: iep?.name ?? "",
    iepRegion: iep?.region ?? "",
    iepBp: iep?.bp ?? "",
    iepPhone: iep?.inspector_phone ?? "",
    iepEmail: iep?.inspector_email ?? "",
    centers,
    grandTotal: plan.grand_total,
    year: plan.year,
    number: plan.number,
    kind: plan.kind,
  };

  function handleWord() {
    setExporting("doc");
    try {
      saveWordDoc(
        buildPlanWordHtml(exportData),
        `plan-action-${slugFile(exportData.iepName)}-${exportData.year}-n${exportData.number}.doc`,
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleExcel() {
    setExporting("xlsx");
    try {
      await exportPlanExcelAsync(exportData);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white print:min-h-0">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Plan d&apos;Action IEPP — {toolbarTitle} · {totalSchoolCount} école(s)
          avec centre d&apos;examen
        </h3>
        <div className="flex items-center gap-2">
          {canPrint ? (
            <DocExportButtons
              canPrint
              exporting={exporting}
              onPdf={() => window.print()}
              onWord={handleWord}
              onExcel={handleExcel}
              formatHint="Format : A4 paysage"
            />
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

      {/* === DOCUMENT OFFICIEL (isolement impression #pda-plan-doc) === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="pda-plan-doc"
        className={`bg-white mx-auto shadow-lg print:shadow-none mt-3 ${canPrint ? "" : "print-locked"}`}
        style={{
          width: "100%",
          maxWidth: "297mm", // A4 paysage — le tableau réseau est large
          padding: "6mm 8mm",
          fontFamily: OFFICIAL_FONT,
          color: INK,
          overflowX: "auto",
          position: "relative", // filigrane armoiries DANS LE FOND
        }}
      >
        {/* v3 — ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane (répétées sur
            chaque page imprimée). Rubans tricolores haut/bas RETIRÉS :
            aucune bordure drapeau sur les feuilles imprimables. */}
        <CIArmoiriesWatermark fixed />
        <div style={{ position: "relative", zIndex: 1 }}>
        {/* --- En-tête institutionnel compact (modèle reçu) --- */}
        <OfficialDocHeader iep={iep} variant="plan" size="xs" />

        {/* --- Boîte de l'évaluation — ORANGE DRAPEAU (texte blanc) --- */}
        <div style={{ textAlign: "center", margin: "1px 0 5px" }}>
          <span
            style={{
              display: "inline-block",
              background: CI_ORANGE,
              color: "#ffffff",
              padding: "3px 22px",
              fontSize: "12.5px",
              fontWeight: 700,
              ...PRINT_COLOR_STYLE,
            }}
          >
            {evalTitle}
          </span>
        </div>

        {/* --- Bandeau du titre — VERT DRAPEAU (texte blanc — inspiration
            bulletins individuels) --- */}
        <div
          style={{
            background: CI_GREEN,
            color: "#ffffff",
            textAlign: "center",
            padding: "4px 8px",
            fontSize: "15px",
            fontWeight: 700,
            width: "82%",
            margin: "0 auto 6px",
            ...PRINT_COLOR_STYLE,
          }}
        >
          PLAN D&apos;ACTION PLURIANNUEL DE L&apos;IEPP{" "}
          {(iep?.name || "…………").toUpperCase()}
        </div>

        {/* ================= SECTION A (pages 1-2) ================= */}
        <p style={{ fontSize: "12px", margin: "4px 0 3px", fontWeight: 700, color: CI_GREEN_TEXT }}>
          A) NOMBRE D&apos;ELEVES DU CM2 AYANT ATTEINT LE SEUIL SUFFISANT DE
          MAÎTRISE EN LECTURE (EXPLOITATION DE TEXTE), MATHEMATIQUES.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", border: THICK }}>
          <thead>
            {/* Ligne 1 : CENTRES | ECOLES | DISCIPLINES (2 × 6 colonnes).
                rowSpan=3 : l'en-tête comporte 3 lignes. À l'impression la
                thead n'est PAS répétée (le modèle poursuit les lignes). */}
            <tr>
              <th style={{ ...thBase, fontWeight: 700, borderRight: THICK }} rowSpan={3}>
                CENTRES
                <br />
                D&apos;EXAMENS
              </th>
              <th style={{ ...thBase, fontWeight: 700, borderRight: THICK, width: "120px" }} rowSpan={3}>
                ECOLES
              </th>
              <th colSpan={14} style={{ ...thBase, borderBottom: THICK }}>
                DISCIPLINES
              </th>
            </tr>
            <tr>
              <th colSpan={7} style={{ ...thBase, borderBottom: THIN }}>
                EXPLOITATION DE TEXTE
              </th>
              <th colSpan={7} style={{ ...thBase, borderBottom: THIN, borderLeft: THICK }}>
                MATHEMATIQUES
              </th>
            </tr>
            {/* Ligne 3 : sous-entêtes — Total | Filles | Présents | Admis |
                % Admis | Admis (Filles) | % Admis (Filles), par discipline
                (Total/Filles = effectifs INSCRITS ; Présents/Admis distincts
                — Task 37). */}
            <tr>
              {["exploitation", "math"].map((d, di) => (
                <Fragment key={d}>
                  <th style={di === 1 ? { ...thBase, borderLeft: THICK } : thBase}>Total</th>
                  <th style={thBase}>Filles</th>
                  <th style={thBase}>Présents</th>
                  <th style={thBase}>Admis</th>
                  <th style={thBase}>% Admis</th>
                  <th style={thBase}>
                    Admis
                    <br />
                    (Filles)
                  </th>
                  <th style={thBase}>% Admis (Filles)</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {centers.map((c) => (
              <Fragment key={c.id || "sans-centre-a"}>
                {/* PAS de sous-totaux par centre — le modèle reçu n'en a
                    pas : uniquement les lignes écoles. Les écoles sans
                    centre d'examen n'arrivent pas ici (exclues côté API). */}
                {c.schools.map((s) => (
                  <tr key={s.school_id}>
                    {s === c.schools[0] && (
                      <td style={centreTd} rowSpan={c.schools.length} title={c.name}>
                        {c.name}
                      </td>
                    )}
                    <td style={schoolTd}>{s.school_name}</td>
                    <DisciplineCells row={s} discipline="exploitation" />
                    <DisciplineCells row={s} discipline="math" />
                  </tr>
                ))}
              </Fragment>
            ))}
            {/* TOTAL général de l'IEPP (fond gris, gras — modèle reçu) */}
            <tr>
              <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700, textAlign: "center" }} colSpan={2}>
                TOTAL
              </td>
              <TotalRowCells row={plan.grand_total} />
            </tr>
          </tbody>
        </table>

        {/* ============ SECTION B (pages 3-4 — NOUVELLE PAGE) ============ */}
        <div style={{ breakBefore: "page", pageBreakBefore: "always" }}>
          <p style={{ fontSize: "12px", margin: "4px 0 3px", fontWeight: 700, color: CI_GREEN_TEXT }}>
            B) ACCROÎTRE LES ACQUIS SCOLAIRES ET LA PERFORMANCE AUX EXAMENS
            DES ELEVES DE TOUS LES NIVEAUX.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", border: THICK }}>
            <thead>
              {/* Entête du modèle reçu : les 3 indicateurs sur 2 lignes,
                  puis la ligne CENTRE/ECOLES alignée sur la bande grise. */}
              <tr>
                <th style={{ ...thBase, borderRight: THIN }} colSpan={2} rowSpan={2} />
                <th colSpan={2} style={thBase}>
                  LE NOMBRE D&apos;ELEVES EN DIFFICULTES D&apos;APPRENTISSAGE
                </th>
                <th colSpan={2} style={{ ...thBase, borderLeft: THICK }}>
                  LE NOMBRE D&apos;ELEVES AYANT BENEFICIE DES COURS DE MISE A
                  NIVEAU (voir liste des élèves et les notes avant et après)
                </th>
                <th colSpan={2} style={{ ...thBase, borderLeft: THICK }}>
                  LE NOMBRE D&apos;ELEVES AYANT BENEFICIE DES MECANISMES DE
                  REMEDIATION PAR MATIERE
                </th>
              </tr>
              <tr>
                {["difficultes", "mise_a_niveau", "remediation"].map((k, ki) => (
                  <Fragment key={k}>
                    <th style={ki > 0 ? { ...thBase, borderLeft: THICK } : thBase}>TOTAL</th>
                    <th style={thBase}>FILLES</th>
                  </Fragment>
                ))}
              </tr>
              {/* Ligne CENTRE/ECOLES + bande grise (modèle reçu) */}
              <tr>
                <th style={{ ...thBase, fontWeight: 700, borderRight: THICK, width: "80px" }}>
                  CENTRE
                </th>
                <th style={{ ...thBase, fontWeight: 700, borderRight: THICK, width: "120px" }}>
                  ECOLES
                </th>
                <th colSpan={6} style={{ ...thBase, background: TOTAL_BG, height: "12px", padding: 0, borderLeft: THIN, borderRight: THIN }} />
              </tr>
            </thead>
            <tbody>
              {centers.map((c) => (
                <Fragment key={c.id || "sans-centre-b"}>
                  {c.schools.map((s) => (
                    <tr key={s.school_id}>
                      {s === c.schools[0] && (
                        <td style={centreTd} rowSpan={c.schools.length} title={c.name}>
                          {c.name}
                        </td>
                      )}
                      <td style={schoolTd}>{s.school_name}</td>
                      {/* Difficultés d'apprentissage : CALCULÉES (présents
                          non admis aux 3 matières) — « 00 » dès que
                          l'évaluation a eu lieu, vide sinon (modèle). */}
                      <td style={tdBase}>
                        {s.has_data ? fmtNum0(s.difficultes?.total) : ""}
                      </td>
                      <td style={tdBase}>
                        {s.has_data ? fmtNum0(s.difficultes?.filles) : ""}
                      </td>
                      {/* Mise à niveau / remédiation : saisies — « 00 »
                          uniquement si l'école a réellement enregistré
                          (has_remediation), case vide sinon (modèle :
                          PETIT-BADIEN 00 vs BONN vide). */}
                      <td style={{ ...tdBase, borderLeft: THICK }}>
                        {s.has_remediation
                          ? fmtNum0(s.mise_a_niveau?.total)
                          : fmtDocNum(s.mise_a_niveau?.total)}
                      </td>
                      <td style={tdBase}>
                        {s.has_remediation
                          ? fmtNum0(s.mise_a_niveau?.filles)
                          : fmtDocNum(s.mise_a_niveau?.filles)}
                      </td>
                      <td style={{ ...tdBase, borderLeft: THICK }}>
                        {s.has_remediation
                          ? fmtNum0(s.remediation?.total)
                          : fmtDocNum(s.remediation?.total)}
                      </td>
                      <td style={tdBase}>
                        {s.has_remediation
                          ? fmtNum0(s.remediation?.filles)
                          : fmtDocNum(s.remediation?.filles)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }} colSpan={2}>
                  TOTAL
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                  {plan.grand_total?.has_data
                    ? fmtNum0(plan.grand_total?.difficultes?.total)
                    : ""}
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                  {plan.grand_total?.has_data
                    ? fmtNum0(plan.grand_total?.difficultes?.filles)
                    : ""}
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700, borderLeft: THICK }}>
                  {plan.grand_total?.has_remediation
                    ? fmtNum0(plan.grand_total?.mise_a_niveau?.total)
                    : fmtDocNum(plan.grand_total?.mise_a_niveau?.total)}
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                  {plan.grand_total?.has_remediation
                    ? fmtNum0(plan.grand_total?.mise_a_niveau?.filles)
                    : fmtDocNum(plan.grand_total?.mise_a_niveau?.filles)}
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700, borderLeft: THICK }}>
                  {plan.grand_total?.has_remediation
                    ? fmtNum0(plan.grand_total?.remediation?.total)
                    : fmtDocNum(plan.grand_total?.remediation?.total)}
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                  {plan.grand_total?.has_remediation
                    ? fmtNum0(plan.grand_total?.remediation?.filles)
                    : fmtDocNum(plan.grand_total?.remediation?.filles)}
                </td>
              </tr>
            </tbody>
          </table>
          {/* Le document reçu s'achève sur la ligne TOTAL — aucune signature. */}
        </div>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground py-4 print:hidden">
        Sections A (pages 1-2) et B (pages 3-4) du plan groupées par centre
        d&apos;examen — architecture, en-tête et police (Calibri) du document
        officiel reçu. Calculs : « Présents (admis) » = élèves ayant atteint le
        seuil ; % Admis = Admis / Inscrits ; % Admis (Filles) = Admises /
        Filles inscrites (formules du modèle) ; difficultés = présents non
        admis aux 3 matières. Les écoles sans centre d&apos;examen sont
        exclues (rattachement dans le module Écoles).
      </p>
    </div>
  );
}
