"use client";

// === Document officiel « RESULTATS DE FIN D'ANNEE » (modèle IEPP) ===
// Reproduction fidèle de l'architecture du document reçu (A4 PORTRAIT).
// Historique : en-tête institutionnel + boîte du titre arrondie + lignes
// ECOLE / Cours / Date + tableau 11 colonnes (N° | Nom et Prénoms | Âge |
// Scolarité dans le cours | Scolarité totale | Moyenne des compositions |
// Moyenne de la composition de passage | Moyenne annuelle | Décision du
// Conseil des Maîtres : Admis / Red / Abd) + tableau récapitulatif du bas
// (Effectif / Admis / Redoublants calculés, Exclus / Abandons saisis) +
// « Fait à DABOU » + signatures Le Directeur / Le tenant du cours / Visa
// de l'Inspecteur (noms en caractère d'imprimerie — Task 37) ; noms des
// FILLES en rouge ; ARIAL 12 (v4) ; entêtes horizontaux + nom du tenant
// (v5) ; embellissement drapeau CI (v3).
//
// v6 — PAGINATION ADAPTÉE À L'EFFECTIF + 3 MODÈLES D'IMPRESSION
// (demande utilisateur : « dans le module résultat, fin d'année, document
// officiel, résultat de fin d'année, il faut adapter les pages à imprimer
// par rapport aux nombres d'élèves » + « étendre les 3 modèles (PDF,
// Word, Excel) à tous les documents, en respectant les en-têtes d'origine ») :
//   1) ANCIEN comportement : 72 lignes numérotées FIXES (modèle papier) —
//      une classe de 12 élèves imprimait ~60 lignes vides et poussait le
//      récapitulatif + les signatures sur des pages dénuées d'en-tête ;
//      une classe de 50 élèves débordait sans entête répété. NOUVEAU :
//      pagination à BUDGET DE HAUTEUR (même discipline que la liste des
//      candidats) — page 1 (en-tête institutionnel déduit), pages
//      intermédiaires (entêtes du tableau répétés), DERNIÈRE page qui
//      réserve la zone récapitulatif + « Fait à » + signatures ; lignes
//      vides de complétion numérotées uniquement en fin de dernière page.
//      Le nombre de pages suit l'EFFECTIF de la classe.
//   2) 3 modèles : PDF (impression navigateur, inchangé visuellement),
//      WORD (.doc HTML MSO A4 portrait — en-têtes répétés, Word pagine
//      naturellement) et EXCEL (.xlsx exceljs — en-tête institutionnel
//      fusionné, tableau bordé vert, récapitulatif, signatures).
//   3) Le NOM du directeur signataire (déjà affiché sous « Le Directeur »
//      depuis la Task 37) figure désormais AUSSI dans les modèles Word et
//      Excel, au même niveau que le tenant du cours et l'inspecteur.

import { useQuery } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { reportsApi } from "@/lib/api";
import type { EndOfYearRow, EndOfYearSummaryRow } from "@/lib/types";
import {
  DocExportButtons,
  XLSX_MIME,
  buildWordShell,
  escHtml,
  saveBlob,
  saveWordDoc,
  slugFile,
} from "@/lib/doc-export";

import { INK } from "./official-doc";
import {
  CIArmoiriesWatermark,
  CI_GREEN,
  CI_GREEN_TEXT,
  CI_ORANGE_BG,
  PRINT_COLOR_STYLE,
} from "@/components/ci-decor";
import {
  canPrintDocument,
  PrintLockBadge,
  PrintLockDocumentMessage,
  usePrintRole,
} from "@/lib/print-guard";

/** Compteur du tableau récapitulatif : 07, 11, 1238 — « 00 » pour un zéro
 *  calculé/saisi, case vide si non renseigné (comme le modèle reçu). */
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "";
  return n < 10 ? `0${n}` : `${n}`;
}

/** Moyenne : virgule française, 2 décimales — case vide si absente. */
function fmtMoy(v: number | null | undefined, has: boolean | undefined): string {
  if (!has || v == null) return "";
  return v.toFixed(2).replace(".", ",");
}

/** Date du jour au format du modèle : jj/mm/aaaa (rendu identique serveur/
 *  client au sein d'une même requête — pas de décalage d'hydratation). */
function todayFr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// POLICE ARIAL taille 12 (demande utilisateur) — Helvetica/Liberation Sans
// en secours (métriques identiques, Linux). Même choix que les autres
// documents officiels (état nominatif, liste des candidats).
const DOC_FONT = '"Arial", "Helvetica", "Liberation Sans", sans-serif';

// Bordures du tableau en VERT DRAPEAU et entêtes sur FOND VERT DRAPEAU
// (texte blanc — sortent à l'impression via print-color-adjust: exact).
const th: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "2px 3px",
  fontSize: "12px",
  lineHeight: 1.2,
  fontWeight: 700,
  textAlign: "center",
  verticalAlign: "middle",
  color: "#ffffff",
  background: CI_GREEN,
  ...PRINT_COLOR_STYLE,
};

const td: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "1px 3px",
  fontSize: "12px",
  lineHeight: 1.2,
  textAlign: "center",
  verticalAlign: "middle",
  color: INK,
  height: "15px",
};

const tdLeft: CSSProperties = { ...td, textAlign: "left" };

/** Cellule NOM ET PRÉNOMS : noms TOUJOURS COMPLETS (session 40) — les
 *  identités longues passent à la ligne au lieu d'être coupées. */
const tdNom: CSSProperties = {
  ...tdLeft,
  overflowWrap: "break-word",
};

/** Largeurs des colonnes du tableau principal (colgroup — PAS de nœuds
 *  texte entre les <col>, erreur d'hydratation React sinon). */
