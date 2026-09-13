"use client";

// v3 — EMBELLISSEMENT DRAPEAU CI (inspiré des bulletins individuels) :
// l'ancien BLEU MARINE cède la place aux couleurs du drapeau ivoirien —
// entêtes du tableau sur FOND VERT DRAPEAU (texte blanc), bordures
// vertes, labels en vert foncé, boîte du titre sur fond pastel orange
// bordé de vert, armoiries en filigrane conservées.
// v4 (demande utilisateur) : rubans tricolores haut/bas SUPPRIMÉS ;
// mention de périmètre (« CP1 au CM1 » / « CM2 fin de cycle ») retirée
// du document ; « Fait à …, le … » = DATE DU JOUR automatique.
// v5 — 3 MODÈLES D'IMPRESSION (demande utilisateur : « étendre les 3
// modèles PDF / Word / Excel à tous les documents, en respectant les
// en-têtes d'origine ») : le bouton PDF unique cède la place à la barre
// uniforme DocExportButtons — Word (.doc HTML MSO A4 PAYSAGE, même
// orientation que la route /synthese : app/synthese/print.css) et Excel
// (.xlsx exceljs, pageSetup paysage ajusté à 1 page de large) reproduisent
// fidèlement le document PDF : en-tête institutionnel exact (bloc
// ministériel + République), boîte du titre, tableau (G/F/T par classe),
// lignes FILLES/GARÇONS, % global et signatures Le Directeur /
// L'Inspecteur avec leurs noms. (Ce document n'affiche AUCUN nom d'élève —
// statistiques agrégées — donc pas de noms de filles en rouge ici.)
import { useQuery } from "@tanstack/react-query";
import { X, Loader2 } from "lucide-react";
import { useState } from "react";
import { reportsApi } from "@/lib/api";
import { monthLabel } from "@/lib/session-utils";
import {
  DocExportButtons,
  XLSX_MIME,
  buildWordShell,
  escHtml,
  saveBlob,
  saveWordDoc,
  slugFile,
} from "@/lib/doc-export";
import { CIArmoiriesWatermark, CI_GREEN, CI_GREEN_BG, CI_GREEN_TEXT, CI_ORANGE_BG, PRINT_COLOR_STYLE } from "@/components/ci-decor";
import { canPrintDocument, PrintLockBadge, PrintLockDocumentMessage, usePrintRole } from "@/lib/print-guard";

interface LevelData {
  class_name: string;
  inscrits: [number, number, number];
  presents: [number, number, number];
  admis: [number, number, number];
  pct_admis: [number, number, number];
}
interface Totals {
  inscrits_g: number; inscrits_f: number; inscrits_t: number;
  presents_g: number; presents_f: number; presents_t: number;
  admis_g: number; admis_f: number; admis_t: number;
  pct_g: number; pct_f: number; pct_t: number;
}
interface SyntheseData {
  iep_name: string;
  iep_region: string;
  school_name: string;
  school_code: string;
  school_addr: string;
  eval_label: string;
  eval_number: number;
  month: number;
  year: number;
  levels: LevelData[];
  totals: Totals;
  // Transmis par le backend pour adapter le titre + le rendu.
  level_group: "primary" | "cm2" | "all";
  // Toujours transmis par le backend mais PLUS AFFICHÉ dans le document
  // (demande utilisateur : retirer « CP1 au CM1 » / « CM2 fin de cycle »).
  document_label: string;
  // === Infos pour les signatures et l'en-tête ===
  director_name: string;
  inspector_name: string;
  inspector_email: string;
  inspector_phone: string;
  iep_bp: string;
}

// FIX BUG #1 : CM2 était absent → le tableau ne montrait que 5 classes au lieu de 6.
// Les 6 niveaux de l'école primaire ivoirienne : CP1, CP2, CE1, CE2, CM1, CM2.
//
// === Séparation en 2 documents (cahier des charges) ===
// Le document de synthèse est désormais scindé en deux :
//   1. Document principal (level_group=primary) → CP1 au CM1 (5 classes)
//   2. Document CM2 dédié (level_group=cm2) → CM2 seul (fin de cycle primaire)
// CLASS_NAMES est maintenant DYNAMIQUE : il se base sur la réponse du backend
// (data.levels) plutôt que sur une constante codée en dur.
const ALL_CLASS_NAMES = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"] as const;
/** Vert assombri pour les libellés (contraste à l'impression). */
const LABEL_GREEN = CI_GREEN_TEXT;
/** Encre des données (noir pur, lisible à l'impression). */
const INK_DOC = "#000000";

/** Formatage d'un effectif : « — » si 0 (cases non pertinentes du PDF).
 *  PARTAGÉ par le rendu PDF et les modèles Word/Excel (mêmes valeurs). */
