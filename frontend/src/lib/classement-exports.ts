"use client";

// === Exports du CLASSEMENT du module Résultats — PDF / Word / Excel
// (Task 27 : « dans le module résultat, classement, synthèse, générer le
// fichier en PDF, EXCEL et WORD ») ===
//
// La SYNTHÈSE du même module dispose déjà de ses 3 modèles (Task 26,
// synthese-document.tsx) ; ce module couvre le tableau de CLASSEMENT —
// exactement les données affichées (filtre classe respecté) — sans
// modifier l'existant.
//
// Respect de l'infrastructure Task 26 (lib/doc-export.tsx) :
//   - WORD  : enveloppe `buildWordShell` (.doc HTML MSO A4 portrait,
//     armoiries en base64 comme la liste des candidats) + `saveWordDoc` ;
//   - EXCEL : exceljs (import dynamique) — titres fusionnés, tableau bordé
//     fond vert drapeau, stats + mentions en pied, impression portrait
//     ajustée, `saveBlob` + `XLSX_MIME` ;
//   - PDF   : le classement n'a pas de route d'impression dédiée → iframe
//     caché imprimable (boîte « Enregistrer au format PDF » du navigateur),
//     même corps HTML que le Word, en-tête institutionnel FIDÈLE aux
//     documents SYGREN (textes repris à l'identique du document de Synthèse).
//
// NB — pas de verrou canPrintDocument ici : le classement est une vue de
// travail (pas un document officiel) ; ses données sont déjà consultables
// par les rôles du module Résultats.

import { buildWordShell, saveBlob, saveWordDoc, slugFile, XLSX_MIME } from "@/lib/doc-export";
import type { StudentResult } from "@/lib/types";
import { monthLabel } from "@/lib/session-utils";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

/** Statistiques agrégées affichées avec le classement
 *  (SessionResults.statistics — sous-ensemble utilisé par les exports). */
export interface ClassementStats {
  class_average: number;
  max_average: number;
  min_average: number;
  median_average: number;
  pass_rate: number;
  distinction_rate: number;
  mention_distribution: Record<string, number>;
}

/** Infos IEP pour l'en-tête institutionnel (endpoint synthese-data —
 *  RBAC vérifié côté handler ; les rôles sans accès obtiennent null →
 *  en-tête simplifié). */
export interface ClassementHeaderInfo {
  iep_region: string;
  iep_name: string;
  iep_bp: string;
  inspector_phone: string;
  school_name: string;
}