const COL_WIDTHS = [
  "4%", // N°
  "24%", // Nom et Prénoms
  "5.5%", // Âge
  "8%", // Scolarité dans le cours
  "7.5%", // Scolarité totale
  "9.5%", // Moyenne des compositions
  "10.5%", // Moyenne de la composition de passage
  "8.5%", // Moyenne annuelle
  "7.5%", // Décision — Admis
  "7.5%", // Décision — Red
  "7.5%", // Décision — Abd
];

/** Rouge des noms de FILLES (convention des tableaux de classement). */
const FILLE_RED = "#c00000";

// === PAGINATION À BUDGET DE HAUTEUR (A4 PORTRAIT) ===
// Zone imprimable A4 portrait avec marge @page 8mm : 281mm de haut — boîte
// page 279mm (padding 5mm haut/bas → 269mm de contenu, largeur utile
// ~176mm). Chaque ligne est ESTIMÉE (majoration) selon le nom qui peut
// revenir à la ligne (colonne 24% ≈ 42mm ≈ 17 caractères/ligne en Arial
// gras 12 ; +3,9mm par ligne supplémentaire).
const PAGE_BOX_MM = 279; // hauteur de la boîte page (< zone imprimable 281mm)
const PAGE_CONTENT_MM = 269;
const HEADER_MM = 63; // en-tête institutionnel + titre + ECOLE/Cours/Date (page 1)
const THEAD_MM = 20; // 2 rangées d'entêtes du tableau (libellés sur 4-5 lignes)
const GAP_MM = 3; // espace avant le tableau (pages 2+)
const BOTTOM_MM = 76; // zone récapitulatif + Fait à + signatures (dernière page)
const ROW_MM = 4.6; // hauteur d'une ligne simple (Arial 12, hauteur 15px)
const LINE_MM = 3.9; // mm par ligne supplémentaire (nom qui revient à la ligne)

const BUDGET_FIRST = PAGE_CONTENT_MM - HEADER_MM - THEAD_MM; // 183
const BUDGET_FIRST_LAST = BUDGET_FIRST - BOTTOM_MM; // 107 (page unique)
const BUDGET_MID = PAGE_CONTENT_MM - GAP_MM - THEAD_MM; // 246
const BUDGET_LAST = BUDGET_MID - BOTTOM_MM; // 170

/** Estimation MAJORÉE de la hauteur d'une ligne (mm) : seul le NOM ET
 *  PRÉNOMS peut revenir à la ligne (les autres cellules sont numériques) ;
 *  une ligne vide de complétion vaut exactement ROW_MM. */
function estRowHeightMm(row: EndOfYearRow | null): number {
  if (!row) return ROW_MM;
  const lines = Math.max(1, Math.ceil(formatNomPrenoms(row).length / 17));
  return ROW_MM + (Math.min(lines, 3) - 1) * LINE_MM;
}

type EofyPage = Array<EndOfYearRow | null>;

/** Complète la page avec des lignes vides numérotées (modèle papier) tant
 *  que le budget le permet — la zone récap + signatures reste dégagée. */
function withFillers(
  slice: EndOfYearRow[],
  heights: number[],
  budgetMm: number,
): EofyPage {
  const used = heights.reduce((a, b) => a + b, 0);
  const fillers = Math.max(0, Math.floor((budgetMm - used) / ROW_MM));
  return [...slice, ...Array.from({ length: fillers }, () => null)];
}

/** Découpe les élèves en pages par budget de hauteur :
 *  - si TOUT tient sur la page 1 (zone basse comprise) → page unique ;
 *  - sinon page 1 (budget large), pages intermédiaires (entêtes répétés,
 *    en laissant au moins une ligne pour la fin), DERNIÈRE page avec la
 *    zone récapitulatif + signatures réservée (BOTTOM_MM). */
function buildPages(rows: EndOfYearRow[]): EofyPage[] {
  const heights = rows.map(estRowHeightMm);
  const pages: EofyPage[] = [];
  const n = rows.length;
  let i = 0;

  // Classe SANS élève : une page de lignes vides numérotées + zone basse
  // (le récapitulatif « 00 » du modèle reste imprimable).

  // Page unique ? (tout tient sur la page 1, zone basse comprise)
  let j = i;
  let used = 0;
  while (j < n && used + heights[j] <= BUDGET_FIRST_LAST) {
    used += heights[j];
    j++;
  }
  if (n === 0) {
    pages.push(Array.from({ length: 12 }, () => null));
    return pages;
  }

  if (j >= n) {
    if (j === i && n > 0) j = i + 1; // garde-fou : ≥1 élève/page
    pages.push(withFillers(rows.slice(i, j), heights.slice(i, j), BUDGET_FIRST_LAST));
    return pages;
  }

  // Page 1 : en-tête institutionnel (budget large)
  j = i;
  used = 0;
  while (j < n && used + heights[j] <= BUDGET_FIRST) {
    used += heights[j];
    j++;
  }
  if (j === i && n > 0) j = i + 1; // garde-fou : ≥1 élève/page
  pages.push(withFillers(rows.slice(i, j), heights.slice(i, j), BUDGET_FIRST));
  i = j;

  // Pages intermédiaires + dernière (zone basse réservée)
  while (i < n) {
    // Tout le reste tient-il dans le budget « dernière page » ?
    j = i;
    used = 0;
    while (j < n && used + heights[j] <= BUDGET_LAST) {
      used += heights[j];
      j++;
    }
    if (j >= n) {
      pages.push(withFillers(rows.slice(i, j), heights.slice(i, j), BUDGET_LAST));
      i = j;
      break;
    }
    // Page intermédiaire : budget large MAIS ≥1 ligne gardée pour la fin
    j = i;
    used = 0;
    while (j < n && used + heights[j] <= BUDGET_MID) {
      used += heights[j];
      j++;
    }
    if (j === i) j = i + 1; // garde-fou : ≥1 élève/page
    if (j >= n) j = n - 1; // la dernière page reçoit au moins 1 ligne
    pages.push(withFillers(rows.slice(i, j), heights.slice(i, j), BUDGET_MID));
    i = j;
  }
  return pages;
}