const fmt = (v: number) => (v > 0 ? String(v) : "—");
/** Pourcentage : arrondi à 2 décimales, « — » si 0. Partagé également. */
const fmtPct = (v: number) => (v > 0 ? (Math.round(v * 100) / 100).toString() : "—");

/** DATE DU JOUR au format jj/mm/aaaa — « Fait à …, le … » du document
 *  (demande utilisateur : la date s'écrit AUTOMATIQUEMENT). Même
 *  convention que le bulletin de fin d'année (end-of-year-bulletin.tsx). */
function todayFr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ============================================================ 3 MODÈLES ===

// Données nécessaires aux modèles Word/Excel — TOUTES proviennent de la
// réponse reportsApi.getSyntheseData (rien de nouveau à exiger du backend :
// le nom du directeur et celui de l'inspecteur sont déjà transmis).
interface ExportData {
  iepName: string;
  iepRegion: string;
  iepBp: string;
  inspectorPhone: string;
  schoolName: string;
  evalLabel: string;
  evalNumber: number;
  month: number;
  year: number;
  /** Niveaux dans l'ordre canonique (CLASS_NAMES) — colonnes du tableau. */
  classLevels: LevelData[];
  totals: Totals;
  /** Périmètre du document — sert au nom de fichier (doc CM2 dédié). */
  levelGroup: "primary" | "cm2" | "all";
  directorName: string;
  inspectorName: string;
}

/** Nom de fichier commun aux deux modèles :
 *  synthese-<école>[-cm2]-eval<N>-<mois>-<année>.doc/.xlsx */
function exportFileBase(o: ExportData): string {
  const grp = o.levelGroup === "cm2" ? "-cm2" : "";
  return `synthese-${slugFile(o.schoolName)}${grp}-eval${o.evalNumber}-${slugFile(monthLabel(o.month))}-${o.year}`;
}

