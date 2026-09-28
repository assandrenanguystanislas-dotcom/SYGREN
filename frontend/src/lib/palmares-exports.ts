"use client";

// === Exports du PALMARÈS du module Résultats — PDF + Excel (Task 70) ===
//
// « Tableau des 10 meilleurs élèves par niveau (CP1..CM2) après chaque
// composition et examen blanc, en termes de filles et garçons — 1 tableau
// filles et 1 tableau garçons — colonnes : MATRICULE ; ECOLE ; SECTEUR ;
// NOM ET PRENOMS ; MOYENNE ; RANG ; en-tête défini par SYGREN. »
//
//   - PDF   : impression navigateur via iframe caché (A4 PAYSAGE — 2
//     tableaux côte à côte par niveau), en-tête institutionnel fidèle aux
//     documents SYGREN (armoiries + République / Ministère / DREN-IEP
//     génériques car le palmarès est INTER-ÉCOLES) ;
//   - EXCEL : classeur 2 feuilles FILLES / GARÇONS (6 blocs de niveau
//     chacun, bandeaux verts, barème rappelé par niveau), exceljs —
//     même décor que le Fichier du personnel ;
//
// NB — pas de verrou canPrintDocument : le palmarès est une vue de
// travail du module Résultats (rôles déjà contrôlés côté backend).

import { saveBlob, slugFile, XLSX_MIME } from "@/lib/doc-export";
import type { PalmaresData, PalmaresEntry, PalmaresLevel } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────
// Décor ivoirien (mêmes valeurs que classement-exports / ci-decor)
// ─────────────────────────────────────────────────────────────────────────

const CI_GREEN = "#009E60";
const CI_GREEN_BG = "#E4F4ED";
const CI_GREEN_TEXT = "#00734A";
const CI_ORANGE_BG = "#FDEBDA";
const GIRLS_BG = "#BE185D"; // bandeau FILLES (écho « noms des filles en rouge »)
const BOYS_BG = "#1D4ED8"; // bandeau GARÇONS
const GOLD_BG = "#FFF7E6"; // rang 1

/** Libellé de l'événement : « COMPOSITION N°1 — ANNÉE 2026 ». */
export function palmaresEventLabel(evalTypeLabel: string, evalNumber: number, year: number): string {
  return `${evalTypeLabel || "Évaluation"} N°${evalNumber} — Année ${year}`.toUpperCase();
}

/** Base du nom de fichier : « palmares-composition-n-1-annee-2026 ». */
export function palmaresFileBase(label: string): string {
  return slugFile(`palmares ${label}`);
}

function todayFr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function escHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Moyenne affichée « 9,01 / 10 » (virgule française, barème par niveau). */
function fmtAvg(e: PalmaresEntry): string {
  return `${e.average.toFixed(2).replace(".", ",")} / ${e.average_scale}`;
}

// ─────────────────────────────────────────────────────────────────────────
// PDF — impression navigateur via iframe caché (A4 paysage)
// ─────────────────────────────────────────────────────────────────────────

const CELL_BASE = `border:1px solid ${CI_GREEN}; padding:2px 5px; vertical-align:middle;`;
const TH_STYLE = `${CELL_BASE} background:${CI_GREEN}; color:#ffffff; font-weight:bold; text-align:center; font-size:8pt;`;

/** Tableau d'un sexe pour un niveau (colonnes DEMANDÉES dans l'ordre :
 *  MATRICULE, ÉCOLE, SECTEUR, NOM ET PRÉNOMS, MOYENNE, RANG). */
