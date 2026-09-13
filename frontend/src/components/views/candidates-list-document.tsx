"use client";

// === Document officiel « LISTE ALPHABETIQUE DES CANDIDATS AU CEPE
// === SESSION {année} » (module Élèves — image ELEVES IA_1 / IA_2 reçue
// de l'utilisateur) ===
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
//   - Titre encadré (bord arrondi, ombre portée) : « LISTE ALPHABETIQUE
//     DES CANDIDATS / AU CEPE SESSION {année} » — année de l'examen =
//     année de fin de l'année scolaire en cours (rentrée août/septembre) ;
//   - ECOLE : {nom} + CODE : {code ministériel} + CENTRE D'EXAMEN (nom
//     du centre de rattachement de l'école — module Écoles, bouton
//     « Centres d'examen » ; vide si non affectée — révision 2/3) ;
//   - Effectifs « G {garçons}  F {filles}  T {total} » + Date (droite) ;
//   - Tableau 12 colonnes (demande utilisateur) : n° | matricule | nom |
//     prenoms | sexe | date et lieu de naissance (fusion jj/mm/aaaa à
//     {lieu}) | nationalite | nom et prénoms du père | nom et prénoms de
//     la mère | nacte | date de l'acte | lieuacte ;
//   - POLICE ARIAL, taille 12 (demande utilisateur) ;
//   - Lignes vides pour compléter la page (modèle papier) ;
//   - 3 modèles d'impression (demande utilisateur) : PDF (impression
//     navigateur), WORD (.doc HTML MSO A4 paysage, en-tête + thead répété)
//     et EXCEL (.xlsx exceljs : en-tête fusionné, tableau bordé, paysage) ;
//   - Pagination multipage : « ELEVES (n) » en bas de CHAQUE page, numéro
//     de page en haut au centre, signature « LE DIRECTEUR » (soulignée)
//     en bas à gauche de la DERNIÈRE page ;
//   - Convention maison : noms/prénoms des FILLES en rouge (comme les
//     tableaux de classement et « RESULTATS DE FIN D'ANNEE »).

import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Loader2, Printer, X } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { studentsApi } from "@/lib/api";
import type { ClassCandidatesPayload, StudentWithClass } from "@/lib/types";

import { INK } from "./official-doc";
import { PRINT_COLOR_STYLE } from "@/components/ci-decor";
import {
  canPrintDocument,
  PrintLockBadge,
  PrintLockDocumentMessage,
  usePrintRole,
} from "@/lib/print-guard";

// POLICE ARIAL taille 12 (demande utilisateur) — Helvetica/Liberation Sans
// en secours (métriques identiques, Linux).
const DOC_FONT = '"Arial", "Helvetica", "Liberation Sans", sans-serif';

// === Pagination à BUDGET DE HAUTEUR (A4 paysage : zone imprimable 194mm,
// boîte page 192mm — padding 6mm haut/bas → 180mm de contenu) ===
// CORRECTIF (demande utilisateur) : avec des classes allant jusqu'à 50
// élèves, les lignes qui passent à la ligne (noms/prénoms longs) dépassaient
// la capacité fixe [17, 24, 22] : le tableau chassait la signature « LE
// DIRECTEUR » du bas de la dernière page (pied de page « ELEVES (n) » en
// position absolue, élèves prenant toute la page). Désormais :
//   1) chaque ligne est ESTIMÉE (majoration) selon les textes qui peuvent
//      revenir à la ligne (Arial 12 : +3,5mm par ligne supplémentaire) ;
//   2) les pages sont remplies par budget de hauteur (page 1 : en-tête
//      institutionnel déduit ; pages suivantes : thead + écart déduits) ;
//   3) la DERNIÈRE page réserve 14mm de ZONE SIGNATURE — les lignes vides
//      de complétion s'arrêtent avant, et « LE DIRECTEUR » est ancré en
//      absolu au-dessus du pied : il est TOUJOURS visible.
const PAGE_CONTENT_MM = 180;
const HEADER_MM = 52;    // en-tête institutionnel page 1 (majoré)
const THEAD_MM = 8;      // ligne d'en-têtes du tableau
const GAP_FIRST_MM = 3;  // espace en-tête → tableau (page 1)
const GAP_MM = 4;        // espace → tableau (pages suivantes)
const SIGN_ZONE_MM = 14; // zone réservée à la signature (dernière page)
const ROW_MM = 7;        // hauteur d'une ligne simple (Arial 12)
const LINE_MM = 3.5;     // mm par ligne supplémentaire (texte qui revient)