// === MODÈLE WORD (.doc) — HTML MSO A4 PAYSAGE fidèle au document PDF ===
// Même orientation que la route /synthese (print.css : @page 297mm 210mm).
// En-tête institutionnel exact (bloc ministériel + République), trait vert,
// boîte du titre, tableau (thead répété à chaque page par Word via
// display:table-header-group), lignes FILLES/GARÇONS + % global, signatures
// Le Directeur / L'Inspecteur avec leurs noms. Les armoiries ne sont pas
// reproduites dans le .doc (Word n'affiche pas les images des fichiers HTML
// de façon fiable — même choix que le modèle fin d'année) ; elles le sont
// dans le classeur Excel.
function buildWordHtml(o: ExportData): string {
  const esc = escHtml;
  const classes = o.classLevels.map((l) => l.class_name);
  const totalCols = 1 + classes.length * 3;
  const half = Math.floor(totalCols / 2);

  // Styles du tableau — mêmes couleurs drapeau que le PDF.
  const thCls = "border:1px solid #009E60; background:#009E60; color:#fff; padding:4px; text-align:center; font-size:10px;";
  const thClsWide = thCls.replace("padding:4px", "padding:6px");
  const labelCls = "border:1px solid #009E60; padding:6px 8px; background:#FDEBDA; font-weight:bold; color:#00734A;";
  const cellCls = "border:1px solid #009E60; padding:6px; text-align:center; font-weight:bold;";
  const recapCls = "border:1px solid #009E60; padding:8px; text-align:center; font-size:12px; font-weight:bold; background:#E4F4ED; color:#00734A;";

  // Une ligne de données (INSCRITS / PRÉSENTS / ADMIS / % ADMIS) — fond
  // vert pastel une classe sur deux, « — » si 0 (comme le PDF).
  const dataRow = (label: string, key: "inscrits" | "presents" | "admis" | "pct_admis"): string => {
    const isPct = key === "pct_admis";
    const fmtFn = isPct ? fmtPct : fmt;
    const cells = o.classLevels
      .map((lvl, ci) => {
        const bg = ci % 2 === 0 ? " background:#E4F4ED;" : "";
        const vals = lvl[key];
        return (
          `<td style="${cellCls}${bg}">${esc(fmtFn(vals[0]))}</td>` +
          `<td style="${cellCls}${bg}">${esc(fmtFn(vals[1]))}</td>` +
          `<td style="${cellCls}${bg}">${esc(fmtFn(vals[2]))}</td>`
        );
      })
      .join("");
    return `<tr><td style="${labelCls}">${esc(label)}</td>${cells}</tr>`;
  };

  // Nom signataire (placeholder points comme le PDF si absent).
  const sigName = (n: string) => esc((n || "").trim()) || "................................";

  // En-tête institutionnel — copie de la structure JSX du composant.
  // Le vide de 60px remplace l'image des armoiries (voir note ci-dessus)
  // afin de préserver la position de la ligne « ÉCOLE : … ».
  const head = `
<table class=hdr><tr>
<td style="width:70%; font-size:10px; font-weight:bold; line-height:1.5; text-align:left;">
<p>R&eacute;publique de C&ocirc;te d'Ivoire</p>
<p>Minist&egrave;re de l'&Eacute;ducation Nationale</p>
<p>Et de l'Alphab&eacute;tisation</p>
<p>Direction R&eacute;gionale de ${esc(o.iepRegion)}</p>
<p>Inspection de l'Enseignement</p>
<p>Pr&eacute;scolaire et Primaire de ${esc(o.iepName)}</p>
<p>BP : ${esc(o.iepBp || ".........")} / T&eacute;l : ${esc(o.inspectorPhone || "............")}</p>
</td>
<td style="width:30%; text-align:right; font-size:10px; font-weight:bold;">
<p>Union - Discipline - Travail</p>
<div style="height:60px;">&nbsp;</div>
<p>&Eacute;COLE : ${esc(o.schoolName)}</p>
</td>
</tr></table>
<hr style="border:none; border-top:1.5px solid #009E60; margin:8px 0 12px;">
`;

  // Boîte du titre (bord vert drapeau sur fond pastel orange, comme le PDF).
  const title = `
<table align=center style="border-collapse:collapse; margin:0 0 16px;"><tr>
<td style="border:2.2px solid #009E60; background:#FDEBDA; border-radius:10px; padding:5px 48px 6px; text-align:center;">
<p style="font-size:16px; font-weight:bold; letter-spacing:1px;">SYNTH&Egrave;SE DES RESULTATS</p>
<p style="font-size:12px; font-weight:bold; margin-top:2px; color:#00734A;">${esc(o.evalLabel.toUpperCase())} N&deg;${o.evalNumber} DU MOIS DE ${esc(monthLabel(o.month).toUpperCase())} ${o.year}</p>
</td>
</tr></table>
`;

  // Tableau de synthèse — mêmes colonnes/ordres que le PDF : 1 label +
  // N classes × 3 (G/F/T) ; entêtes sur fond vert drapeau (texte blanc).
  const clsW = (95 / classes.length).toFixed(2);
  const colgroup =
    `<col style="width:5%">` +
    classes
      .map(() => `<col style="width:${clsW}%"><col style="width:${clsW}%"><col style="width:${clsW}%">`)
      .join("");
  const clsHeads = classes.map((cn) => `<th colspan=3 style="${thClsWide}">${esc(cn)}</th>`).join("");
  const subHeads = classes
    .map(() => `<th style="${thCls}">G</th><th style="${thCls}">F</th><th style="${thCls}">T</th>`)
    .join("");
  const table = `
<table class=doc>
<colgroup>${colgroup}</colgroup>
<thead class=rep>
<tr><th style="${thCls}; width:5%;"></th>${clsHeads}</tr>
<tr><th style="${thCls}"></th>${subHeads}</tr>
</thead>
<tbody>
${dataRow("INSCRITS", "inscrits")}
${dataRow("PRÉSENTS", "presents")}
${dataRow("ADMIS", "admis")}
${dataRow("% ADMIS", "pct_admis")}
<tr>
<td colspan=${half} style="${recapCls}">FILLES : ${esc(fmtPct(o.totals.pct_f))} %</td>
<td colspan=${totalCols - half} style="${recapCls}">GAR&Ccedil;ONS : ${esc(fmtPct(o.totals.pct_g))} %</td>
</tr>
<tr><td colspan=${totalCols} style="border:1px solid #009E60; padding:10px; text-align:center; font-size:14px; background:#FDEBDA; font-weight:bold;">${esc(fmtPct(o.totals.pct_t))} %</td></tr>
</tbody>
</table>
`;

  // Signatures — mêmes blocs que le PDF (Le Directeur à gauche,
  // « Fait à … » + L'Inspecteur à droite), noms en majuscules.
  const sigs = `
<table class=sig><tr>
<td style="width:40%; text-align:center; vertical-align:bottom; border:none;">
<p style="font-size:12px; font-weight:bold; text-decoration:underline;">Le Directeur</p>
<div style="height:60px;">&nbsp;</div>
<p style="font-size:11px; font-weight:bold; text-transform:uppercase;">${sigName(o.directorName)}</p>
</td>
<td style="width:20%; border:none;">&nbsp;</td>
<td style="width:40%; text-align:right; vertical-align:bottom; border:none;">
<p style="font-size:11px; margin-bottom:20px;">Fait &agrave; ${esc(o.iepRegion)}, le ${todayFr()}</p>
<p style="font-size:12px; font-weight:bold; text-decoration:underline;">L'Inspecteur</p>
<div style="height:40px;">&nbsp;</div>
<p style="font-size:11px; font-weight:bold; text-transform:uppercase;">${sigName(o.inspectorName)}</p>
</td>
</tr></table>
`;

  return buildWordShell({
    title: `Synthèse des résultats ${o.year} — ${o.schoolName}`,
    orientation: "landscape",
    // Le PDF imprime avec @page margin 0 + padding interne 20px (~5,3mm) ;
    // Word répartit la marge sur CHAQUE page → 5,3mm pour rester fidèle.
    marginMm: 5.3,
    styles: `
table.hdr { border-collapse:collapse; width:100%; }
table.hdr td { border:none; vertical-align:top; }
table.doc { border-collapse:collapse; width:100%; table-layout:fixed; font-size:10px; font-weight:bold; }
thead.rep { display:table-header-group; }
table.sig { border-collapse:collapse; width:100%; margin-top:40px; }
`,
    bodyHtml: `${head}${title}${table}${sigs}`,
  });
}