// ============================================================ 3 MODÈLES ===

interface EofyExportData {
  rows: EndOfYearRow[];
  summary: {
    effectif: EndOfYearSummaryRow;
    admis: EndOfYearSummaryRow;
    redoublants: EndOfYearSummaryRow;
    exclus: EndOfYearSummaryRow;
    abandons: EndOfYearSummaryRow;
  };
  schoolName: string;
  className: string;
  teacherName: string;
  directeur: string;
  inspecteur: string;
  iepRegion: string;
  iepName: string;
  iepBp: string;
  iepPhone: string;
  iepEmail: string;
  year: number;
}

/** Prénoms « en minuscule » (écriture normale) : initiale en majuscule,
 *  lettres suivantes en minuscules — à chaque segment séparé par une
 *  espace, un tiret ou une apostrophe (« ali ibrahim » → « Ali Ibrahim »,
 *  « marie-josé » → « Marie-José »). */
function titleCasePrenoms(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'\-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/** Nom de l'élève du document officiel : NOM en CARACTÈRE D'IMPRIMERIE
 *  (majuscules) puis prénoms en minuscule (initiales en majuscule).
 *  Utilise les parties séparées last_name / first_name de l'API (le
 *  backend les expose exprès) — repli sur full_name si absentes. */
function formatNomPrenoms(row: EndOfYearRow): string {
  const last = (row.last_name ?? "").trim();
  const first = (row.first_name ?? "").trim();
  if (last && first) return `${last.toUpperCase()} ${titleCasePrenoms(first)}`;
  if (last) return last.toUpperCase();
  if (first) return titleCasePrenoms(first);
  return row.full_name;
}

/** Croix « X » de la décision du Conseil des Maîtres (une seule case). */
function decisionMarks(row: EndOfYearRow): [string, string, string] {
  const d = row.decision_conseil;
  return [d === "A" ? "X" : "", d === "R" ? "X" : "", d === "ABD" ? "X" : ""];
}

/** Bloc de signature réutilisable (PDF/Word/Excel) : intitulé souligné +
 *  NOM en caractère d'imprimerie (majuscules) — nom du directeur signataire
 *  DEMANDÉ par l'utilisateur sous « LE DIRECTEUR ». */
function sigName(label: string, name: string): { label: string; name: string } {
  return { label, name: (name || "").trim().toUpperCase() };
}