const BUDGET_FIRST = PAGE_CONTENT_MM - HEADER_MM - GAP_FIRST_MM - THEAD_MM; // 117
const BUDGET_MID = PAGE_CONTENT_MM - GAP_MM - THEAD_MM;                     // 168
const BUDGET_LAST = PAGE_CONTENT_MM - GAP_MM - THEAD_MM - SIGN_ZONE_MM;     // 154

const ROW_HEIGHT = "7mm";

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

// « DATE ET LIEU DE NAISSANCE » (colonne fusionnée — demande utilisateur) :
// jj/mm/aaaa à {lieu}. Dégradé gracieux : année seule, jour/mois seuls…
function fmtDateLieuNaissance(s?: StudentWithClass | null): string {
  if (!s) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const j = s.birth_day;
  const m = s.birth_month;
  const a = s.birth_year;
  let date = "";
  if (j && m && a) date = `${p(j)}/${p(m)}/${a}`;
  else if (a) date = String(a);
  else if (j && m) date = `${p(j)}/${p(m)}`;
  const lieu = (s.birth_place ?? "").trim();
  if (date && lieu) return `${date} à ${lieu}`;
  return date || lieu;
}

// « DATE DE L'ACTE » : saisie via input date (ISO aaaa-mm-jj) → affichage
// jj/mm/aaaa ; une valeur déjà en jj/mm/aaaa passe telle quelle.
function fmtDateActe(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v).trim();
  if (!s) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : s;
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
  padding: "1px 3px",
  fontSize: "12px",
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
    fontSize: "12px", // ARIAL 12 (demande utilisateur)
    height: ROW_HEIGHT,
    textAlign: align,
    verticalAlign: "middle",
    color: red ? "#dc2626" : INK,
    background: "#ffffff",
    // Demande utilisateur (session 40) : TOUS les noms et prénoms écrits en
    // entier — plus de nowrap/overflow hidden qui coupaient les noms longs ;
    // le texte passe à la ligne et la ligne du tableau s'ajuste.
    overflowWrap: "break-word",
    lineHeight: 1.15,
    ...PRINT_COLOR_STYLE,
  };
}

// Les 12 colonnes (fusion date+lieu de naissance, père/mère « nom et
// prénoms », colonne DATE DE L'ACTE entre nacte et lieuacte).
// Largeurs rééquilibrées (révision 2 — demande utilisateur) : n°, nom,
// sexe et nacte réduites ; prenoms et lieuacte élargies. Libellés en
// minuscules comme le modèle.
const COLS: Array<{
  w: string;
  label: string;
  align: "left" | "center";
}> = [
  { w: "3%", label: "n°", align: "center" },
  { w: "8%", label: "matricule", align: "center" },
  { w: "7.5%", label: "nom", align: "left" },
  { w: "16.5%", label: "prenoms", align: "left" },
  { w: "3%", label: "sexe", align: "center" },
  { w: "14%", label: "date et lieu de naissance", align: "left" },
  { w: "7.5%", label: "nationalite", align: "left" },
  { w: "12.5%", label: "nom et prénoms du père", align: "left" },
  { w: "11.5%", label: "nom et prénoms de la mère", align: "left" },
  { w: "4.5%", label: "nacte", align: "center" },
  { w: "6.5%", label: "date de l'acte", align: "center" },
  { w: "5.5%", label: "lieuacte", align: "center" },
];