// === MODÈLE EXCEL (.xlsx) — classeur mis en page (exceljs) ===
// Même orientation PAYSAGE que le PDF, ajusté à 1 page de large ; en-tête
// institutionnel fusionné, entêtes du tableau sur FOND VERT DRAPEAU (texte
// blanc), lignes FILLES/GARÇONS + % global, signatures Le Directeur /
// L'Inspecteur avec leurs noms ; armoiries en meilleur effort.
async function exportSyntheseExcelAsync(o: ExportData): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";
  const classes = o.classLevels.map((l) => l.class_name);
  const totalCols = 1 + classes.length * 3;
  const half = Math.floor(totalCols / 2);

  const ws = wb.addWorksheet("Synthese", {
    views: [{ state: "frozen", ySplit: 10, showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape", // même orientation que le PDF (/synthese)
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      printTitlesRow: "9:10", // entêtes du tableau répétés à l'impression
    },
  });
  ws.columns = [14, ...Array.from({ length: totalCols - 1 }, () => ({ width: 6 }))];

  const font = (size: number, bold = false, argb?: string) => ({
    name: "Arial",
    size,
    bold,
    ...(argb ? { color: { argb } } : {}),
  });
  const GREEN = { argb: "FF009E60" };
  const GREEN_TXT = { argb: "FF00734A" };
  const ORANGE_BG = { argb: "FFFDEBDA" };
  const GREEN_BG = { argb: "FFE4F4ED" };
  const border = { style: "thin" as const, color: GREEN };
  const BOX = { top: border, left: border, bottom: border, right: border };

  // Ligne fusionnée sur toute la largeur (en-tête institutionnel).
  const merged = (row: number, text: string, size: number, bold = false, italic = false, argb?: string) => {
    ws.mergeCells(row, 1, row, totalCols);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: "Arial", size, bold, italic, ...(argb ? { color: { argb } } : {}) };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  };

  // --- En-tête institutionnel (fidèle au modèle PDF) ---
  merged(1, "République de Côte d'Ivoire — Ministère de l'Éducation Nationale et de l'Alphabétisation", 12, true);
  merged(2, `Direction Régionale de ${(o.iepRegion || "…………").toUpperCase()} — Inspection de l'Enseignement Préscolaire et Primaire de ${(o.iepName || "…………").toUpperCase()}`, 11, true, true);
  merged(3, `BP : ${o.iepBp || "........."} / Tél : ${o.inspectorPhone || "............"}`, 11);
  merged(4, "Union - Discipline - Travail", 11, true);
  merged(5, "SYNTHÈSE DES RESULTATS", 14, true);
  for (let col = 1; col <= totalCols; col++) ws.getCell(5, col).border = BOX;
  merged(6, `${o.evalLabel.toUpperCase()} N°${o.evalNumber} DU MOIS DE ${monthLabel(o.month).toUpperCase()} ${o.year}`, 11, true, false, GREEN_TXT.argb);
  ws.mergeCells(7, 1, 7, totalCols);
  const ecole = ws.getCell(7, 1);
  ecole.value = `ÉCOLE : ${o.schoolName}`;
  ecole.font = font(11, true);
  ecole.alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(8).height = 4;

  // --- Entêtes du tableau (2 rangées, fusions comme le PDF) ---
  ws.mergeCells(9, 1, 10, 1); // coin vide sur 2 rangées
  classes.forEach((cn, k) => {
    const c0 = 2 + k * 3;
    ws.mergeCells(9, c0, 9, c0 + 2);
    ws.getCell(9, c0).value = cn;
    ["G", "F", "T"].forEach((lbl, j) => {
      ws.getCell(10, c0 + j).value = lbl;
    });
  });
  for (let r = 9; r <= 10; r++) {
    const row = ws.getRow(r);
    row.height = r === 9 ? 16 : 14;
    row.eachCell({ includeEmpty: true }, (c) => {
      c.font = font(10, true, "FFFFFFFF");
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.border = BOX;
      c.fill = { type: "pattern", pattern: "solid", fgColor: GREEN };
    });
  }

  // --- Lignes de données (INSCRITS / PRÉSENTS / ADMIS / % ADMIS) ---
  // Fond vert pastel une classe sur deux, « — » si 0 (comme le PDF).
  const dataRows: Array<[string, "inscrits" | "presents" | "admis" | "pct_admis"]> = [
    ["INSCRITS", "inscrits"],
    ["PRÉSENTS", "presents"],
    ["ADMIS", "admis"],
    ["% ADMIS", "pct_admis"],
  ];
  dataRows.forEach(([label, key], ri) => {
    const r = 11 + ri;
    const isPct = key === "pct_admis";
    const row = ws.getRow(r);
    row.height = 16;
    const lab = ws.getCell(r, 1);
    lab.value = label;
    lab.font = font(10, true, GREEN_TXT.argb);
    lab.fill = { type: "pattern", pattern: "solid", fgColor: ORANGE_BG };
    lab.alignment = { horizontal: "left", vertical: "middle" };
    o.classLevels.forEach((lvl, ci) => {
      const vals = lvl[key];
      const c0 = 2 + ci * 3;
      vals.forEach((v, j) => {
        const c = ws.getCell(r, c0 + j);
        c.value = v > 0 ? (isPct ? Math.round(v * 100) / 100 : v) : "—";
        if (isPct && v > 0) c.numFmt = "0.##";
        c.font = font(10, true);
        c.alignment = { horizontal: "center", vertical: "middle" };
        if (ci % 2 === 0) {
          c.fill = { type: "pattern", pattern: "solid", fgColor: GREEN_BG };
        }
      });
    });
    for (let col = 1; col <= totalCols; col++) ws.getCell(r, col).border = BOX;
  });

  // --- Lignes FILLES / GARÇONS puis % global (comme le PDF) ---
  const rRec = 11 + dataRows.length;
  ws.mergeCells(rRec, 1, rRec, half);
  ws.mergeCells(rRec, half + 1, rRec, totalCols);
  ws.getCell(rRec, 1).value = `FILLES : ${fmtPct(o.totals.pct_f)} %`;
  ws.getCell(rRec, half + 1).value = `GARÇONS : ${fmtPct(o.totals.pct_g)} %`;
  const rTot = rRec + 1;
  ws.mergeCells(rTot, 1, rTot, totalCols);
  ws.getCell(rTot, 1).value = `${fmtPct(o.totals.pct_t)} %`;
  ws.getRow(rRec).height = 20;
  ws.getRow(rTot).height = 22;
  for (let col = 1; col <= totalCols; col++) {
    const cF = ws.getCell(rRec, col);
    cF.border = BOX;
    cF.fill = { type: "pattern", pattern: "solid", fgColor: GREEN_BG };
    cF.font = font(12, true, GREEN_TXT.argb);
    cF.alignment = { horizontal: "center", vertical: "middle" };
    const cT = ws.getCell(rTot, col);
    cT.border = BOX;
    cT.fill = { type: "pattern", pattern: "solid", fgColor: ORANGE_BG };
    cT.font = font(14, true);
    cT.alignment = { horizontal: "center", vertical: "middle" };
  }

  // --- Fait à + signatures (Le Directeur à gauche, L'Inspecteur à droite) ---
  const rFait = rTot + 2;
  ws.mergeCells(rFait, 1, rFait, totalCols);
  const fait = ws.getCell(rFait, 1);
  fait.value = `Fait à ${o.iepRegion}, le ${todayFr()}`;
  fait.font = font(11);
  fait.alignment = { horizontal: "right" };

  const rSig = rFait + 2;
  ws.mergeCells(rSig, 1, rSig, 6);
  const sigDir = ws.getCell(rSig, 1);
  sigDir.value = "Le Directeur";
  sigDir.font = font(12, true);
  sigDir.alignment = { horizontal: "center" };
  ws.mergeCells(rSig, totalCols - 5, rSig, totalCols);
  const sigInsp = ws.getCell(rSig, totalCols - 5);
  sigInsp.value = "L'Inspecteur";
  sigInsp.font = font(12, true);
  sigInsp.alignment = { horizontal: "right" };
  // Noms en caractère d'imprimerie, 2 rangées plus bas (comme l'exemplaire).
  if ((o.directorName || "").trim()) {
    ws.mergeCells(rSig + 2, 1, rSig + 2, 6);
    const nm = ws.getCell(rSig + 2, 1);
    nm.value = o.directorName.trim().toUpperCase();
    nm.font = font(11, true);
    nm.alignment = { horizontal: "center" };
  }
  if ((o.inspectorName || "").trim()) {
    ws.mergeCells(rSig + 2, totalCols - 5, rSig + 2, totalCols);
    const nm2 = ws.getCell(rSig + 2, totalCols - 5);
    nm2.value = o.inspectorName.trim().toUpperCase();
    nm2.font = font(11, true);
    nm2.alignment = { horizontal: "right" };
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
      ws.addImage(imgId, { tl: { col: totalCols - 2, row: 0.2 }, ext: { width: 46, height: 46 } });
    }
  } catch {
    // armoiries omises — l'en-tête reste lisible
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: XLSX_MIME }), `${exportFileBase(o)}.xlsx`);
}