// === MODÈLE WORD (.doc) — HTML MSO A4 PORTRAIT fidèle au document PDF ===
// En-tête institutionnel complet, boîte du titre, tableau 11 colonnes
// (thead répété à chaque page par Word via display:table-header-group),
// récapitulatif, « Fait à DABOU » et signatures avec noms.
function buildEofyWordHtml(o: EofyExportData): string {
  const th2 =
    "border:1px solid #009E60; padding:2px 3px; font-size:12px; font-weight:bold; text-align:center; vertical-align:middle; color:#fff; background:#009E60;";
  const td2 =
    "border:1px solid #009E60; padding:1px 3px; font-size:12px; line-height:1.2; text-align:center; vertical-align:middle; height:15px;";
  const tdL = td2.replace("text-align:center", "text-align:left");
  const esc = escHtml;

  const headTop = [
    `<th style="${th2}" rowspan=2>N&deg;</th>`,
    `<th style="${th2}" rowspan=2>Nom et Pr&eacute;noms</th>`,
    `<th style="${th2}" rowspan=2>&Acirc;ge</th>`,
    `<th style="${th2}" rowspan=2>Scolarit&eacute; dans le cours</th>`,
    `<th style="${th2}" rowspan=2>Scolarit&eacute; totale</th>`,
    `<th style="${th2}" rowspan=2>Moyenne des compositions</th>`,
    `<th style="${th2}" rowspan=2>Moyenne de la composition de passage</th>`,
    `<th style="${th2}" rowspan=2>Moyenne annuelle</th>`,
    `<th style="${th2}" colspan=3>D&eacute;cision du Conseil des Ma&icirc;tres</th>`,
  ].join("");
  const headSub = `<tr><th style="${th2}">Admis</th><th style="${th2}">Red</th><th style="${th2}">Abd</th></tr>`;

  const body = o.rows
    .map((row, i) => {
      const [xa, xr, xd] = decisionMarks(row);
      const red = row.gender === "F" ? " color:#c00000;" : "";
      const nom = esc(formatNomPrenoms(row));
      const n = i + 1;
      return (
        `<tr>` +
        `<td style="${td2}">${n}</td>` +
        `<td style="${tdL}; font-weight:600;${red}">${nom}</td>` +
        `<td style="${td2}">${esc(row.age != null ? String(row.age) : "")}</td>` +
        `<td style="${td2}">${esc(row.scolarite_cours != null ? String(row.scolarite_cours) : "")}</td>` +
        `<td style="${td2}">${esc(row.scolarite_totale != null ? String(row.scolarite_totale) : "")}</td>` +
        `<td style="${td2}">${esc(fmtMoy(row.moyenne_compositions, row.has_moyenne_compositions))}</td>` +
        `<td style="${td2}">${esc(fmtMoy(row.moyenne_passage, row.has_moyenne_passage))}</td>` +
        `<td style="${td2}; font-weight:bold;">${esc(fmtMoy(row.moyenne_annuelle, row.has_moyenne_annuelle))}</td>` +
        `<td style="${td2}">${xa}</td><td style="${td2}">${xr}</td><td style="${td2}">${xd}</td>` +
        `</tr>`
      );
    })
    .join("");

  const summaryLine = (label: string, r: EndOfYearSummaryRow) =>
    `<tr>` +
    `<td style="${td2}; font-weight:bold; text-align:left; background:#FDEBDA; color:#00734A;">${esc(label)}</td>` +
    `<td style="${td2}">${esc(fmtNum(r.garcons))}</td>` +
    `<td style="${td2}">${esc(fmtNum(r.filles))}</td>` +
    `<td style="${td2}; font-weight:bold;">${esc(fmtNum(r.total))}</td>` +
    `</tr>`;

  const sig = sigName("Le Directeur", o.directeur);
  const tcs = sigName("Le tenant du cours", o.teacherName);
  const insp = sigName("Visa de l'Inspecteur", o.inspecteur);
  const sigCell = (s: { label: string; name: string }, align: string) =>
    `<td style="border:none; text-align:${align}; font-size:12px; font-weight:bold;">` +
    `<p>${esc(s.label)}</p>` +
    (s.name ? `<p style="margin-top:14px; text-transform:uppercase; letter-spacing:0.3px;">${esc(s.name)}</p>` : "") +
    `</td>`;

  return buildWordShell({
    title: `Résultats de fin d'année ${o.year} — ${o.className}`,
    orientation: "portrait",
    marginMm: 8,
    styles: `
table.hdr { border-collapse:collapse; width:100%; }
table.hdr td { border:none; vertical-align:top; font-size:12px; line-height:1.35; }
.titre { display:inline-block; border:2.2px solid #009E60; background:#FDEBDA; border-radius:14px; padding:6px 34px 7px; font-size:19px; font-weight:bold; letter-spacing:1.5px; line-height:1.25; }
table.doc { border-collapse:collapse; width:100%; table-layout:fixed; }
table.doc td, table.doc th { overflow-wrap:break-word; }
table.doc th { height:8mm; }
thead.rep { display:table-header-group; }
table.rec { border-collapse:collapse; table-layout:fixed; width:58%; }
p.fait { text-align:right; font-size:12px; margin:12px 4% 0 0; font-weight:bold; }
table.sig { border-collapse:collapse; width:100%; margin-top:18px; }
`,
    bodyHtml: `
<table class=hdr><tr>
<td style="width:62%">
<p>Minist&egrave;re de l'Education Nationale</p>
<p>de l'Alphab&eacute;tisation et de l'Enseignement Technique</p>
<p><b>Direction R&eacute;gionale de ${esc(o.iepRegion.toUpperCase())}</b></p>
<p><b>Inspection de l'Enseignement</b></p>
<p><b>Pr&eacute;scolaire et Primaire de ${esc(o.iepName.toUpperCase())}</b></p>
<p>BP : ${esc(o.iepBp || "……")} / Tel : ${esc(o.iepPhone || "…………")}</p>
<p>Courriel : ${esc(o.iepEmail || "…………")}</p>
</td>
<td style="width:38%; text-align:center">
<p>R&eacute;publique de C&ocirc;te d'Ivoire</p>
<p>Union-Discipline-Travail</p>
</td>
</tr></table>
<p style="text-align:center; margin:4px 0 8px;"><span class=titre>RESULTATS DE FIN D'ANNEE</span></p>
<p style="font-size:12px; margin:0 2px 4px;"><b><span style="color:#00734A">ECOLE</span> : ${esc(o.schoolName)}</b>&nbsp;&nbsp;&nbsp;<span style="color:#00734A">Cours</span>: <b>${esc(o.className)}</b>&nbsp;&nbsp;&nbsp;<span style="color:#00734A">Date</span>: <b>${todayFr()}</b></p>
<table class=doc>
<colgroup>${COL_WIDTHS.map((w) => `<col style="width:${w}">`).join("")}</colgroup>
<thead class=rep><tr>${headTop}</tr>${headSub}</thead>
<tbody>${body}</tbody>
</table>
<div style="margin-top:10px; text-align:right;">
<table class=rec align=right>
<colgroup><col style="width:40%"><col style="width:20%"><col style="width:20%"><col style="width:20%"></colgroup>
<tr><td style="${td2}; border:none; background:none;">&nbsp;</td><th style="${th2}">Gar&ccedil;ons</th><th style="${th2}">Filles</th><th style="${th2}">Total</th></tr>
${summaryLine("Effectif", o.summary.effectif)}
${summaryLine("Admis", o.summary.admis)}
${summaryLine("Redoublants", o.summary.redoublants)}
${summaryLine("Exclus", o.summary.exclus)}
${summaryLine("Abandons", o.summary.abandons)}
</table>
</div>
<p class=fait>Fait &agrave; DABOU, le ${todayFr()}</p>
<table class=sig><tr>
${sigCell(sig, "left")}
${sigCell(tcs, "center")}
${sigCell(insp, "right")}
</tr></table>
`,
  });
}