// Estimation MAJORÉE de la hauteur d'une ligne (mm) : on compte combien de
// lignes prend le pire texte des colonnes étroites (capacité en caractères
// déduite des largeurs % sur ~267mm utiles, police Arial 12 majorée à
// ~1,95mm/caractère). Une ligne vide de complétion vaut exactement ROW_MM.
function estRowHeightMm(s: StudentWithClass | null): number {
  if (!s) return ROW_MM;
  const lines = (cpl: number, text: string) =>
    text ? Math.max(1, Math.ceil(text.length / cpl)) : 1;
  const max = Math.max(
    lines(8, cell(s.last_name).toUpperCase()),      // nom (7,5% — MAJUSCULES)
    lines(21, s.first_name ? titleCasePrenoms(s.first_name) : ""), // prenoms
    lines(18, fmtDateLieuNaissance(s)),             // date et lieu de naissance
    lines(15, cell(s.father_name)),                 // père (12,5%)
    lines(14, cell(s.mother_name)),                 // mère (11,5%)
    lines(9, cell(s.nationality)),                  // nationalité (7,5%)
    lines(10, cell(s.matricule)),                   // matricule (8%)
    lines(6, cell(s.acte_number)),                  // nacte (4,5%)
    lines(8, fmtDateActe(s?.acte_date)),            // date de l'acte (6,5%)
    lines(7, cell(s.acte_place)),                   // lieuacte (5,5%)
  );
  return ROW_MM + (Math.min(max, 4) - 1) * LINE_MM;
}

type DocPage = Array<StudentWithClass | null>;

// Complète une page avec des lignes vides (7mm) tant que le budget le permet
// (modèle papier) — la page s'arrête AVANT la zone signature en dernière
// position.
function withFillers(rows: StudentWithClass[], usedMm: number, budgetMm: number): DocPage {
  const fillers = Math.max(0, Math.floor((budgetMm - usedMm) / ROW_MM));
  return [...rows, ...Array.from({ length: fillers }, () => null)];
}

// Découpe la classe en pages par budget de hauteur : [page 1 (en-tête),
// pages intermédiaires, dernière page avec zone signature réservée].
function buildPages(students: StudentWithClass[]): DocPage[] {
  const heights = students.map(estRowHeightMm);
  const pages: DocPage[] = [];
  let i = 0;

  // Page 1 : en-tête institutionnel (budget réduit)
  const start1 = i;
  let used = 0;
  while (i < students.length && used + heights[i] <= BUDGET_FIRST) {
    used += heights[i];
    i++;
  }
  if (i === start1 && students.length > 0) i = start1 + 1; // garde-fou : ≥1 élève/page
  pages.push(withFillers(students.slice(start1, i), used, BUDGET_FIRST));

  // Pages intermédiaires + dernière (zone signature réservée)
  while (i < students.length) {
    // Tous les élèves restants tiennent-ils dans le budget « dernière page » ?
    let usedLast = 0;
    let j = i;
    while (j < students.length && usedLast + heights[j] <= BUDGET_LAST) {
      usedLast += heights[j];
      j++;
    }
    if (j >= students.length) {
      pages.push(withFillers(students.slice(i, j), usedLast, BUDGET_LAST));
      i = j;
    } else {
      let usedMid = 0;
      let k = i;
      while (k < students.length && usedMid + heights[k] <= BUDGET_MID) {
        usedMid += heights[k];
        k++;
      }
      if (k === i) k = i + 1; // garde-fou : ≥1 élève/page
      pages.push(withFillers(students.slice(i, k), usedMid, BUDGET_MID));
      i = k;
    }
  }
  return pages;
}

// ============================================================ 3 MODÈLES ===

interface CandidatsExportData {
  students: StudentWithClass[];
  total: number;
  garcons: number;
  filles: number;
  className: string;
  schoolName: string;
  schoolCode: string;
  examCenter: string;
  iep?: ClassCandidatesPayload["iep"];
  annee: number;
}

function escHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function slugFile(s: string): string {
  return s
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Armoiries en base64 (meilleur effort — omises si indisponibles).
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

// Modèle WORD (.doc) — HTML MSO A4 PAYSAGE fidèle au document imprimé :
// en-tête institutionnel complet (tableau 3 colonnes sans bordures), titre
// encadré, tableau 12 colonnes bordé (thead répété à chaque page par Word),
// signature « LE DIRECTEUR » et pied « ELEVES (n) ». Aucune ligne vide : Word
// pagine naturellement.
async function buildWordHtml(o: CandidatsExportData): Promise<string> {
  const armoiries = await armoiriesBase64();
  const iep = o.iep;
  const th = COLS.map((c) => `<th>${escHtml(c.label)}</th>`).join("");
  const colgroup = COLS.map((c) => `<col style="width:${c.w}">`).join("");
  const body = o.students
    .map((s, i) => {
      const red = s.gender === "F" ? ` style="color:#dc2626"` : "";
      const td = (v: string, extra = "") => `<td${extra}>${escHtml(v)}</td>`;
      return (
        `<tr>` +
        td(String(i + 1)) +
        td(cell(s.matricule)) +
        td(cell(s.last_name).toUpperCase(), red) +
        td(s.first_name ? titleCasePrenoms(s.first_name) : "", red) +
        td(cell(s.gender)) +
        td(fmtDateLieuNaissance(s)) +
        td(cell(s.nationality)) +
        td(cell(s.father_name)) +
        td(cell(s.mother_name)) +
        td(cell(s.acte_number)) +
        td(fmtDateActe(s.acte_date)) +
        td(cell(s.acte_place)) +
        `</tr>`
      );
    })
    .join("");
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>Liste des candidats CEPE ${o.annee} — ${escHtml(o.className)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page WordSection1 { size:297mm 210mm; margin:8mm; mso-page-orientation:landscape; }
div.WordSection1 { page:WordSection1; }
body { font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#000; }
p { margin:0; }
table.hdr { border-collapse:collapse; width:100%; }
table.hdr td { border:none; vertical-align:top; font-size:12px; line-height:1.3; }
table.doc { border-collapse:collapse; width:100%; table-layout:fixed; }
table.doc td, table.doc th { border:1px solid #000; padding:0 3px; font-size:12px; vertical-align:middle; overflow-wrap:break-word; }
table.doc th { font-weight:bold; text-align:center; height:8mm; }
table.doc td { height:7mm; }
thead.rep { display:table-header-group; }
.titre { display:inline-block; border:2px solid #000; padding:7px 20px 8px; font-size:16px; font-weight:bold; text-align:center; line-height:1.35; }
.sig { font-weight:bold; text-decoration:underline; margin-top:24pt; }
.pied { text-align:center; margin-top:18pt; }
</style>
</head>
<body>
<div class=WordSection1>
<table class=hdr><tr>
<td style="width:33%">
<p>Ministère de l'Education Nationale</p>
<p>Et de l'Alphabétisation</p>
<p><b><i>Direction Régionale de ${escHtml(iep?.region || "…………")}</i></b></p>
<p><b><i>Inspection de l'Enseignement</i></b></p>
<p><b><i>Préscolaire et Primaire de ${escHtml(iep?.name || "…………")}</i></b></p>
<p><b>BP : ${escHtml(iep?.bp || "……")} / Tel : ${escHtml(iep?.inspector_phone || "…………")}</b></p>
<p><b>Courriel : ${escHtml(iep?.inspector_email || "…………")}</b></p>
<p>&nbsp;</p>
<p><b style="font-size:13px">ECOLE : ${escHtml(o.schoolName)}</b></p>
<p><b>CODE: ${escHtml(o.schoolCode || "…………")}</b></p>
<p><b>CENTRE D'EXAMEN: ${escHtml(o.examCenter || "…………")}</b></p>
</td>
<td style="text-align:center; vertical-align:middle"><span class=titre>LISTE ALPHABETIQUE DES CANDIDATS<br>AU CEPE SESSION ${o.annee}</span></td>
<td style="width:21%; text-align:center">
<p>République de Côte d'Ivoire</p>
<p style="font-size:11.5px">Union-Discipline-Travail</p>
${armoiries ? `<p><img src="${armoiries}" width="56" height="56" alt=""></p>` : ""}
<p style="font-weight:bold; font-size:13px; letter-spacing:1.5px">G ${o.garcons}&nbsp;&nbsp;F ${o.filles}&nbsp;&nbsp;T ${o.total}</p>
<p style="font-weight:600; font-size:11.5px">Date: ${todayFr()}</p>
</td>
</tr></table>
<p style="height:3mm"></p>
<table class=doc>
<colgroup>${colgroup}</colgroup>
<thead class=rep><tr>${th}</tr></thead>
<tbody>${body}</tbody>
</table>
<p class=sig>LE DIRECTEUR</p>
<p class=pied>ELEVES (${o.total})</p>
</div>
</body>
</html>`;
}

// Modèle EXCEL (.xlsx) — classeur mis en page (exceljs, import dynamique) :
// en-tête officiel fusionné + armoiries, tableau 12 colonnes bordé (filles en
// rouge), pied « ELEVES (n) », signature « LE DIRECTEUR », impression paysage
// ajustée à 1 page de large avec répétition de la ligne d'en-têtes.
const EXCEL_BORDER = { style: "thin" as const, color: { argb: "FF000000" } };
const EXCEL_BOX = {
  top: EXCEL_BORDER,
  left: EXCEL_BORDER,
  bottom: EXCEL_BORDER,
  right: EXCEL_BORDER,
};

async function exportExcelAsync(o: CandidatsExportData): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";
  const ws = wb.addWorksheet("Candidats", {
    views: [{ state: "frozen", ySplit: 9, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
      printTitlesRow: "9:9",
    },
  });
  ws.columns = [4, 13, 15, 30, 5, 28, 14, 24, 22, 11, 13, 13].map((width) => ({ width }));
  const font = (size: number, bold = false, argb?: string) => ({
    name: "Arial",
    size,
    bold,
    ...(argb ? { color: { argb } } : {}),
  });

  const merged = (row: number, text: string, size: number, bold = false, italic = false) => {
    ws.mergeCells(row, 1, row, 12);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: "Arial", size, bold, italic };
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  };

  merged(1, "Ministère de l'Education Nationale et de l'Alphabétisation", 12, true);
  merged(2, `Direction Régionale de ${o.iep?.region || "…………"} — Inspection de l'Enseignement Préscolaire et Primaire de ${o.iep?.name || "…………"}`, 11, true, true);
  merged(3, `BP : ${o.iep?.bp || "……"} / Tel : ${o.iep?.inspector_phone || "…………"} — Courriel : ${o.iep?.inspector_email || "…………"}`, 11, true);
  merged(4, "République de Côte d'Ivoire — Union-Discipline-Travail", 11, true);
  merged(5, `LISTE ALPHABETIQUE DES CANDIDATS AU CEPE SESSION ${o.annee}`, 14, true);
  for (let col = 1; col <= 12; col++) ws.getCell(5, col).border = EXCEL_BOX;

  ws.mergeCells(6, 1, 6, 7);
  const ecole = ws.getCell(6, 1);
  ecole.value = `ECOLE : ${o.schoolName}    CODE : ${o.schoolCode || "…………"}    CENTRE D'EXAMEN : ${o.examCenter || "…………"}`;
  ecole.font = font(11, true);
  ws.mergeCells(6, 8, 6, 12);
  const classe = ws.getCell(6, 8);
  classe.value = `CLASSE : ${o.className}`;
  classe.font = font(11, true);
  classe.alignment = { horizontal: "right" };
  ws.mergeCells(7, 1, 7, 7);
  const effectifs = ws.getCell(7, 1);
  effectifs.value = `G ${o.garcons}    F ${o.filles}    T ${o.total}`;
  effectifs.font = font(11, true);
  ws.mergeCells(7, 8, 7, 12);
  const dateCell = ws.getCell(7, 8);
  dateCell.value = `Date : ${todayFr()}`;
  dateCell.font = font(11, true);
  dateCell.alignment = { horizontal: "right" };
  ws.getRow(8).height = 6;

  const head = ws.getRow(9);
  head.values = COLS.map((c) => c.label);
  head.height = 24;
  head.eachCell((c) => {
    c.font = font(10, true);
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = EXCEL_BOX;
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  });

  o.students.forEach((s, i) => {
    const girl = s.gender === "F";
    const row = ws.getRow(10 + i);
    row.values = [
      i + 1,
      cell(s.matricule),
      cell(s.last_name).toUpperCase(),
      s.first_name ? titleCasePrenoms(s.first_name) : "",
      cell(s.gender),
      fmtDateLieuNaissance(s),
      cell(s.nationality),
      cell(s.father_name),
      cell(s.mother_name),
      cell(s.acte_number),
      fmtDateActe(s.acte_date),
      cell(s.acte_place),
    ];
    row.height = 18;
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = EXCEL_BOX;
      c.font = font(10, false, girl && (col === 3 || col === 4) ? "FFDC2626" : undefined);
      c.alignment =
        col === 3 || col === 4 || col === 6 || col === 7 || col === 8 || col === 9
          ? { horizontal: "left", vertical: "middle", wrapText: true }
          : { horizontal: "center", vertical: "middle", wrapText: true };
    });
  });

  const rEnd = 10 + o.students.length;
  ws.mergeCells(rEnd + 1, 1, rEnd + 1, 12);
  const foot = ws.getCell(rEnd + 1, 1);
  foot.value = `ELEVES (${o.total})`;
  foot.font = font(11, true);
  foot.alignment = { horizontal: "center" };
  const dir = ws.getCell(rEnd + 3, 1);
  dir.value = "LE DIRECTEUR";
  dir.font = { name: "Arial", size: 11, bold: true, underline: true };

  try {
    const res = await fetch("/ci-coat-of-arms.png");
    if (res.ok) {
      const u8 = new Uint8Array(await res.arrayBuffer());
      const imgId = wb.addImage({
        buffer: u8 as unknown as Parameters<typeof wb.addImage>[0]["buffer"],
        extension: "png",
      });
      ws.addImage(imgId, { tl: { col: 10.7, row: 0.2 }, ext: { width: 52, height: 52 } });
    }
  } catch {
    // armoiries omises — l'en-tête reste lisible
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `liste-candidats-${slugFile(o.className)}-cepe-${o.annee}.xlsx`,
  );
}

export function CandidatesListDocument({
  classId,
  onClose,
}: {
  classId: string;
  onClose: () => void;
}) {
  const role = usePrintRole();
  // POLITIQUE (demande utilisateur) : AUCUN directeur ni adjoint au
  // directeur n'imprime de document — tout est grisé à leur niveau (comme
  // les enseignants). Imprimable par l'admin et l'Admin IEP uniquement.
  // NB : le bug « PDF pas disponible » pour les rôles autorisés venait du
  // CSS d'impression (contre-règle #liste-candidats-doc absente de
  // globals.css) — corrigé là-bas.
  const canPrint = canPrintDocument(role, false);
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);
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
  const annee = cepeExamYear();

  // Découpage en pages à budget de hauteur + lignes vides de complétion
  // (modèle papier) — la zone « LE DIRECTEUR » (14mm) reste réservée sur la
  // dernière page même avec 50 élèves (demande utilisateur).
  const pages = buildPages(students);
  const lastPageIdx = pages.length - 1;

  const exportData: CandidatsExportData = {
    students,
    total,
    garcons,
    filles,
    className: data.class.name,
    schoolName: data.school.name,
    schoolCode: data.school.code ?? "",
    examCenter: data.exam_center ?? "",
    iep,
    annee,
  };

  // Modèle WORD (.doc) — HTML MSO A4 paysage fidèle au document imprimé.
  async function handleWord() {
    setExporting("doc");
    try {
      const html = await buildWordHtml(exportData);
      saveBlob(
        new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" }),
        `liste-candidats-${slugFile(exportData.className)}-cepe-${annee}.doc`,
      );
    } finally {
      setExporting(null);
    }
  }

  // Modèle EXCEL (.xlsx) — classeur mis en page (exceljs importé à la demande).
  async function handleExcel() {
    setExporting("xlsx");
    try {
      await exportExcelAsync(exportData);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Liste alphabétique des candidats CEPE {annee} — {data.class.name}
          {" "}· {data.school.name}
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
        style={{ width: "100%", maxWidth: "281mm", fontFamily: DOC_FONT, color: INK }}
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
                  fontSize: "11px",
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
                  <div style={{ width: "33%", fontSize: "12px", lineHeight: 1.3 }}>
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
                    <div style={{ fontWeight: 700, fontSize: "13px", marginTop: "5px" }}>
                      ECOLE : {data.school.name}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "12px" }}>
                      CODE: {data.school.code || "…………"}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "12px" }}>
                      CENTRE D&apos;EXAMEN: {data.exam_center || "…………"}
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
                      LISTE ALPHABETIQUE DES CANDIDATS
                      <br />
                      AU CEPE SESSION {annee}
                    </span>
                  </div>

                  {/* République + armoiries + effectifs + date (droite) */}
                  <div
                    style={{
                      width: "21%",
                      textAlign: "center",
                      fontSize: "12px",
                      lineHeight: 1.3,
                    }}
                  >
                    <div>République de Côte d&apos;Ivoire</div>
                    <div style={{ fontSize: "11.5px", padding: "1px 0" }}>
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
                        fontSize: "13px",
                        letterSpacing: "1.5px",
                        marginTop: "3px",
                      }}
                    >
                      G {garcons}&nbsp;&nbsp;F {filles}&nbsp;&nbsp;T {total}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "11.5px", marginTop: "1px" }}>
                      Date: {todayFr()}
                    </div>
                  </div>
                </div>
              )}

              {/* Espace entre en-tête et tableau (page 1) */}
              <div style={{ height: isFirst ? "3mm" : "4mm" }} />

              {/* --- Tableau 12 colonnes (modèle + révisions utilisateur) --- */}
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
                        <td style={tdStyle("left")}>{fmtDateLieuNaissance(s)}</td>
                        <td style={tdStyle("left")}>{cell(s?.nationality)}</td>
                        <td style={tdStyle("left")}>{cell(s?.father_name)}</td>
                        <td style={tdStyle("left")}>{cell(s?.mother_name)}</td>
                        <td style={tdStyle("center")}>{cell(s?.acte_number)}</td>
                        <td style={tdStyle("center")}>{fmtDateActe(s?.acte_date)}</td>
                        <td style={tdStyle("center")}>{cell(s?.acte_place)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Signature « LE DIRECTEUR » — ANCRÉE en bas gauche de la
                  DERNIÈRE page (position absolue au-dessus du pied « ELEVES
                  (n) ») : visible quelle que soit la hauteur réelle des
                  lignes ; les lignes vides de complétion s'arrêtent avant la
                  zone réservée (14mm). */}
              {isLast && (
                <div
                  style={{
                    position: "absolute",
                    left: "7mm",
                    bottom: "13mm",
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
                  fontSize: "12px",
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

/** Numéro de départ (n°) des lignes d'une page : somme des ÉLÈVES réels des
 *  pages précédentes (hors lignes vides de complétion) — la numérotation
 *  continue d'une page à l'autre. */
function idxOffset(pages: DocPage[], pageIdx: number): number {
  let n = 0;
  for (let i = 0; i < pageIdx; i++)
    for (const row of pages[i]) if (row) n++;
  return n;
}