export function SyntheseDocument({
  sessionId,
  levelGroup = "primary",
  onClose,
}: {
  sessionId: string;
  levelGroup?: "primary" | "cm2" | "all";
  onClose: () => void;
}) {
  // v2 — VERROU D'IMPRESSION : Admin IEP + Super Admin uniquement
  // (le directeur consulte l'aperçu à l'écran, sans impression).
  const role = usePrintRole();
  const canPrint = canPrintDocument(role, false);
  // Modèle en cours de génération (Word/Excel) — désactive les boutons.
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["synthese-data", sessionId, levelGroup],
    queryFn: () => reportsApi.getSyntheseData(sessionId, levelGroup),
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <p className="text-red-600">Erreur : {(error as Error)?.message}</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-200 rounded">Fermer</button>
        </div>
      </div>
    );
  }

  // fmt / fmtPct : déplacés au niveau module (partagés avec les modèles
  // Word/Excel — mêmes valeurs formatées que le PDF).

  // CLASS_NAMES dynamique : dérivé de la réponse du backend (data.levels).
  // On garde l'ordre canonique (CP1, CP2, CE1, CE2, CM1, CM2) même si le
  // backend renvoie un sous-ensemble (ex: CM2 seul pour le doc dédié).
  const CLASS_NAMES = ALL_CLASS_NAMES.filter((cn) =>
    data.levels.some((l) => l.class_name === cn),
  );
  // Nombre total de colonnes : 1 (label) + N classes × 3 (G/F/T).
  const TOTAL_COLS = 1 + CLASS_NAMES.length * 3;

  // Helper pour trouver un niveau par nom de classe
  const getLevel = (name: string): LevelData => {
    return data.levels.find((l) => l.class_name === name) || {
      class_name: name, inscrits: [0, 0, 0], presents: [0, 0, 0], admis: [0, 0, 0], pct_admis: [0, 0, 0],
    };
  };

  // Pré-calculer les données pour chaque classe (évite les lookups répétés)
  const classLevels = CLASS_NAMES.map(getLevel);

  // Données pour les modèles Word/Excel (mêmes valeurs que le PDF).
  const exportData: ExportData = {
    iepName: data.iep_name,
    iepRegion: data.iep_region,
    iepBp: data.iep_bp ?? "",
    inspectorPhone: data.inspector_phone ?? "",
    schoolName: data.school_name,
    evalLabel: data.eval_label,
    evalNumber: data.eval_number,
    month: data.month,
    year: data.year,
    classLevels,
    totals: data.totals,
    levelGroup: data.level_group,
    directorName: data.director_name ?? "",
    inspectorName: data.inspector_name ?? "",
  };

  // Modèle WORD (.doc) — HTML MSO A4 paysage fidèle au document imprimé.
  function handleWord() {
    setExporting("doc");
    try {
      saveWordDoc(buildWordHtml(exportData), `${exportFileBase(exportData)}.doc`);
    } finally {
      setExporting(null);
    }
  }

  // Modèle EXCEL (.xlsx) — classeur mis en page (exceljs importé à la demande).
  async function handleExcel() {
    setExporting("xlsx");
    try {
      await exportSyntheseExcelAsync(exportData);
    } finally {
      setExporting(null);
    }
  }

  // Styles communs — COULEURS DU DRAPEAU ivoirien (inspiration bulletins)
  const headerStyle: React.CSSProperties = {
    border: `1px solid ${CI_GREEN}`,
    background: CI_GREEN,
    color: "white",
    padding: "4px",
    textAlign: "center",
    fontSize: "10px",
    ...PRINT_COLOR_STYLE,
  };
  const labelCellStyle: React.CSSProperties = {
    border: `1px solid ${CI_GREEN}`,
    padding: "6px 8px",
    background: CI_ORANGE_BG,
    fontWeight: "bold",
    color: LABEL_GREEN,
    ...PRINT_COLOR_STYLE,
  };

  // FIX BUG #2 : les valeurs G/F/T étaient brouillées dans le rendu.
  // Cause : le composant RowCells utilisait un Fragment (<>...</>) pour rendre
  // 3 cellules <td>, ce qui causait un bug de réordonnancement dans le DOM —
  // les cellules étaient rendues colonne par colonne (tous les G, puis tous
  // les F, puis tous les T) au lieu d'être groupées par classe.
  // Solution : rendre les <td> directement via flatMap (pas de sous-composant,
  // pas de Fragment). Chaque cellule a une key unique et explicite.
  const renderDataRow = (
    rowType: "inscrits" | "presents" | "admis" | "pct_admis",
  ): React.ReactNode[] => {
    const isPct = rowType === "pct_admis";
    const fmtFn = isPct ? fmtPct : fmt;
    return CLASS_NAMES.flatMap((cn, ci) => {
      const lvl = classLevels[ci];
      const vals = lvl[rowType];
      const cellStyle: React.CSSProperties = {
        border: `1px solid ${CI_GREEN}`,
        padding: "6px",
        textAlign: "center",
        background: ci % 2 === 0 ? CI_GREEN_BG : "transparent",
        ...PRINT_COLOR_STYLE,
      };
      return [
        <td key={`${rowType}-${cn}-G`} style={cellStyle}>{fmtFn(vals[0])}</td>,
        <td key={`${rowType}-${cn}-F`} style={cellStyle}>{fmtFn(vals[1])}</td>,
        <td key={`${rowType}-${cn}-T`} style={cellStyle}>{fmtFn(vals[2])}</td>,
      ];
    });
  };

  // Sous-en-têtes G/F/T pour chaque classe (même technique : flatMap)
  const subHeaders: React.ReactNode[] = CLASS_NAMES.flatMap((cn) => [
    <th key={`${cn}-G`} style={headerStyle}>G</th>,
    <th key={`${cn}-F`} style={headerStyle}>F</th>,
    <th key={`${cn}-T`} style={headerStyle}>T</th>,
  ]);

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">Document de Synthèse — Aperçu</h3>
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

      {/* === DOCUMENT === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="synthese-doc"
        className={`bg-white mx-auto shadow-lg print:shadow-none print:p-0 ${canPrint ? "" : "print-locked"}`}
        style={{
          width: "100%",
          maxWidth: "297mm",
          minHeight: "210mm",
          padding: "20px",
          fontFamily: "Helvetica, Arial, sans-serif",
          color: INK_DOC,
          overflowX: "auto",
          position: "relative", // filigrane armoiries DANS LE FOND
        }}
      >
        {/* Décor drapeau CI : armoiries en filigrane (répétées sur chaque
            page imprimée). NB (demande utilisateur) : les rubans tricolores
            des bordures haut/bas sont SUPPRIMÉS sur ce document. */}
        <CIArmoiriesWatermark fixed />
        <div style={{ position: "relative", zIndex: 1 }}>
        {/* En-tête */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
          <div style={{ fontSize: "10px", fontWeight: "bold", lineHeight: "1.5", textAlign: "left" }}>
            <div>République de Côte d&apos;Ivoire</div>
            <div>Ministère de l&apos;Éducation Nationale</div>
            <div>Et de l&apos;Alphabétisation</div>
            <div>Direction Régionale de {data.iep_region}</div>
            <div>Inspection de l&apos;Enseignement</div>
            <div>Préscolaire et Primaire de {data.iep_name}</div>
            {/* BP / Tel : alimentés par les champs de l'IEP (formulaire Inspections).
                Si vide, placeholder points pour préserver la mise en page. */}
            <div>BP : {data.iep_bp || "........."} / Tél : {data.inspector_phone || "............"}</div>
          </div>
          <div style={{ fontSize: "10px", fontWeight: "bold", textAlign: "right" }}>
            <div style={{ marginBottom: "4px" }}>Union - Discipline - Travail</div>
            <img
              src="/ci-coat-of-arms.png"
              alt="Armoiries Côte d'Ivoire"
              style={{ width: "60px", height: "60px", objectFit: "contain", marginLeft: "auto" }}
            />
            <div style={{ marginTop: "4px" }}>ÉCOLE : {data.school_name}</div>
          </div>
        </div>

        {/* Trait */}
        <hr style={{ borderColor: CI_GREEN, borderWidth: "1.5px", margin: "8px 0 12px 0" }} />

        {/* Titre — boîte bordée de VERT DRAPEAU sur fond pastel orange
            (inspiration bulletins individuels) */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
          <div style={{
            border: `2.2px solid ${CI_GREEN}`,
            borderRadius: "10px",
            padding: "5px 48px 6px",
            textAlign: "center",
            background: CI_ORANGE_BG,
            boxShadow: `2.5px 2.5px 0 ${CI_GREEN_BG}`,
            ...PRINT_COLOR_STYLE,
          }}>
            <div style={{ fontSize: "16px", fontWeight: "bold", letterSpacing: "1px", color: INK_DOC }}>
              SYNTHÈSE DES RESULTATS
            </div>
            <div style={{ fontSize: "12px", fontWeight: "bold", marginTop: "2px", color: LABEL_GREEN }}>
              {data.eval_label.toUpperCase()} N°{data.eval_number} DU MOIS DE {monthLabel(data.month).toUpperCase()} {data.year}
            </div>
            {/* NB (demande utilisateur) : la mention de périmètre
                (« CP1 au CM1 » / « CM2 fin de cycle » — document_label)
                n'est PLUS affichée dans le document. */}
          </div>
        </div>

        {/* Tableau de synthèse — 6 classes (CP1-CM2) × 3 colonnes (G/F/T) + 1 label = 19 colonnes */}
        <table style={{
          width: "100%",
          borderCollapse: "collapse",
          border: `2px solid ${CI_GREEN}`,
          color: INK_DOC,
          fontSize: "10px",
          fontWeight: "bold",
        }}>
          <thead>
            {/* Ligne 1 : noms des classes (colSpan=3 pour chacune) */}
            <tr>
              <th style={{ ...headerStyle, width: "5%" }}></th>
              {CLASS_NAMES.map((cn) => (
                <th key={cn} colSpan={3} style={{ ...headerStyle, padding: "6px" }}>
                  {cn}
                </th>
              ))}
            </tr>
            {/* Ligne 2 : sous-en-têtes G/F/T pour chaque classe */}
            <tr>
              <th style={headerStyle}></th>
              {subHeaders}
            </tr>
          </thead>
          <tbody>
            {/* Ligne INSCRITS */}
            <tr>
              <td style={labelCellStyle}>INSCRITS</td>
              {renderDataRow("inscrits")}
            </tr>
            {/* Ligne PRÉSENTS */}
            <tr>
              <td style={labelCellStyle}>PRÉSENTS</td>
              {renderDataRow("presents")}
            </tr>
            {/* Ligne ADMIS */}
            <tr>
              <td style={labelCellStyle}>ADMIS</td>
              {renderDataRow("admis")}
            </tr>
            {/* Ligne % ADMIS */}
            <tr>
              <td style={labelCellStyle}>% ADMIS</td>
              {renderDataRow("pct_admis")}
            </tr>
            {/* FIX BUG #3 : colSpan étaient codés en dur (8+8=16) pour 5 classes.
                Avec 6 classes, le total est 19 colonnes. On utilise TOTAL_COLS. */}
            <tr>
              <td colSpan={Math.floor(TOTAL_COLS / 2)} style={{ border: `1px solid ${CI_GREEN}`, padding: "8px", textAlign: "center", fontSize: "12px", background: CI_GREEN_BG, color: LABEL_GREEN, ...PRINT_COLOR_STYLE }}>
                FILLES : {fmtPct(data.totals.pct_f)} %
              </td>
              <td colSpan={TOTAL_COLS - Math.floor(TOTAL_COLS / 2)} style={{ border: `1px solid ${CI_GREEN}`, padding: "8px", textAlign: "center", fontSize: "12px", background: CI_GREEN_BG, color: LABEL_GREEN, ...PRINT_COLOR_STYLE }}>
                GARÇONS : {fmtPct(data.totals.pct_g)} %
              </td>
            </tr>
            <tr>
              <td colSpan={TOTAL_COLS} style={{ border: `1px solid ${CI_GREEN}`, padding: "10px", textAlign: "center", fontSize: "14px", background: CI_ORANGE_BG, fontWeight: "bold", color: INK_DOC, ...PRINT_COLOR_STYLE }}>
                {fmtPct(data.totals.pct_t)} %
              </td>
            </tr>
          </tbody>
        </table>

        {/* Signatures : nom du directeur (depuis User role=director) remplace
            le nom de l'école. Nom de l'inspecteur ajouté (depuis IEP.inspector_name). */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "40px" }}>
          <div style={{ textAlign: "center", width: "40%" }}>
            <div style={{ fontSize: "12px", fontWeight: "bold", textDecoration: "underline" }}>Le Directeur</div>
            <div style={{ height: "60px" }}></div>
            {/* Nom du directeur de l'école (User role=director, school_id).
                Placeholder si aucun directeur affecté. */}
            <div style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>
              {data.director_name || "................................"}
            </div>
          </div>
          <div style={{ textAlign: "right", width: "40%" }}>
            <div style={{ fontSize: "11px", marginBottom: "20px" }}>
              Fait à {data.iep_region}, le {todayFr()}
            </div>
            <div style={{ fontSize: "12px", fontWeight: "bold", textDecoration: "underline" }}>
              L&apos;Inspecteur
            </div>
            <div style={{ height: "40px" }}></div>
            {/* Nom de l'inspecteur titulaire de l'IEP (IEP.inspector_name).
                Placeholder si non renseigné. */}
            <div style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase" }}>
              {data.inspector_name || "................................"}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