// === MODÈLE EXCEL (.xlsx) — classeur mis en page (exceljs) ===
// En-tête institutionnel fusionné, tableau 11 colonnes bordé vert (filles
// en rouge), récapitulatif, « Fait à DABOU », signatures avec noms ;
// impression portrait ajustée à 1 page de large, entêtes répétés.
async function exportEofyExcelAsync(o: EofyExportData): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";
  const ws = wb.addWorksheet("Resultats", {
    views: [{ state: "frozen", ySplit: 9, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printTitlesRow: "8:9",
    },
  });
  ws.columns = [4.5, 30, 5.5, 11, 9.5, 12.5, 14, 11, 7, 7, 7].map((width) => ({ width }));

  const font = (size: number, bold = false, argb?: string) => ({
    name: "Arial",
    size,
    bold,
    ...(argb ? { color: { argb } } : {}),
  });
  const GREEN = { argb: "FF009E60" };
  const GREEN_TXT = { argb: "FF00734A" };
  const ORANGE_BG = { argb: "FFFDEBDA" };
  const RED = { argb: "FFC00000" };
  const border = { style: "thin" as const, color: GREEN };
  const BOX = { top: border, left: border, bottom: border, right: border };
  const merged = (
    row: number,
    text: string,
    size: number,
    bold = false,
    italic = false,
  ) => {
    ws.mergeCells(row, 1, row, 11);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: "Arial", size, bold, italic };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  };

  // --- En-tête institutionnel (fidèle au modèle PDF) ---
  merged(1, "Ministère de l'Education Nationale de l'Alphabétisation et de l'Enseignement Technique", 12, true);
  merged(2, `Direction Régionale de ${(o.iepRegion || "…………").toUpperCase()} — Inspection de l'Enseignement Préscolaire et Primaire de ${(o.iepName || "…………").toUpperCase()}`, 11, true, true);
  merged(3, `BP : ${o.iepBp || "……"} / Tel : ${o.iepPhone || "…………"} — Courriel : ${o.iepEmail || "…………"}`, 11);
  merged(4, "République de Côte d'Ivoire — Union-Discipline-Travail", 11, true);
  merged(5, "RESULTATS DE FIN D'ANNEE", 14, true);
  for (let col = 1; col <= 11; col++) ws.getCell(5, col).border = BOX;

  ws.mergeCells(6, 1, 6, 6);
  const ecole = ws.getCell(6, 1);
  ecole.value = `ECOLE : ${o.schoolName}`;
  ecole.font = font(11, true, "FF00734A");
  ws.mergeCells(6, 7, 6, 8);
  const cours = ws.getCell(6, 7);
  cours.value = `Cours : ${o.className}`;
  cours.font = font(11, true);
  ws.mergeCells(6, 9, 6, 11);
  const dateCell = ws.getCell(6, 9);
  dateCell.value = `Date : ${todayFr()}`;
  dateCell.font = font(11, true);
  dateCell.alignment = { horizontal: "right" };
  ws.getRow(7).height = 4;

  // --- Entêtes du tableau (2 rangées, fusions comme le PDF) ---
  const headTopLabels: Array<[number, number, number, string]> = [
    [1, 8, 9, "N°"],
    [2, 8, 9, "Nom et Prénoms"],
    [3, 8, 9, "Âge"],
    [4, 8, 9, "Scolarité dans le cours"],
    [5, 8, 9, "Scolarité totale"],
    [6, 8, 9, "Moyenne des compositions"],
    [7, 8, 9, "Moyenne de la composition de passage"],
    [8, 8, 9, "Moyenne annuelle"],
  ];
  for (const [col, r1, r2, label] of headTopLabels) {
    ws.mergeCells(r1, col, r2, col);
    const c = ws.getCell(r1, col);
    c.value = label;
  }
  ws.mergeCells(8, 9, 8, 11);
  ws.getCell(8, 9).value = "Décision du Conseil des Maîtres";
  ["Admis", "Red", "Abd"].forEach((label, k) => {
    ws.getCell(9, 9 + k).value = label;
  });
  for (let r = 8; r <= 9; r++) {
    const row = ws.getRow(r);
    row.height = r === 8 ? 30 : 16;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = font(10, true, "FFFFFFFF");
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = BOX;
      c.fill = { type: "pattern", pattern: "solid", fgColor: GREEN };
    });
  }

  // --- Lignes élèves (numérotées, filles en rouge) ---
  o.rows.forEach((row, i) => {
    const [xa, xr, xd] = decisionMarks(row);
    const girl = row.gender === "F";
    const r = 10 + i;
    const values = [
      i + 1,
      formatNomPrenoms(row),
      row.age ?? "",
      row.scolarite_cours ?? "",
      row.scolarite_totale ?? "",
      fmtMoy(row.moyenne_compositions, row.has_moyenne_compositions),
      fmtMoy(row.moyenne_passage, row.has_moyenne_passage),
      fmtMoy(row.moyenne_annuelle, row.has_moyenne_annuelle),
      xa,
      xr,
      xd,
    ];
    const xr2 = ws.getRow(r);
    xr2.values = values;
    xr2.height = 16;
    xr2.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = BOX;
      c.font = font(10, false, girl && col === 2 ? RED.argb : undefined);
      c.alignment =
        col === 2
          ? { horizontal: "left", vertical: "middle", wrapText: true }
          : { horizontal: "center", vertical: "middle", wrapText: true };
    });
    ws.getCell(r, 2).font = { ...ws.getCell(r, 2).font, bold: true };
    ws.getCell(r, 8).font = { ...ws.getCell(r, 8).font, bold: true };
  });

  // --- Récapitulatif (aligné à droite, comme le modèle) ---
  const rStart = 10 + o.rows.length + 1;
  ws.mergeCells(rStart - 1, 1, rStart - 1, 11); // rangée d'aération
  const recHead = ws.getRow(rStart);
  ws.mergeCells(rStart, 6, rStart, 8);
  recHead.getCell(6).value = "";
  ["Garçons", "Filles", "Total"].forEach((label, k) => {
    recHead.getCell(9 + k).value = label;
  });
  const summaryRows: Array<[string, EndOfYearSummaryRow]> = [
    ["Effectif", o.summary.effectif],
    ["Admis", o.summary.admis],
    ["Redoublants", o.summary.redoublants],
    ["Exclus", o.summary.exclus],
    ["Abandons", o.summary.abandons],
  ];
  summaryRows.forEach(([label, sr], k) => {
    const r = rStart + 1 + k;
    ws.mergeCells(r, 6, r, 8);
    const lab = ws.getCell(r, 6);
    lab.value = label;
    lab.alignment = { horizontal: "left", vertical: "middle" };
    const vals: Array<number | null | undefined> = [sr.garcons, sr.filles, sr.total];
    vals.forEach((v, kk) => {
      const c = ws.getCell(r, 9 + kk);
      c.value = v == null ? "" : fmtNum(v);
    });
    const row = ws.getRow(r);
    row.height = 15;
    for (let col = 6; col <= 11; col++) {
      const c = ws.getCell(r, col);
      c.border = BOX;
      c.font = font(10, col === 11);
      c.alignment = { horizontal: col === 6 ? "left" : "center", vertical: "middle" };
      if (col === 6) c.fill = { type: "pattern", pattern: "solid", fgColor: ORANGE_BG };
      if (col === 6) c.font = font(10, true, GREEN_TXT.argb);
    }
  });
  // Entête Garçons/Filles/Total du récap (fond vert)
  for (let col = 9; col <= 11; col++) {
    const c = recHead.getCell(col);
    c.font = font(10, true, "FFFFFFFF");
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = BOX;
    c.fill = { type: "pattern", pattern: "solid", fgColor: GREEN };
  }

  // --- Fait à + signatures ---
  const rSig = rStart + summaryRows.length + 2;
  ws.mergeCells(rSig, 1, rSig, 11);
  const fait = ws.getCell(rSig, 1);
  fait.value = `Fait à DABOU, le ${todayFr()}`;
  fait.font = font(11, true);
  fait.alignment = { horizontal: "right" };

  const rSig2 = rSig + 2;
  const sigCols: Array<[number, string, string]> = [
    [2, "Le Directeur", o.directeur],
    [5, "Le tenant du cours", o.teacherName],
    [8, "Visa de l'Inspecteur", o.inspecteur],
  ];
  for (const [col, label, name] of sigCols) {
    const lab = ws.getCell(rSig2, col);
    lab.value = label;
    lab.font = font(11, true);
    if (name.trim()) {
      const nm = ws.getCell(rSig2 + 2, col);
      nm.value = name.trim().toUpperCase();
      nm.font = font(10, true);
    }
  }

  // --- Armoiries (meilleur effort) ---
  try {
    const res = await fetch("/ci-coat-of-arms.png");
    if (res.ok) {
      const u8 = new Uint8Array(await res.arrayBuffer());
      const imgId = wb.addImage({
        buffer: u8 as unknown as Parameters<typeof wb.addImage>[0]["buffer"],
        extension: "png",
      });
      ws.addImage(imgId, { tl: { col: 9.6, row: 0.2 }, ext: { width: 46, height: 46 } });
    }
  } catch {
    // armoiries omises — l'en-tête reste lisible
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: XLSX_MIME }),
    `resultats-fin-annee-${slugFile(o.className)}-${o.year}.xlsx`,
  );
}