function buildGenderTableHtml(title: string, bandColor: string, entries: PalmaresEntry[]): string {
  const rows = entries
    .map((e) => {
      const bg = e.rank === 1 ? ` background:${GOLD_BG};` : "";
      const td = (extra: string, align = "left", extraStyle = "") =>
        `<td style="${CELL_BASE}${bg} text-align:${align}; font-size:8pt; ${extraStyle}">${extra}</td>`;
      return `<tr>
  ${td(`<span style="font-family:Consolas,monospace;">${escHtml(e.matricule)}</span>`)}
  ${td(escHtml(e.school || "—"))}
  ${td(escHtml(e.sector || "—"), "center")}
  ${td(`<b>${escHtml(e.full_name)}</b>`)}
  ${td(`<b>${escHtml(fmtAvg(e))}</b>`, "center")}
  ${td(`<b>${e.rank}</b>`, "center")}
</tr>`;
    })
    .join("\n");
  const emptyRow = entries.length
    ? ""
    : `<tr><td colspan="6" style="${CELL_BASE} text-align:center; padding:10px; font-size:8pt; color:#666;">Aucun élève classé.</td></tr>`;
  return `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
  <tr>
    <td colspan="6" style="background:${bandColor}; color:#fff; font-weight:bold; text-align:center; padding:4px; font-size:9pt; border:1px solid ${bandColor}; letter-spacing:0.5px;">${escHtml(title)}</td>
  </tr>
  <tr style="display:table-header-group;">
    <th style="${TH_STYLE} width:16%;">Matricule</th>
    <th style="${TH_STYLE} width:24%;">École</th>
    <th style="${TH_STYLE} width:12%;">Secteur</th>
    <th style="${TH_STYLE} width:26%;">Nom et Prénoms</th>
    <th style="${TH_STYLE} width:13%;">Moyenne</th>
    <th style="${TH_STYLE} width:9%;">Rang</th>
  </tr>
  ${rows}
  ${emptyRow}
</table>`;
}

/** Corps HTML complet du PALMARÈS — 2 tableaux côte à côte par niveau. */
export function buildPalmaresBodyHtml(data: PalmaresData, eventLabel: string, armoiriesImg: string): string {
  const schools = data.event?.schools ?? 0;
  const students = data.event?.students ?? 0;

  const header = `<table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:6px;">
  <tr>
    <td width="70%" style="border:none; font-size:9pt; text-align:left; vertical-align:top; padding:0;">
      <p style="font-weight:bold; margin:0;">République de Côte d'Ivoire</p>
      <p style="font-weight:bold; margin:0;">Ministère de l'Éducation Nationale</p>
      <p style="font-weight:bold; margin:0;">Et de l'Alphabétisation</p>
      <p style="font-weight:bold; margin:0;">Palmarès d'excellence — classement inter-écoles</p>
    </td>
    <td width="30%" style="border:none; font-size:9pt; text-align:right; vertical-align:top; padding:0;">
      <p style="font-weight:bold; margin:0 0 4px 0;">Union - Discipline - Travail</p>
      ${armoiriesImg}
    </td>
  </tr>
</table>
<hr color="${CI_GREEN}" style="border:none; border-top:1.5px solid ${CI_GREEN}; margin:4px 0 10px 0;">`;

  const titleBox = `<table width="78%" align="center" cellspacing="0" cellpadding="0" style="border:2.2px solid ${CI_GREEN}; background:${CI_ORANGE_BG}; margin:0 auto 8px auto;">
  <tr>
    <td style="border:none; background:${CI_ORANGE_BG}; text-align:center; padding:6px 20px;">
      <div style="font-size:14pt; font-weight:bold; letter-spacing:1px; color:#000;">PALMARÈS D'EXCELLENCE — LES 10 MEILLEURS ÉLÈVES PAR NIVEAU</div>
      <div style="font-size:10.5pt; font-weight:bold; margin-top:2px; color:${CI_GREEN_TEXT};">${escHtml(eventLabel)} — FILLES &amp; GARÇONS</div>
    </td>
  </tr>
</table>`;

  const infoLine = `<p style="font-size:9pt; text-align:center; margin:0 0 10px 0;">
  ${schools} école(s) — ${students} élève(s) classé(s) — Édité le ${todayFr()}
</p>`;

  const sections = (data.levels ?? [])
    .map((lv: PalmaresLevel) => {
      const scale = lv.filles[0]?.average_scale ?? lv.garcons[0]?.average_scale ?? 0;
      const scaleNote = scale ? ` — barème /${scale}` : "";
      return `
<div style="margin-bottom:12px; page-break-inside:avoid;">
  <div style="background:${CI_GREEN}; color:#fff; font-weight:bold; text-align:center; padding:4px; font-size:10.5pt; letter-spacing:1px;">NIVEAU ${escHtml(lv.level)}${escHtml(scaleNote)}</div>
  <table width="100%" cellspacing="0" cellpadding="0" style="margin-top:4px;">
    <tr>
      <td width="50%" style="border:none; vertical-align:top; padding:0 4px 0 0;">${buildGenderTableHtml(`LES 10 MEILLEURES FILLES — ${lv.level}`, GIRLS_BG, lv.filles)}</td>
      <td width="50%" style="border:none; vertical-align:top; padding:0 0 0 4px;">${buildGenderTableHtml(`LES 10 MEILLEURS GARÇONS — ${lv.level}`, BOYS_BG, lv.garcons)}</td>
    </tr>
  </table>
</div>`;
    })
    .join("\n");

  const emptyState = (data.levels ?? []).length
    ? ""
    : `<p style="text-align:center; padding:20px; color:#555;">Aucune donnée de classement pour cet événement.</p>`;

  return `${header}
${titleBox}
${infoLine}
${sections}
${emptyState}
<p style="font-size:8pt; color:#555555; margin-top:6px;">
  Rangs partagés en cas d'égalité de moyenne (1, 2, 2, 4...). Moyennes calculées sur le barème propre à chaque niveau (CP1-CE2 : /10, CM1-CM2 : /20) après chaque composition et examen blanc.
</p>`;
}

function buildPrintHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<style>
@page { size: A4 landscape; margin: 10mm; }
html, body { margin: 0; padding: 0; }
body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10px;
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
table { border-collapse: collapse; }
p { margin: 3px 0; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

/** Imprime le palmarès (PDF navigateur) dans un iframe caché —
 *  même mécanique que printClassementToPdf (Task 27). */
export function printPalmaresToPdf(data: PalmaresData, eventLabel: string): Promise<void> {
  const armoiriesImg = `<img src="${window.location.origin}/ci-coat-of-arms.png" width="56" height="56" alt="" style="width:56px;height:56px;object-fit:contain;">`;
  const bodyHtml = buildPalmaresBodyHtml(data, eventLabel, armoiriesImg);
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) {
      iframe.remove();
      resolve();
      return;
    }
    doc.open();
    doc.write(buildPrintHtml(`Palmarès ${eventLabel}`, bodyHtml));
    doc.close();

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        iframe.remove();
      } catch {
        /* déjà retiré */
      }
      resolve();
    };
    const safety = setTimeout(cleanup, 120000);
    win.onafterprint = () => {
      clearTimeout(safety);
      cleanup();
    };
    const imgs = Array.from(doc.images ?? []);
    Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((res) => {
              img.onload = () => res();
              img.onerror = () => res();
            }),
      ),
    ).then(() => {
      setTimeout(() => {
        win.focus();
        win.print();
      }, 350);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
// EXCEL — classeur 2 feuilles FILLES / GARÇONS (exceljs)
// ─────────────────────────────────────────────────────────────────────────

const X_GREEN = { argb: "FF009E60" };
const X_WHITE = { argb: "FFFFFFFF" };
const X_PALE = { argb: "FFE6F4EB" };
const X_SUB_TEXT = { argb: "FF00794A" };
const X_GOLD = { argb: "FFFFF7E6" };

const PALMARES_HEADERS = [
  "MATRICULE",
  "ÉCOLE",
  "SECTEUR",
  "NOM ET PRÉNOMS",
  "MOYENNE",
  "RANG",
];

/** Barème dominant d'un niveau (pour le bandeau : « NIVEAU CP1 — BARÈME /10 »). */
function levelScale(lv: PalmaresLevel): number {
  return lv.filles[0]?.average_scale ?? lv.garcons[0]?.average_scale ?? (["CP1", "CP2", "CE1", "CE2"].includes(lv.level) ? 10 : 20);
}

function addPalmaresSheet(
  wb: import("exceljs").Workbook,
  sheetTitle: "FILLES" | "GARÇONS",
  levels: PalmaresLevel[],
  eventLabel: string,
  schools: number,
  students: number,
): void {
  const ws = wb.addWorksheet(sheetTitle, {
    views: [{ state: "frozen", ySplit: 2, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    },
  });
  ws.columns = [
    { width: 16 }, // MATRICULE
    { width: 34 }, // ÉCOLE
    { width: 18 }, // SECTEUR
    { width: 34 }, // NOM ET PRÉNOMS
    { width: 12 }, // MOYENNE
    { width: 8 }, // RANG
  ];

  const font = (size: number, bold = false, argb?: string) => ({
    name: "Arial",
    size,
    bold,
    ...(argb ? { color: { argb } } : {}),
  });
  const border = { style: "thin" as const, color: X_GREEN };
  const BOX = { top: border, left: border, bottom: border, right: border };

  let row = 1;
  ws.mergeCells(row, 1, row, 6);
  let c = ws.getCell(row, 1);
  c.value = `PALMARÈS D'EXCELLENCE — LES 10 MEILLEURS ÉLÈVES PAR NIVEAU (${sheetTitle})`;
  c.font = font(13, true);
  c.alignment = { horizontal: "center", vertical: "middle" };
  row += 1;
  ws.mergeCells(row, 1, row, 6);
  c = ws.getCell(row, 1);
  c.value = `${eventLabel} · ${schools} école(s) · ${students} élève(s) classé(s) · édité le ${todayFr()}`;
  c.font = font(10, false, "FF666666");
  c.alignment = { horizontal: "center", vertical: "middle" };
  row += 1;

  for (const lv of levels) {
    // Bandeau du niveau (vert, texte blanc).
    ws.mergeCells(row, 1, row, 6);
    c = ws.getCell(row, 1);
    c.value = `NIVEAU ${lv.level} — BARÈME /${levelScale(lv)}`;
    c.font = font(10, true, X_WHITE.argb);
    c.alignment = { horizontal: "left", vertical: "middle" };
    for (let col = 1; col <= 6; col++) {
      const cc = ws.getCell(row, col);
      cc.border = BOX;
      cc.fill = { type: "pattern", pattern: "solid", fgColor: X_GREEN };
    }
    row += 1;
    // En-têtes de colonnes (vert pâle, texte vert foncé).
    const headRow = ws.getRow(row);
    headRow.values = PALMARES_HEADERS;
    headRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: X_PALE };
      cell.font = font(9, true, X_SUB_TEXT.argb);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = BOX;
    });
    row += 1;
    // Lignes du top 10 (rang 1 sur fond doré pâle).
    const entries = sheetTitle === "FILLES" ? lv.filles : lv.garcons;
    if (!entries.length) {
      ws.mergeCells(row, 1, row, 6);
      c = ws.getCell(row, 1);
      c.value = "Aucun élève classé pour cet événement.";
      c.font = { ...font(9, false, "FF999999"), italic: true };
      for (let col = 1; col <= 6; col++) {
        ws.getCell(row, col).border = BOX;
      }
      row += 1;
      continue;
    }
    for (const e of entries) {
      const dataRow = ws.getRow(row);
      dataRow.values = [
        e.matricule,
        e.school || "—",
        e.sector || "—",
        e.full_name,
        e.average,
        e.rank,
      ];
      dataRow.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.border = BOX;
        cell.font = font(9, col === 4, undefined);
        cell.alignment = {
          horizontal: col === 2 || col === 4 ? "left" : "center",
          vertical: "middle",
        };
        if (e.rank === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: X_GOLD };
        }
        if (col === 5) cell.numFmt = "0.00";
      });
      dataRow.height = 16;
      row += 1;
    }
    row += 1; // respiration entre niveaux
  }
}

/** Export Excel : UN classeur, 2 feuilles FILLES / GARÇONS —
 *  « 1 tableau fille et 1 tableau garçon » comme demandé. */
export async function exportPalmaresExcel(data: PalmaresData, eventLabel: string): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";
  const schools = data.event?.schools ?? 0;
  const students = data.event?.students ?? 0;
  addPalmaresSheet(wb, "FILLES", data.levels ?? [], eventLabel, schools, students);
  addPalmaresSheet(wb, "GARÇONS", data.levels ?? [], eventLabel, schools, students);
  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: XLSX_MIME }),
    `${palmaresFileBase(eventLabel)}.xlsx`,
  );
}