export interface ClassementExportInput {
  /** Nom de l'école (SessionResults.school_name). */
  schoolName: string;
  /** Libellé complet : « COMPOSITION N°1 DU MOIS DE MAI 2025 ». */
  sessionLabel: string;
  /** « Toutes les classes » ou le nom de la classe filtrée. */
  filterLabel: string;
  /** Lignes de classement (déjà filtrées par classe côté vue). */
  rows: StudentResult[];
  stats: ClassementStats;
  /** Barème agrégé de repli (SessionResults.average_scale = 20). */
  aggregateScale: number;
  /** Infos IEP — null → en-tête simplifié centré. */
  header: ClassementHeaderInfo | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Couleurs du décor ivoirien (mêmes valeurs que components/ci-decor)
// ─────────────────────────────────────────────────────────────────────────

const CI_GREEN = "#009E60";
const CI_GREEN_BG = "#E4F4ED";
const CI_GREEN_TEXT = "#00734A";
const CI_ORANGE_BG = "#FDEBDA";

/** DATE DU JOUR au format jj/mm/aaaa (« Édité le … »). */
function todayFr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Échappe le texte pour un fragment HTML. */
function escHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────
// Corps HTML commun (PDF + Word) — en-tête institutionnel fidèle
// ─────────────────────────────────────────────────────────────────────────

/** En-tête institutionnel — textes repris À L'IDENTIQUE du document de
 *  Synthèse (tableau 2 colonnes sans bordures). `armoiriesImg` : balise
 *  <img> prête à l'emploi (URL absolue pour le PDF, base64 pour Word,
 *  chaîne vide pour un en-tête texte seul). */
function buildHeaderHtml(info: ClassementExportInput, armoiriesImg: string): string {
  if (!info.header) {
    // Repli : en-tête simplifié (infos IEP indisponibles pour ce rôle).
    return `<table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:8px;">
  <tr><td style="border:none; text-align:center; padding:0;">
    <p style="font-weight:bold; font-size:11pt; margin:0;">ÉCOLE : ${escHtml(info.schoolName)}</p>
  </td></tr>
</table>
<hr color="${CI_GREEN}" style="border:none; border-top:1.5px solid ${CI_GREEN}; margin:6px 0 12px 0;">`;
  }
  const left = `
    <p style="font-weight:bold; margin:0;">République de Côte d'Ivoire</p>
    <p style="font-weight:bold; margin:0;">Ministère de l'Éducation Nationale</p>
    <p style="font-weight:bold; margin:0;">Et de l'Alphabétisation</p>
    <p style="font-weight:bold; margin:0;">Direction Régionale de ${escHtml(info.header.iep_region || "..............")}</p>
    <p style="font-weight:bold; margin:0;">Inspection de l'Enseignement</p>
    <p style="font-weight:bold; margin:0;">Préscolaire et Primaire de ${escHtml(info.header.iep_name || "..............")}</p>
    <p style="font-weight:bold; margin:0;">BP : ${escHtml(info.header.iep_bp || ".........")} / Tél : ${escHtml(info.header.inspector_phone || "............")}</p>`;
  const right = `
    <p style="font-weight:bold; margin:0 0 4px 0;">Union - Discipline - Travail</p>
    ${armoiriesImg}
    <p style="font-weight:bold; margin:4px 0 0 0;">ÉCOLE : ${escHtml(info.schoolName)}</p>`;
  return `<table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:8px;">
  <tr>
    <td width="62%" style="border:none; font-size:9pt; text-align:left; vertical-align:top; padding:0;">${left}</td>
    <td width="38%" style="border:none; font-size:9pt; text-align:right; vertical-align:top; padding:0;">${right}</td>
  </tr>
</table>
<hr color="${CI_GREEN}" style="border:none; border-top:1.5px solid ${CI_GREEN}; margin:6px 0 12px 0;">`;
}

/** Boîte de titre centrée (bordure verte, fond pastel orange) — table
 *  1 cellule : rendu fiable dans l'impression navigateur ET dans Word. */
function buildTitleBoxHtml(title: string, subtitle: string): string {
  return `<table width="72%" align="center" cellspacing="0" cellpadding="0" style="border:2.2px solid ${CI_GREEN}; background:${CI_ORANGE_BG}; margin:0 auto 12px auto;">
  <tr>
    <td style="border:none; background:${CI_ORANGE_BG}; text-align:center; padding:6px 20px;">
      <div style="font-size:15pt; font-weight:bold; letter-spacing:1px; color:#000;">${escHtml(title)}</div>
      <div style="font-size:10.5pt; font-weight:bold; margin-top:2px; color:${CI_GREEN_TEXT};">${escHtml(subtitle)}</div>
    </td>
  </tr>
</table>`;
}

/** Bloc statistiques 2 colonnes × 3 lignes (sans bordures). */
function buildStatsHtml(stats: ClassementStats, scale: number): string {
  const fmt = (v: number) => (v > 0 ? `${v.toFixed(2)} / ${scale}` : "—");
  const cell = (label: string, value: string) =>
    `<td style="border:none; padding:2px 10px; font-size:9.5pt; vertical-align:top;">
       <b style="color:${CI_GREEN_TEXT};">${escHtml(label)}</b> : ${escHtml(value)}
     </td>`;
  return `<table width="100%" cellspacing="0" cellpadding="0" style="margin:0 auto 12px auto;">
  <tr>${cell("Moyenne de classe", fmt(stats.class_average))}${cell("Taux de réussite", `${stats.pass_rate.toFixed(0)} %`)}</tr>
  <tr>${cell("Meilleure moyenne", fmt(stats.max_average))}${cell("Taux de distinction", `${stats.distinction_rate.toFixed(0)} %`)}</tr>
  <tr>${cell("Moyenne la plus basse", fmt(stats.min_average))}${cell("Médiane", fmt(stats.median_average))}</tr>
</table>`;
}

const CELL_BASE = `border:1px solid ${CI_GREEN}; padding:3px 6px; vertical-align:middle;`;
const TH_STYLE = `${CELL_BASE} background:${CI_GREEN}; color:#ffffff; font-weight:bold; text-align:center; font-size:9pt;`;

/** Corps HTML complet du CLASSEMENT — mêmes données que la vue.
 *  `armoiriesImg` : balise img (PDF : URL absolue ; Word : base64 ; vide :
 *  sans armoiries). */
export function buildClassementBodyHtml(input: ClassementExportInput, armoiriesImg: string): string {
  const scale = input.aggregateScale;
  const passThreshold = scale / 2;

  const bodyRows = input.rows
    .map((r, i) => {
      const bg = i % 2 === 1 ? ` background:${CI_GREEN_BG};` : "";
      const moyenne = r.has_average
        ? `${r.average.toFixed(2)} / ${r.average_scale ?? scale}`
        : "—";
      const td = (extra = "", align = "left") =>
        `<td style="${CELL_BASE}${bg} text-align:${align};">${extra}</td>`;
      return `<tr>
  ${td(`<b>${escHtml(r.rank_label)}</b>`, "center")}
  ${td(`<span style="font-family:Consolas,monospace;">${escHtml(r.matricule)}</span>`)}
  ${td(`<b>${escHtml(`${r.last_name} ${r.first_name}`)}</b>`)}
  ${td(escHtml(r.class_name || "—"))}
  ${td(`<b>${escHtml(moyenne)}</b>`, "center")}
  ${td(escHtml(r.mention || "—"), "center")}
  ${td(`${r.graded_count}/${r.total_subjects}`, "center")}
</tr>`;
    })
    .join("\n");

  const emptyRow =
    input.rows.length === 0
      ? `<tr><td colspan="7" style="${CELL_BASE} text-align:center; padding:12px;">Aucun élève pour ce filtre.</td></tr>`
      : "";

  return `${buildHeaderHtml(input, armoiriesImg)}
${buildTitleBoxHtml("CLASSEMENT DES ÉLÈVES", input.sessionLabel)}
<p style="font-size:9pt; text-align:center; margin:0 0 10px 0;">
  École : <b>${escHtml(input.schoolName)}</b> — Classe : <b>${escHtml(input.filterLabel)}</b>
  — Édité le ${todayFr()} — ${input.rows.length} élève(s)
</p>
${buildStatsHtml(input.stats, scale)}
<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; font-size:9.5pt; color:#000;">
  <thead>
    <tr style="display:table-header-group;">
      <th style="${TH_STYLE} width:7%;">Rang</th>
      <th style="${TH_STYLE} width:13%;">Matricule</th>
      <th style="${TH_STYLE}">Nom &amp; Prénoms</th>
      <th style="${TH_STYLE} width:10%;">Classe</th>
      <th style="${TH_STYLE} width:13%;">Moyenne</th>
      <th style="${TH_STYLE} width:14%;">Mention</th>
      <th style="${TH_STYLE} width:9%;">Notes</th>
    </tr>
  </thead>
  <tbody>
    ${bodyRows}
    ${emptyRow}
  </tbody>
</table>
<p style="font-size:8pt; color:#555555; margin-top:8px;">
  Seuil de réussite : moyenne &ge; ${passThreshold} / ${scale}. Moyennes calculées sur le barème propre à chaque niveau (CP/CE : /10, CM : /20).
</p>`;
}

/** Nom de fichier de base du classement (sans extension, slugifié). */
export function classementFileBase(input: {
  schoolName: string;
  sessionLabel: string;
  filterLabel: string;
}): string {
  return slugFile(`classement ${input.schoolName} ${input.sessionLabel} ${input.filterLabel}`);
}

// ─────────────────────────────────────────────────────────────────────────
// PDF — impression navigateur via iframe caché (pas de route dédiée)
// ─────────────────────────────────────────────────────────────────────────

function buildPrintHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${escHtml(title)}</title>
<style>
@page { size: A4 portrait; margin: 12mm; }
html, body { margin: 0; padding: 0; }
body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 11px;
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
table { border-collapse: collapse; }
p { margin: 4px 0; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

/** Imprime le classement dans un iframe caché — le navigateur propose
 *  « Enregistrer au format PDF » (titre = nom de fichier suggéré). Les
 *  images (armoiries) sont attendues AVANT l'impression ; l'iframe est
 *  retiré après (onafterprint + filet de sécurité 120 s). */
export function printClassementToPdf(input: ClassementExportInput, title: string): Promise<void> {
  const armoiriesImg = input.header
    ? `<img src="${window.location.origin}/ci-coat-of-arms.png" width="60" height="60" alt="" style="width:60px;height:60px;object-fit:contain;">`
    : "";
  const bodyHtml = buildClassementBodyHtml(input, armoiriesImg);
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
    doc.write(buildPrintHtml(title, bodyHtml));
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
// WORD — .doc HTML MSO (enveloppe partagée doc-export)
// ─────────────────────────────────────────────────────────────────────────

/** Armoiries en base64 (meilleur effort — chaîne vide si indisponible). */
async function armoiriesBase64(): Promise<string> {
  try {
    const res = await fetch("/ci-coat-of-arms.png");
    if (!res.ok) return "";
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:image/png;base64,${btoa(bin)}`;
  } catch {
    return "";
  }
}

/** Génère et télécharge le classement en Word (.doc) — A4 portrait,
 *  marge 12 mm, thead répété à chaque page (table-header-group). */
export async function exportClassementWord(
  input: ClassementExportInput,
  filename: string,
): Promise<void> {
  const b64 = await armoiriesBase64();
  const armoiriesImg = b64
    ? `<img src="${b64}" width="60" height="60" alt="" style="width:60px;height:60px;object-fit:contain;">`
    : "";
  const html = buildWordShell({
    title: "Classement des élèves",
    orientation: "portrait",
    marginMm: 12,
    styles: `table { border-collapse:collapse; }
th, td { border:1px solid ${CI_GREEN}; padding:3px 6px; }
p { margin:0 0 4px 0; }`,
    bodyHtml: buildClassementBodyHtml(input, armoiriesImg),
  });
  saveWordDoc(html, filename);
}

// ─────────────────────────────────────────────────────────────────────────
// EXCEL — .xlsx exceljs (import dynamique, convention Task 26)
// ─────────────────────────────────────────────────────────────────────────

const EXCEL_BORDER = { style: "thin" as const, color: { argb: "FF000000" } };
const EXCEL_BOX = {
  top: EXCEL_BORDER,
  left: EXCEL_BORDER,
  bottom: EXCEL_BORDER,
  right: EXCEL_BORDER,
};

/** Génère et télécharge le classement en Excel (.xlsx) : titres fusionnés,
 *  tableau bordé (fond vert drapeau, zebra pastel), statistiques +
 *  répartition des mentions en pied, impression portrait ajustée. */
export async function exportClassementExcel(
  input: ClassementExportInput,
  filename: string,
): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";
  const ws = wb.addWorksheet("Classement", {
    views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printTitlesRow: "6:6",
    },
  });
  ws.columns = [8, 14, 30, 10, 13, 15, 9].map((width) => ({ width }));

  const font = (size: number, bold = false, argb?: string) => ({
    name: "Arial",
    size,
    bold,
    ...(argb ? { color: { argb } } : {}),
  });

  // Titres fusionnés sur les 7 colonnes.
  const titles = [
    { text: "CLASSEMENT DES ÉLÈVES", size: 14, bold: true },
    { text: input.sessionLabel, size: 11, bold: true, color: "FF00734A" },
    { text: `ÉCOLE : ${input.schoolName}`, size: 10, bold: true },
    {
      text: `Classe : ${input.filterLabel} — Édité le ${todayFr()} — ${input.rows.length} élève(s)`,
      size: 9,
      bold: false,
    },
  ];
  titles.forEach((t, i) => {
    const row = i + 1;
    ws.mergeCells(row, 1, row, 7);
    const c = ws.getCell(row, 1);
    c.value = t.text;
    c.font = font(t.size, t.bold, t.color);
    c.alignment = { horizontal: "center", vertical: "middle" };
  });

  // Ligne d'en-têtes (row 6) — fond vert drapeau, blanc gras.
  const headers = ["Rang", "Matricule", "Nom & Prénoms", "Classe", "Moyenne", "Mention", "Notes"];
  const headerRow = ws.getRow(6);
  headers.forEach((h, i) => {
    const c = headerRow.getCell(i + 1);
    c.value = h;
    c.font = font(10, true, "FFFFFFFF");
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF009E60" } };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = EXCEL_BOX;
  });

  // Données — zebra pastel, moyenne en gras.
  input.rows.forEach((r, i) => {
    const row = ws.getRow(7 + i);
    const zebra = i % 2 === 1 ? { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE4F4ED" } } : undefined;
    const moyenne = r.has_average
      ? `${r.average.toFixed(2)} / ${r.average_scale ?? input.aggregateScale}`
      : "—";
    const values = [
      r.rank_label,
      r.matricule,
      `${r.last_name} ${r.first_name}`,
      r.class_name || "—",
      moyenne,
      r.mention || "—",
      `${r.graded_count}/${r.total_subjects}`,
    ];
    values.forEach((v, j) => {
      const c = row.getCell(j + 1);
      c.value = v;
      c.font = font(9, j === 0 || j === 2 || j === 4);
      c.alignment = { horizontal: j === 2 ? "left" : "center", vertical: "middle", wrapText: j === 2 };
      c.border = EXCEL_BOX;
      if (zebra) c.fill = zebra;
    });
  });

  // Pied : statistiques + répartition des mentions.
  const scale = input.aggregateScale;
  const nf = (v: number) => (v > 0 ? v.toFixed(2) : "—");
  const statsRows: [string, string][] = [
    ["Moyenne de classe", nf(input.stats.class_average)],
    ["Meilleure moyenne", nf(input.stats.max_average)],
    ["Moyenne la plus basse", nf(input.stats.min_average)],
    ["Médiane", nf(input.stats.median_average)],
    ["Taux de réussite (%)", input.stats.pass_rate.toFixed(0)],
    ["Taux de distinction (%)", input.stats.distinction_rate.toFixed(0)],
    ...Object.entries(input.stats.mention_distribution).map(
      ([mention, count]) => [`Mention — ${mention}`, String(count)] as [string, string],
    ),
  ];
  const footerStart = 7 + input.rows.length + 1; // 1 ligne vide de respiration
  statsRows.forEach(([label, value], i) => {
    const row = ws.getRow(footerStart + i);
    const lc = row.getCell(1);
    lc.value = label;
    lc.font = font(9, true, "FF00734A");
    const vc = row.getCell(2);
    vc.value = value;
    vc.font = font(9, false);
  });

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: XLSX_MIME }), filename);
}

/** Libellé de session complet depuis eval_type / eval_number / mois / an. */
export function classementSessionLabel(
  evalTypeLabel: string,
  evalNumber: number,
  month: number,
  year: number,
): string {
  return `${evalTypeLabel || "Évaluation"} N°${evalNumber} du mois de ${monthLabel(month)} ${year}`.toUpperCase();
}