// === DOCUMENT (composant) ===

export function EndOfYearDocument({
  schoolId,
  classId,
  year,
  onClose,
}: {
  schoolId: string;
  classId: string;
  year: number;
  onClose: () => void;
}) {
  // v2 — VERROU D'IMPRESSION : seuls l'Admin IEP et le Super Admin
  // impriment ; le directeur consulte à l'écran, l'enseignant n'accède pas.
  const role = usePrintRole();
  const canPrint = canPrintDocument(role, false);
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["end-of-year", schoolId, classId, year],
    queryFn: () => reportsApi.endOfYearSheet(schoolId, classId, year),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">
            Calcul des moyennes de fin d&apos;année…
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
            Impossible de charger les résultats de fin d&apos;année
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

  const rows = data.rows;
  const summary = data.summary;
  const iep = data.iep;

  // v6 — découpage en pages à budget de hauteur : le nombre de pages et
  // de lignes vides de complétion s'adapte à l'EFFECTIF de la classe
  // (demande utilisateur) — la zone récapitulatif + signatures reste sur
  // la dernière page, sous les entêtes du tableau répétés.
  const pages = buildPages(rows);
  const lastPageIdx = pages.length - 1;

  const exportData: EofyExportData = {
    rows,
    summary,
    schoolName: data.school.name,
    className: data.class.name,
    teacherName: data.class.teacher_name ?? "",
    directeur: data.directeur ?? "",
    inspecteur: data.inspecteur ?? "",
    iepRegion: iep?.region ?? "",
    iepName: iep?.name ?? "",
    iepBp: iep?.bp ?? "",
    iepPhone: iep?.inspector_phone ?? "",
    iepEmail: iep?.inspector_email ?? "",
    year: data.year,
  };

  // Modèle WORD (.doc) — HTML MSO A4 portrait fidèle au document imprimé.
  function handleWord() {
    setExporting("doc");
    try {
      saveWordDoc(
        buildEofyWordHtml(exportData),
        `resultats-fin-annee-${slugFile(exportData.className)}-${exportData.year}.doc`,
      );
    } finally {
      setExporting(null);
    }
  }

  // Modèle EXCEL (.xlsx) — classeur mis en page (exceljs importé à la demande).
  async function handleExcel() {
    setExporting("xlsx");
    try {
      await exportEofyExcelAsync(exportData);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Résultats de fin d&apos;année — {data.school.name} · {data.class.name}{" "}
          · {data.count} élève(s) · Année {data.year}
        </h3>
        <div className="flex items-center gap-2">
          {canPrint ? (
            <DocExportButtons
              canPrint
              exporting={exporting}
              onPdf={() => window.print()}
              onWord={handleWord}
              onExcel={handleExcel}
              formatHint="Format : A4 portrait"
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

      {/* === DOCUMENT OFFICIEL (isolement impression #resultats-fin-annee-doc) === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="resultats-fin-annee-doc"
        className={`mx-auto my-3 ${canPrint ? "" : "print-locked"}`}
        style={{ width: "100%", maxWidth: "210mm", fontFamily: DOC_FONT, color: INK }}
      >
        {/* --- ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane (fond, répété
                sur chaque page imprimée) --- */}
        <CIArmoiriesWatermark fixed />
        {pages.map((pageRows, pageIdx) => {
          const isFirst = pageIdx === 0;
          const isLast = pageIdx === lastPageIdx;
          // Numérotation continue du registre (élèves + lignes vides de
          // complétion), comme les 72 lignes du modèle papier.
          const offset = pages.slice(0, pageIdx).reduce((a, p) => a + p.length, 0);
          return (
            <div
              key={pageIdx}
              className={`eofy-page bg-white shadow-lg print:shadow-none ${!isLast ? "mb-4 print:mb-0" : ""}`}
              style={{
                position: "relative",
                // Page unique : hauteur auto (le budget garantit la place) —
                // pages multiples : boîte fixe, comme la liste des candidats.
                height: isFirst && isLast ? undefined : `${PAGE_BOX_MM}mm`,
                padding: "5mm 9mm",
                overflow: "hidden",
                pageBreakAfter: isLast ? "auto" : "always",
                breakAfter: isLast ? "auto" : "page",
              }}
            >
              {isFirst && (
                <>
                  {/* --- En-tête institutionnel (modèle reçu) --- */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: "8px",
                    }}
                  >
                    <div style={{ fontSize: "12px", color: INK, lineHeight: 1.35 }}>
                      <div>Ministère de l&apos;Education Nationale</div>
                      <div>de l&apos;Alphabétisation et de l&apos;Enseignement Technique</div>
                      <div style={{ fontWeight: 600, marginTop: "2px" }}>
                        Direction Régionale de {(iep?.region || "…………").toUpperCase()}
                      </div>
                      <div style={{ fontWeight: 700, marginTop: "2px" }}>
                        Inspection de l&apos;Enseignement
                      </div>
                      <div style={{ fontWeight: 700 }}>
                        Préscolaire et Primaire de {(iep?.name || "…………").toUpperCase()}
                      </div>
                      <div style={{ marginTop: "2px" }}>
                        BP : {iep?.bp || "……"} / Tel : {iep?.inspector_phone || "…………"}
                      </div>
                      <div>
                        Courriel :{" "}
                        <span style={{ color: "#0563C1", textDecoration: "underline" }}>
                          {iep?.inspector_email || "…………"}
                        </span>
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "12px", color: INK }}>
                        République de Côte d&apos;Ivoire
                      </div>
                      <div style={{ fontSize: "12px", color: INK, padding: "1px 0" }}>
                        Union-Discipline-Travail
                      </div>
                      <img
                        src="/ci-coat-of-arms.png"
                        alt="Armoiries de la République de Côte d'Ivoire"
                        style={{ height: "52px", margin: "2px auto 0", display: "block" }}
                      />
                    </div>
                  </div>

                  {/* --- Boîte du titre (bord arrondi — modèle) --- */}
                  <div style={{ textAlign: "center", margin: "4px 0 8px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        border: `2.2px solid ${CI_GREEN}`,
                        background: CI_ORANGE_BG,
                        borderRadius: "14px",
                        padding: "6px 34px 7px",
                        fontSize: "19px",
                        fontWeight: 700,
                        letterSpacing: "1.5px",
                        lineHeight: 1.25,
                        color: INK,
                        boxShadow: "2.5px 2.5px 0 #bfbfbf",
                        textAlign: "center",
                      }}
                    >
                      RESULTATS DE FIN D&apos;ANNEE
                    </span>
                  </div>

                  {/* --- Lignes École (gauche) / Cours + Date (droite) --- */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-end",
                      fontSize: "12px",
                      margin: "0 2px 4px",
                      color: INK,
                    }}
                  >
                    <span>
                      <b style={{ color: CI_GREEN_TEXT }}>ECOLE</b> :{" "}
                      <b>{data.school.name}</b>
                    </span>
                    <span style={{ textAlign: "right", lineHeight: 1.5 }}>
                      <div>
                        <span style={{ color: CI_GREEN_TEXT }}>Cours</span>:{" "}
                        <b>{data.class.name}</b>
                      </div>
                      <div>
                        <span style={{ color: CI_GREEN_TEXT }}>Date</span>:{" "}
                        <b>{todayFr()}</b>
                      </div>
                    </span>
                  </div>
                </>
              )}

              {/* Espace avant le tableau (pages 2+) */}
              {!isFirst && <div style={{ height: `${GAP_MM}mm` }} />}

              {/* --- Tableau principal (11 colonnes — entêtes répétés) --- */}
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  tableLayout: "fixed",
                  color: INK,
                }}
              >
                <colgroup>
                  {COL_WIDTHS.map((w, i) => (
                    <col key={i} style={{ width: w }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th style={th} rowSpan={2}>
                      N°
                    </th>
                    <th style={th} rowSpan={2}>
                      Nom et Prénoms
                    </th>
                    <th style={th} rowSpan={2}>
                      Âge
                    </th>
                    {/* v5 — entêtes À L'HORIZONTALE (annulation de la lecture
                        verticale v4, demande utilisateur) */}
                    <th style={th} rowSpan={2}>
                      Scolarité dans le cours
                    </th>
                    <th style={th} rowSpan={2}>
                      Scolarité totale
                    </th>
                    <th style={th} rowSpan={2}>
                      Moyenne des compositions
                    </th>
                    <th style={th} rowSpan={2}>
                      Moyenne de la composition de passage
                    </th>
                    <th style={th} rowSpan={2}>
                      Moyenne annuelle
                    </th>
                    <th style={th} colSpan={3}>
                      Décision du Conseil des Maîtres
                    </th>
                  </tr>
                  <tr>
                    <th style={th}>Admis</th>
                    <th style={th}>Red</th>
                    <th style={th}>Abd</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => (
                    <EndOfYearTableRow
                      key={row?.student_id ?? `empty-${offset + i}`}
                      row={row}
                      n={offset + i + 1}
                    />
                  ))}
                </tbody>
              </table>

              {/* --- DERNIÈRE page : récapitulatif + Fait à + signatures --- */}
              {isLast && (
                <>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
                    <table
                      style={{
                        borderCollapse: "collapse",
                        tableLayout: "fixed",
                        width: "58%",
                        color: INK,
                      }}
                    >
                      <colgroup>
                        <col style={{ width: "40%" }} />
                        <col style={{ width: "20%" }} />
                        <col style={{ width: "20%" }} />
                        <col style={{ width: "20%" }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th style={{ ...th, border: "none", background: "transparent", color: INK }}>&nbsp;</th>
                          <th style={th}>Garçons</th>
                          <th style={th}>Filles</th>
                          <th style={th}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        <SummaryRow label="Effectif" row={summary.effectif} />
                        <SummaryRow label="Admis" row={summary.admis} />
                        <SummaryRow label="Redoublants" row={summary.redoublants} />
                        <SummaryRow label="Exclus" row={summary.exclus} />
                        <SummaryRow label="Abandons" row={summary.abandons} />
                      </tbody>
                    </table>
                  </div>

                  <div
                    style={{
                      textAlign: "right",
                      fontSize: "12px",
                      margin: "12px 4% 0 0",
                      color: INK,
                    }}
                  >
                    Fait à DABOU, le <b>{todayFr()}</b>
                  </div>

                  {/* --- Signatures (modèle) — noms du directeur, du tenant
                          du cours et de l'inspecteur insérés AU MÊME
                          NIVEAU, en caractère d'imprimerie (Task 37). --- */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "12px",
                      fontWeight: 700,
                      marginTop: "18px",
                      padding: "0 2%",
                      color: INK,
                    }}
                  >
                    <div style={{ textAlign: "left" }}>
                      <div>Le Directeur</div>
                      {data.directeur ? (
                        <div
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            marginTop: "14px",
                            textTransform: "uppercase",
                            letterSpacing: "0.3px",
                          }}
                        >
                          {data.directeur}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div>Le tenant du cours</div>
                      {data.class.teacher_name ? (
                        <div
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            marginTop: "14px",
                            textTransform: "uppercase",
                            letterSpacing: "0.3px",
                          }}
                        >
                          {data.class.teacher_name}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div>Visa de l&apos;Inspecteur</div>
                      {data.inspecteur ? (
                        <div
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            marginTop: "14px",
                            textTransform: "uppercase",
                            letterSpacing: "0.3px",
                          }}
                        >
                          {data.inspecteur}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Une ligne élève (ou vierge, numérotée) du tableau principal. La décision
 *  du conseil des maîtres marque une croix « X » dans UNE des sous-colonnes
 *  Admis / Red / Abd (comme sur le document papier). */
function EndOfYearTableRow({ row, n }: { row: EndOfYearRow | null; n: number }) {
  if (!row) {
    return (
      <tr>
        <td style={td}>{n}</td>
        <td style={tdLeft}>&nbsp;</td>
        {Array.from({ length: 9 }, (_, k) => (
          <td key={k} style={td}>
            &nbsp;
          </td>
        ))}
      </tr>
    );
  }
  const decision = row.decision_conseil;
  return (
    <tr style={{ pageBreakInside: "avoid" }}>
      <td style={td}>{n}</td>
      <td
        style={{
          ...tdNom,
          fontWeight: 600,
          // NOM en CARACTÈRE D'IMPRIMERIE (majuscules) puis prénoms en
          // minuscule (formatNomPrenoms — parties last_name / first_name
          // de l'API). Noms des FILLES en rouge (garçons en encre noire).
          color: row.gender === "F" ? FILLE_RED : undefined,
        }}
      >
        {formatNomPrenoms(row)}
      </td>
      <td style={td}>{row.age ?? ""}</td>
      <td style={td}>{row.scolarite_cours ?? ""}</td>
      <td style={td}>{row.scolarite_totale ?? ""}</td>
      <td style={td}>{fmtMoy(row.moyenne_compositions, row.has_moyenne_compositions)}</td>
      <td style={td}>{fmtMoy(row.moyenne_passage, row.has_moyenne_passage)}</td>
      <td style={{ ...td, fontWeight: 700 }}>
        {fmtMoy(row.moyenne_annuelle, row.has_moyenne_annuelle)}
      </td>
      <td style={td}>{decision === "A" ? "X" : ""}</td>
      <td style={td}>{decision === "R" ? "X" : ""}</td>
      <td style={td}>{decision === "ABD" ? "X" : ""}</td>
    </tr>
  );
}

/** Une ligne du tableau récapitulatif (G / F / T) — label sur fond
 *  pastel orange drapeau (inspiration bulletins individuels). */
function SummaryRow({ label, row }: { label: string; row: EndOfYearSummaryRow }) {
  return (
    <tr>
      <td
        style={{
          ...td,
          fontWeight: 700,
          background: CI_ORANGE_BG,
          color: CI_GREEN_TEXT,
          ...PRINT_COLOR_STYLE,
        }}
      >
        {label}
      </td>
      <td style={td}>{fmtNum(row.garcons)}</td>
      <td style={td}>{fmtNum(row.filles)}</td>
      <td style={{ ...td, fontWeight: 700 }}>{fmtNum(row.total)}</td>
    </tr>
  );
}
