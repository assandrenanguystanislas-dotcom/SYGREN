"use client";

// v3 — EMBELLISSEMENT DRAPEAU CI (inspiré des bulletins individuels) :
// entêtes du tableau sur FOND VERT DRAPEAU (texte blanc), bordures
// vertes, boîte du titre sur fond pastel orange bordé de vert,
// bandeau ORANGE DRAPEAU pour le type d'examen, blocs statistiques et
// signatures bordés de vert ; armoiries en filigrane (rubans tricolores
// haut/bas RETIRÉS — aucune bordure drapeau sur les feuilles imprimables).
//
// v4 — EXTENSION DES 3 MODÈLES D'IMPRESSION : en plus du PDF (window.print),
// le relevé propose désormais les modèles Word (.doc, HTML MSO via la lib
// partagée buildWordShell) et Excel (.xlsx, exceljs importé à la demande) —
// en-tête institutionnel reproduit fidèlement depuis le rendu PDF
// (bloc ministériel + République + boîte du titre + bandeau orange +
// école/code + G/F/T + date), tableau élèves × matières avec les mêmes
// valeurs formatées (fmt : « — » si pas de note, virgule française,
// zéros décimaux trimés), statistiques du bas et signatures avec les
// mêmes libellés et le même repli en pointillés que le PDF.
import { useState, useEffect } from "react";
import { X, Loader2, User, Users, CheckCircle2, Award, TrendingUp } from "lucide-react";
import { CIArmoiriesWatermark } from "@/components/ci-decor";
import { canPrintDocument, PrintLockBadge, PrintLockDocumentMessage, storeUrlTokenIfPresent, usePrintRole } from "@/lib/print-guard";
import {
  DocExportButtons,
  XLSX_MIME,
  buildWordShell,
  escHtml,
  saveBlob,
  saveWordDoc,
  slugFile,
} from "@/lib/doc-export";

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

// === Pagination dynamique (budget de lignes) ===
// Demande utilisateur : les noms et prénoms sont TOUJOURS écrits en entier —
// une ligne du tableau peut donc occuper 2-3 lignes de texte. Chaque élève
// coûte autant d'unités que de lignes estimées de son identité (1 unité =
// une ligne simple, comme avant) : les pages gardent la taille A4 et la
// numérotation reste continue.
const PAGE_1_BUDGET = 40;
const OTHER_PAGE_BUDGET = 45;

// Largeur estimée de la colonne Nom (mm) — minWidth 48px ≈ 13mm, l'auto-
// layout lui en accorde généralement un peu plus.
const NOM_COL_MM = 14;

// Estimation du nombre de lignes rendues par un texte dans une colonne de
// largeur donnée (mm) — calibration ≈1,1 mm par caractère à 11px.
function estLines(text: string, widthMm: number): number {
  const w = (text || "").length * 1.1;
  return Math.max(1, Math.ceil(w / Math.max(widthMm, 6)));
}

// Coût d'un élève = max(lignes du nom, lignes des prénoms). Marge de
// sécurité de 12mm sur la largeur Prénoms (l'auto-layout est généreux).
function studentLineCost(lastName: string, firstName: string, prenomsWidthMm: number): number {
  return Math.max(
    estLines(lastName, NOM_COL_MM),
    estLines(firstName, prenomsWidthMm - 12),
  );
}

function chunkStudents(students: ReleveStudent[], prenomsWidthMm: number): ReleveStudent[][] {
  if (students.length === 0) return [[]];
  const pages: ReleveStudent[][] = [];
  let current: ReleveStudent[] = [];
  let budget = PAGE_1_BUDGET;
  for (const s of students) {
    const cost = studentLineCost(s.last_name, s.first_name, prenomsWidthMm);
    if (current.length > 0 && budget - cost < 0) {
      pages.push(current);
      current = [];
      budget = OTHER_PAGE_BUDGET;
    }
    current.push(s);
    budget -= cost;
  }
  if (current.length > 0) pages.push(current);
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

// === Largeur disponible pour la colonne Prénoms ===
//
// Ancien système : les prénoms étaient ABRÉGÉS (initiales) quand ils ne
// tenaient pas. Demande utilisateur (session 40) : TOUS les noms et
// prénoms sont désormais écrits EN ENTIER dans le relevé — la fonction
// sert uniquement à ESTIMER la largeur de la colonne pour la pagination
// (budget de lignes) : plus il y a de matières, moins la colonne Prénoms
// a de place, plus les identités longues coûtent de lignes.
//
// Contenu utile A4 = 210 - 2×8mm (@page margin) = 194mm.
// Colonnes fixes ≈ 56mm (N°, Matricule, Nom, Total, Moy, Obs).
// Colonnes matières : subjectCount × (6mm si >6 matières, sinon 11mm).

// Largeur disponible pour la colonne Prénoms (en mm, pour A4 portrait 210mm).
// Contenu utile = 210 - 2×8mm (@page margin) = 194mm.
// Colonnes fixes : N°(6) + Matricule(20) + Nom(20) + Total(10) + Moy(8) + Obs(6) = 70mm.
// Colonnes matières : subjectCount × (8mm si >6 matières, sinon 12mm).
// Reste pour Prénoms = 194 - 70 - (subjectCount × matiereWidth).
function getAvailableWidthForPrenoms(subjectCount: number): number {
  const matiereWidth = subjectCount > 6 ? 6 : 11;
  const fixedColumns = 56;
  const availableWidth = 194 - fixedColumns - subjectCount * matiereWidth;
  return Math.max(availableWidth, 20);
}

function fmt(v: number, hasGrade: boolean): string {
  if (!hasGrade) return "—";
  const r = Math.round(v * 100) / 100;
  // Task 37 — décimaux à la FRANÇAISE : virgule au lieu du point
  // (13,5 · 7,25) — les zéros décimaux restent trimés (10 → "10").
  return r.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

// === EXTENSION DES MODÈLES WORD / EXCEL DU RELEVÉ DE NOTES =================
//
// ORIENTATION : A4 PORTRAIT — le @page appliqué au module /releve
// (globals.css) est « size: A4 portrait; margin: 8mm » et le conteneur des
// pages du PDF fait 210mm de large → portrait, marge 8mm.
const RELEVE_ORIENTATION = "portrait" as const;
const RELEVE_MARGIN_MM = 8;

// Couleurs du rendu PDF (valeurs Tailwind reprises telles quelles) :
const GREEN = "#009E60"; // bordures + entêtes du tableau (fond vert)
const TITLE_BG = "#FDEBDA"; // fond pastel orange de la boîte du titre
const BAND_BG = "#F77F00"; // bandeau orange du type d'examen
const EPS_HEAD_BG = "#FDE047"; // bg-yellow-300 — entête de la colonne EPS
const EPS_CELL_BG = "#FEF08A"; // bg-yellow-200 — cellules de notes EPS
const GIRL_RED = "#DC2626"; // text-red-600 — NOM et Prénoms des filles
const BOY_BLUE = "#1D4ED8"; // text-blue-700 — valeurs de la colonne G
const ADMIS_GREEN = "#047857"; // text-emerald-700 — ligne Admis
const GRAY_600 = "#4B5563"; // text-gray-600 — entête de la colonne T
const EMAIL_BLUE = "#1d4ed8"; // lien Courriel de l'en-tête

// Replis en pointillés — chaînes EXACTES affichées par le PDF :
const DOTS_BP = "........."; // BP absent
const DOTS_TEL = "............."; // téléphone absent
const DOTS_MAIL = "............"; // courriel absent
const DOTS_SIG = "................................"; // nom de signature absent

// === MODÈLE WORD (.doc) — HTML MSO A4 PORTRAIT fidèle au rendu PDF ===
// En-tête institutionnel COPIÉ du rendu JSX (bloc ministériel + République
// + boîte du titre + bandeau orange + école/code + G/F/T + date), tableau
// élèves × matières (thead répété à chaque page par Word via
// display:table-header-group), statistiques du bas et signatures.
function buildReleveWordHtml(data: ReleveData): string {
  const esc = escHtml;
  // Matières (libellés abrégés, comme les entêtes du PDF)
  const subjects: { name: string; display_name: string }[] =
    data.students[0]?.grades?.map((g) => ({
      name: g.subject_name,
      display_name: abbreviateSubject(g.subject_name),
    })) ?? [];
  const stats = data.stats;
  const compact = subjects.length > 6;

  // Largeurs de colonnes en % (table-layout:fixed) — mêmes proportions que
  // le PDF (N° étroit, Matricule/Nom moyens, Prénoms extensibles).
  const wNum = 3.5, wMat = 11, wNom = 11, wTotal = 5, wMoy = 4.5, wObs = 4.5;
  const wSubj = compact ? 3.4 : 6;
  const wPrenoms = Math.max(
    100 - wNum - wMat - wNom - wTotal - wMoy - wObs - subjects.length * wSubj,
    8,
  );

  // Styles de cellules du tableau principal
  const th = `border:1px solid ${GREEN}; padding:1px; font-weight:bold; text-align:center; vertical-align:middle; color:#fff; background:${GREEN};`;
  const td = `border:1px solid ${GREEN}; padding:0 1px; font-size:11px; text-align:center; vertical-align:middle;`;
  const tdL = `border:1px solid ${GREEN}; padding:0 2px; font-size:11px; text-align:left; vertical-align:middle;`;

  // Entêtes : libellés principaux en 11px, matières en 9px (comme le PDF) ;
  // la colonne EPS garde son entête JAUNE (fidèle au rendu imprimé).
  const headCells =
    `<th style="${th}; font-size:11px;">N&deg;</th>` +
    `<th style="${th}; font-size:11px;">Matricule</th>` +
    `<th style="${th}; font-size:11px;">Nom</th>` +
    `<th style="${th}; font-size:11px;">Pr&eacute;noms</th>` +
    subjects
      .map(
        (s) =>
          `<th style="${th}; font-size:9px;${
            isEPS(s.name) ? ` background:${EPS_HEAD_BG};` : ""
          }">${esc(s.display_name)}</th>`,
      )
      .join("") +
    `<th style="${th}; font-size:11px;">Total</th>` +
    `<th style="${th}; font-size:11px;">Moy.</th>` +
    `<th style="${th}; font-size:11px;">Obs.</th>`;

  // Lignes élèves — numérotation continue, noms en MAJUSCULES, filles en
  // rouge, notes formatées par fmt (mêmes valeurs que le PDF), EPS surlignée.
  const body = data.students
    .map((e, i) => {
      const fille = e.gender === "F";
      const red = fille ? ` color:${GIRL_RED};` : "";
      const notes = subjects
        .map((s, idx) => {
          const g = e.grades[idx];
          const val = g ? fmt(g.value, g.has_grade) : "—";
          const eps = isEPS(s.name);
          return `<td style="${td}${eps ? ` background:${EPS_CELL_BG}; font-weight:bold;` : ""}">${esc(val)}</td>`;
        })
        .join("");
      return (
        `<tr>` +
        `<td style="${td}; font-weight:bold;">${i + 1}</td>` +
        `<td style="${td}; font-weight:bold;">${esc(e.matricule)}</td>` +
        `<td style="${tdL}; font-weight:bold;${red}">${esc(e.last_name.toUpperCase())}</td>` +
        `<td style="${tdL}; font-weight:bold;${red}">${esc(e.first_name.toUpperCase())}</td>` +
        notes +
        `<td style="${td}; font-weight:bold;">${esc(e.has_average ? fmt(e.total, true) : "—")}</td>` +
        `<td style="${td}; font-weight:bold;">${esc(e.has_average ? fmt(e.average, true) : "—")}</td>` +
        `<td style="${td}; font-weight:bold;">${esc(e.observation)}</td>` +
        `</tr>`
      );
    })
    .join("");

  // Bloc statistiques (mêmes lignes et couleurs que le bloc du PDF :
  // G bleu / F rouge / T noir, Admis en vert, % avec le fmt du PDF).
  const stB = `border:1px solid ${GREEN}; padding:1px 3px; font-size:10px;`;
  const stRow = (
    label: string,
    g: string,
    f: string,
    t: string,
    colorG: string,
    colorF: string,
    colorT = "#000000",
  ) =>
    `<tr>` +
    `<td style="${stB}; font-weight:bold;">${label}</td>` +
    `<td style="${stB}; text-align:center; font-weight:bold; color:${colorG};">${g}</td>` +
    `<td style="${stB}; text-align:center; font-weight:bold; color:${colorF};">${f}</td>` +
    `<td style="${stB}; text-align:center; font-weight:bold; color:${colorT};">${t}</td>` +
    `</tr>`;
  const statsTable =
    `<table class="stat">` +
    `<tr>` +
    `<td style="${stB}; width:34%;">&nbsp;</td>` +
    `<td style="${stB}; text-align:center; font-weight:bold; color:${BOY_BLUE};">G</td>` +
    `<td style="${stB}; text-align:center; font-weight:bold; color:${GIRL_RED};">F</td>` +
    `<td style="${stB}; text-align:center; font-weight:bold; color:${GRAY_600};">T</td>` +
    `</tr>` +
    stRow("Inscrits", `${stats.inscrits_g}`, `${stats.inscrits_f}`, `${stats.inscrits_t}`, BOY_BLUE, GIRL_RED) +
    stRow("Pr&eacute;sents", `${stats.presents_g}`, `${stats.presents_f}`, `${stats.presents_t}`, BOY_BLUE, GIRL_RED) +
    stRow("Admis", `${stats.admis_g}`, `${stats.admis_f}`, `${stats.admis_t}`, ADMIS_GREEN, ADMIS_GREEN, ADMIS_GREEN) +
    stRow(
      "% Admis",
      `${esc(fmt(stats.pct_g, true))}%`,
      `${esc(fmt(stats.pct_f, true))}%`,
      `${esc(fmt(stats.pct_t, true))}%`,
      BOY_BLUE,
      GIRL_RED,
    ) +
    `<tr><td colspan=4 style="${stB}; text-align:center; font-weight:bold;">Taux de R&eacute;ussite : ${esc(fmt(stats.pct_t, true))}%</td></tr>` +
    `</table>`;

  // Signatures — libellés soulignés MAJUSCULES + noms affichés par le PDF
  // (CSS uppercase) ou pointillés identiques quand le nom est absent.
  const sigCell = (label: string, name: string) =>
    `<td style="border:2px solid ${GREEN}; padding:6px; vertical-align:bottom; width:27%;">` +
    `<p style="text-decoration:underline; text-transform:uppercase; font-size:11px; font-weight:bold;">${label}</p>` +
    `<p style="margin-top:26px; text-transform:uppercase; font-size:11px; font-weight:bold; letter-spacing:0.5px;">${esc(name)}</p>` +
    `</td>`;
  const directeur = (data.director_name || "").trim().toUpperCase() || DOTS_SIG;
  const inspecteur = (data.inspector_name || "").trim().toUpperCase() || DOTS_SIG;

  return buildWordShell({
    title: `Relevé de notes ${data.class_name} — ${data.school_name}`,
    orientation: RELEVE_ORIENTATION,
    marginMm: RELEVE_MARGIN_MM,
    styles: `
table.hdr { border-collapse:collapse; width:100%; }
table.hdr td { border:none; vertical-align:top; font-size:11px; line-height:1.35; }
.titre { display:inline-block; border:2px solid ${GREEN}; background:${TITLE_BG}; border-radius:16px; padding:5px 22px 6px; font-size:13px; font-weight:bold; letter-spacing:0.5px; }
.bandeau { display:inline-block; background:${BAND_BG}; color:#fff; font-weight:bold; font-size:14px; letter-spacing:2px; padding:2px 22px 3px; margin-top:10px; text-transform:uppercase; }
table.doc { border-collapse:collapse; width:100%; table-layout:fixed; }
table.doc th, table.doc td { overflow-wrap:break-word; }
thead.rep { display:table-header-group; }
table.stat { border-collapse:collapse; width:100%; }
table.final { border-collapse:collapse; width:100%; margin-top:8px; }
table.final td { border:none; vertical-align:top; }
`,
    bodyHtml: `
<table class=hdr><tr>
<td style="width:34%">
<p><b>Minist&egrave;re de l'Education Nationale</b></p>
<p><b>Et de l'Alphab&eacute;tisation</b></p>
<p><i>Direction R&eacute;gionale de ${esc(data.iep_region)}</i></p>
<p><b>Inspection de l'Enseignement</b></p>
<p><b>Pr&eacute;scolaire et Primaire de ${esc(data.iep_name)}</b></p>
<p>BP : ${esc(data.iep_bp || DOTS_BP)} / Tel : ${esc(data.inspector_phone || DOTS_TEL)}</p>
<p>Courriel : <span style="color:${EMAIL_BLUE}; text-decoration:underline;">${esc(data.inspector_email || DOTS_MAIL)}</span></p>
</td>
<td style="width:32%; text-align:center;">
<p><span class=titre>${esc(data.title)}</span></p>
<p><span class=bandeau>${esc(data.type_examen)}</span></p>
</td>
<td style="width:34%; text-align:center;">
<p><b>R&eacute;publique de C&ocirc;te d'Ivoire</b></p>
<p><i>Union-Discipline-Travail</i></p>
</td>
</tr></table>
<table class=hdr><tr>
<td style="width:55%"><p style="font-size:12px; font-weight:bold; text-transform:uppercase;">ECOLE : ${esc(data.school_name)}</p>
<p style="font-size:12px; font-weight:bold; text-transform:uppercase;">CODE : ${esc(data.school_code)}</p></td>
<td style="width:45%; text-align:right;"><p style="font-size:11px; font-weight:bold; letter-spacing:1px;">G ${data.total_g} &nbsp; F ${data.total_f} &nbsp; T ${data.total_t}</p>
<p style="font-size:11px; font-weight:bold;">Date: ${esc(data.date)}</p></td>
</tr></table>
<table class=doc>
<colgroup>
<col style="width:${wNum}%">
<col style="width:${wMat}%">
<col style="width:${wNom}%">
<col style="width:${wPrenoms}%">
${subjects.map(() => `<col style="width:${wSubj}%">`).join("")}
<col style="width:${wTotal}%">
<col style="width:${wMoy}%">
<col style="width:${wObs}%">
</colgroup>
<thead class=rep><tr>${headCells}</tr></thead>
<tbody>${body}</tbody>
</table>
<table class=final><tr>
<td style="width:46%">${statsTable}</td>
${sigCell("Le Directeur", directeur)}
${sigCell("L'Inspecteur", inspecteur)}
</tr></table>
`,
  });
}

// === MODÈLE EXCEL (.xlsx) — classeur mis en page (exceljs) ===
// En-tête institutionnel fusionné (ministère, République, boîte du titre
// sur fond pastel orange, bandeau orange du type d'examen, école/code +
// G/F/T + date), entêtes du tableau sur FOND VERT texte blanc (EPS sur
// jaune, comme le PDF), données avec les mêmes valeurs formatées, stats
// du bas, signatures ; impression portrait ajustée à 1 page de large,
// ligne d'entêtes répétée à chaque page.
async function exportReleveExcelAsync(data: ReleveData): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";

  // Matières (libellés abrégés, comme les entêtes du PDF)
  const subjects: { name: string; display_name: string }[] =
    data.students[0]?.grades?.map((g) => ({
      name: g.subject_name,
      display_name: abbreviateSubject(g.subject_name),
    })) ?? [];
  const stats = data.stats;
  const compact = subjects.length > 6;
  const nCols = 8 + subjects.length; // N° Mat Nom Pré + matières + Total Moy Obs

  const ws = wb.addWorksheet("Releve Notes", {
    views: [{ state: "frozen", ySplit: 8, showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      printTitlesRow: "8:8", // la ligne d'entêtes du tableau se répète
    },
  });
  ws.columns = [
    4.5, 14, 16, 24,
    ...subjects.map(() => (compact ? 4.5 : 7)),
    7, 7, 8,
  ].map((width) => ({ width }));

  // Police Arial partout (demande utilisateur)
  const font = (size: number, bold = false, color?: string, italic = false, underline = false) => ({
    name: "Arial",
    size,
    bold,
    italic,
    underline,
    ...(color ? { color: { argb: color } } : {}),
  });
  const GREEN_X = { argb: "FF009E60" };
  const TITLE_BG_X = { argb: "FFFDEBDA" };
  const BAND_BG_X = { argb: "FFF77F00" };
  const EPS_HEAD_X = { argb: "FFFDE047" }; // bg-yellow-300 (entête EPS du PDF)
  const EPS_CELL_X = { argb: "FFFEF08A" }; // bg-yellow-200 (cellules EPS)
  const RED_X = "FFDC2626"; // text-red-600 (filles)
  const BLUE_X = "FF1D4ED8"; // text-blue-700 (valeurs G)
  const ADMIS_X = "FF047857"; // text-emerald-700 (ligne Admis)
  const GRAY_X = "FF4B5563"; // text-gray-600 (entête T)
  const border = { style: "thin" as const, color: GREEN_X };
  const BOX = { top: border, left: border, bottom: border, right: border };
  const fill = (argb: { argb: string }) => ({
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: argb,
  });

  const merged = (
    row: number,
    c1: number,
    c2: number,
    text: string,
    f: ReturnType<typeof font>,
    align: "left" | "center" | "right" = "center",
  ) => {
    ws.mergeCells(row, c1, row, c2);
    const c = ws.getCell(row, c1);
    c.value = text;
    c.font = f;
    c.alignment = { horizontal: align, vertical: "middle", wrapText: true };
    return c;
  };

  // --- En-tête institutionnel (fidèle au rendu PDF) ---
  merged(1, 1, nCols, "Ministère de l'Education Nationale Et de l'Alphabétisation", font(12, true));
  merged(
    2,
    1,
    nCols,
    `Direction Régionale de ${data.iep_region} — Inspection de l'Enseignement Préscolaire et Primaire de ${data.iep_name}`,
    font(11, true, undefined, true),
  );
  merged(3, 1, nCols, `BP : ${data.iep_bp || DOTS_BP} / Tel : ${data.inspector_phone || DOTS_TEL} — Courriel : ${data.inspector_email || DOTS_MAIL}`, font(10));
  merged(4, 1, nCols, "République de Côte d'Ivoire — Union-Discipline-Travail", font(11, true));
  // Boîte du titre : fond pastel orange bordé de vert (comme le PDF)
  const titreCell = merged(5, 1, nCols, data.title, font(13, true));
  titreCell.border = BOX;
  titreCell.fill = fill(TITLE_BG_X);
  // Bandeau orange du type d'examen (texte blanc, majuscules)
  const bandeau = merged(6, 1, nCols, (data.type_examen || "").toUpperCase(), font(12, true, "FFFFFFFF"));
  bandeau.fill = fill(BAND_BG_X);
  // Ligne école / code + G F T + date
  merged(7, 1, 5, `ECOLE : ${data.school_name} — CODE : ${data.school_code}`, font(11, true), "left");
  merged(7, 6, nCols - 2, `G ${data.total_g}   F ${data.total_f}   T ${data.total_t}`, font(10, true), "right");
  merged(7, nCols - 1, nCols, `Date: ${data.date}`, font(10, true), "right");

  // --- Entêtes du tableau (fond vert, texte blanc — EPS sur jaune) ---
  const headLabels = [
    "N°",
    "Matricule",
    "Nom",
    "Prénoms",
    ...subjects.map((s) => s.display_name),
    "Total",
    "Moy.",
    "Obs.",
  ];
  const headRow = ws.getRow(8);
  headRow.values = headLabels;
  headRow.height = compact ? 34 : 22;
  // Boucle explicite sur TOUTES les colonnes (getCell matérialise chaque
  // cellule → bordures garanties même si une valeur est vide).
  for (let col = 1; col <= nCols; col++) {
    const c = headRow.getCell(col);
    c.border = BOX;
    c.font = font(9, true, "FFFFFFFF");
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.fill = fill(GREEN_X);
    // Fidèle au PDF : l'entête de la colonne EPS est JAUNE (texte blanc)
    const subjIdx = col - 5;
    if (subjIdx >= 0 && subjIdx < subjects.length && isEPS(subjects[subjIdx].name)) {
      c.fill = fill(EPS_HEAD_X);
    }
  }

  // --- Lignes élèves (numérotation continue, filles en rouge, EPS surlignée) ---
  data.students.forEach((e, i) => {
    const fille = e.gender === "F";
    const r = 9 + i;
    const values: Array<string | number> = [
      i + 1,
      e.matricule,
      e.last_name.toUpperCase(),
      e.first_name.toUpperCase(),
      ...subjects.map((_s, idx) => {
        const g = e.grades[idx];
        return g ? fmt(g.value, g.has_grade) : "—";
      }),
      e.has_average ? fmt(e.total, true) : "—",
      e.has_average ? fmt(e.average, true) : "—",
      e.observation,
    ];
    const row = ws.getRow(r);
    row.values = values;
    row.height = 15;
    // Boucle explicite sur TOUTES les colonnes (observation peut être vide).
    for (let col = 1; col <= nCols; col++) {
      const c = row.getCell(col);
      c.border = BOX;
      const bold = col <= 4 || col >= nCols - 2; // N° Mat Nom Pré + Total Moy Obs
      c.font = font(10, bold, fille && (col === 3 || col === 4) ? RED_X : undefined);
      c.alignment =
        col === 3 || col === 4
          ? { horizontal: "left", vertical: "middle", wrapText: true }
          : { horizontal: "center", vertical: "middle", wrapText: true };
      // Cellules EPS surlignées en jaune et en gras (comme le PDF)
      const subjIdx = col - 5;
      if (subjIdx >= 0 && subjIdx < subjects.length && isEPS(subjects[subjIdx].name)) {
        c.fill = fill(EPS_CELL_X);
        c.font = font(10, true);
      }
    }
  });

  // --- Bloc statistiques (mêmes lignes/couleurs que le bloc du PDF) ---
  const rStat = 9 + data.students.length + 1; // 1 rangée d'aération
  const statHead = ws.getRow(rStat);
  statHead.values = ["", "G", "F", "T"];
  const statRows: Array<[string, string, string, string, string | undefined, string | undefined, string | undefined]> = [
    ["Inscrits", `${stats.inscrits_g}`, `${stats.inscrits_f}`, `${stats.inscrits_t}`, BLUE_X, RED_X, undefined],
    ["Présents", `${stats.presents_g}`, `${stats.presents_f}`, `${stats.presents_t}`, BLUE_X, RED_X, undefined],
    ["Admis", `${stats.admis_g}`, `${stats.admis_f}`, `${stats.admis_t}`, ADMIS_X, ADMIS_X, ADMIS_X],
    [
      "% Admis",
      `${fmt(stats.pct_g, true)}%`,
      `${fmt(stats.pct_f, true)}%`,
      `${fmt(stats.pct_t, true)}%`,
      BLUE_X,
      RED_X,
      undefined,
    ],
  ];
  statRows.forEach(([label, g, f, t, cg, cf, ct], k) => {
    const r = rStat + 1 + k;
    const row = ws.getRow(r);
    row.values = [label, g, f, t];
    row.height = 14;
    for (let col = 1; col <= 4; col++) {
      const c = row.getCell(col);
      c.border = BOX;
      if (col === 1) {
        c.font = font(10, true);
        c.alignment = { horizontal: "left", vertical: "middle" };
      } else {
        const color = col === 2 ? cg : col === 3 ? cf : ct;
        c.font = font(10, true, color);
        c.alignment = { horizontal: "center", vertical: "middle" };
      }
    }
  });
  // Entête G/F/T du bloc stats (couleurs des libellés du PDF)
  ws.getCell(rStat, 2).font = font(10, true, BLUE_X);
  ws.getCell(rStat, 3).font = font(10, true, RED_X);
  ws.getCell(rStat, 4).font = font(10, true, GRAY_X);
  for (let col = 1; col <= 4; col++) {
    ws.getCell(rStat, col).border = BOX;
    ws.getCell(rStat, col).alignment = { horizontal: col === 1 ? "left" : "center", vertical: "middle" };
  }
  // Taux de réussite (valeur en vert, comme le % géant du PDF)
  const rTaux = rStat + 1 + statRows.length;
  const taux = merged(rTaux, 1, 4, `Taux de Réussite : ${fmt(stats.pct_t, true)}%`, font(10, true, ADMIS_X), "left");
  taux.border = BOX;

  // --- Signatures (mêmes libellés et repli en pointillés que le PDF) ---
  const rSig = rTaux + 2;
  const sigCols: Array<[number, string, string]> = [
    [2, "Le Directeur", (data.director_name || "").trim().toUpperCase() || DOTS_SIG],
    [Math.min(nCols - 2, 8), "L'Inspecteur", (data.inspector_name || "").trim().toUpperCase() || DOTS_SIG],
  ];
  for (const [col, label, name] of sigCols) {
    const lab = ws.getCell(rSig, col);
    lab.value = label;
    lab.font = font(11, true, undefined, false, true);
    const nm = ws.getCell(rSig + 2, col);
    nm.value = name;
    nm.font = font(10, true);
  }

  // --- Armoiries (meilleur effort — omises si indisponibles) ---
  try {
    const res = await fetch("/ci-coat-of-arms.png");
    if (res.ok) {
      const u8 = new Uint8Array(await res.arrayBuffer());
      const imgId = wb.addImage({
        buffer: u8 as unknown as Parameters<typeof wb.addImage>[0]["buffer"],
        extension: "png",
      });
      ws.addImage(imgId, { tl: { col: nCols - 1.6, row: 0.2 }, ext: { width: 46, height: 46 } });
    }
  } catch {
    // armoiries omises — l'en-tête reste lisible
  }

  const buf = await wb.xlsx.writeBuffer();
  // Nom de fichier : releve-notes-<slug classe>-<slug session>.xlsx
  saveBlob(
    new Blob([buf], { type: XLSX_MIME }),
    `releve-notes-${slugFile(data.class_name)}-${slugFile(`${data.type_examen} — ${data.month}-${data.year}`)}.xlsx`,
  );
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
  // Export Word/Excel en cours (« doc » | « xlsx » | null) — hook placé
  // AVANT tout retour conditionnel (règle des Hooks).
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);

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
    // Sandbox : la query contient déjà « ?session_id=… » → séparateur « & »
    // (aligné sur buildUrl de lib/api.ts ; avant : double « ? » → le
    // paramètre XTransformPort était avalé par class_id → 404 en dev local).
    const separator = apiBase ? "" : "&XTransformPort=8080";
    const url = `${apiBase}/api/reports/releve-data?session_id=${encodeURIComponent(sessionId)}&class_id=${encodeURIComponent(classId)}${separator}`;

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

  const subjects: { name: string; display_name: string; max_score: number }[] =
    data.students[0]?.grades?.map((g) => ({
      name: g.subject_name,
      display_name: abbreviateSubject(g.subject_name),
      max_score: g.max_score,
    })) ?? [];
  const stats = data.stats;
  // Largeur disponible pour la colonne Prénoms (dépend du nombre de
  // matières) — sert à ESTIMER le coût en lignes de chaque identité pour
  // la pagination (les noms/prénoms sont désormais toujours entiers).
  const prenomWidth = getAvailableWidthForPrenoms(subjects.length);
  const pages = chunkStudents(data.students, prenomWidth);
  // Numérotation continue : offset cumulé d'élèves avant chaque page.
  const pageOffsets: number[] = [];
  let studentAcc = 0;
  for (const p of pages) {
    pageOffsets.push(studentAcc);
    studentAcc += p.length;
  }

  // Étiquette « session » pour les noms de fichiers : type d'examen +
  // mois-année (même convention que le nom de PDF dynamique du document).
  const fileBase = `releve-notes-${slugFile(data.class_name)}-${slugFile(
    `${data.type_examen} — ${data.month}-${data.year}`,
  )}`;
  // Alias const typé ReleveData (data est non-null après le retour
  // conditionnel) — les handlers ci-dessous captent ce type étroit.
  const releveData = data;

  // Modèle WORD (.doc) — HTML MSO A4 portrait fidèle au rendu PDF.
  function handleWord() {
    setExporting("doc");
    try {
      saveWordDoc(buildReleveWordHtml(releveData), `${fileBase}.doc`);
    } finally {
      setExporting(null);
    }
  }

  // Modèle EXCEL (.xlsx) — classeur mis en page (exceljs importé à la demande).
  async function handleExcel() {
    setExporting("xlsx");
    try {
      await exportReleveExcelAsync(releveData);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="bg-gray-100 min-h-screen py-8 print:bg-white print:p-0 print:py-0">
      {/* Barre d'outils — cachée à l'impression */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Relevé de Notes — {data.class_name} · Aperçu
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
              {/* Armoiries de la Côte d'Ivoire en FILIGRANE (fond) —
                  rubans tricolores haut/bas RETIRÉS (feuilles imprimables
                  sans drapeaux sur les bordures) */}
              <CIArmoiriesWatermark opacity={0.06} width="52%" />
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

                      {/* Titre Centre — boîte bordée de VERT DRAPEAU sur
                          fond pastel orange (inspiration bulletins) */}
                      <div className="flex flex-col items-center mt-2">
                        <div
                          className="border-2 border-[#009E60] rounded-[2rem] px-8 py-2 font-bold text-sm tracking-wide"
                          style={{ background: "#FDEBDA", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
                        >
                          {data.title}
                        </div>
                        {/* Bandeau ORANGE DRAPEAU (texte blanc) — comme le
                            bandeau « DÉCISION DU CONSEIL DES MAÎTRES » du
                            bulletin individuel */}
                        <div
                          className="text-white font-bold text-base px-8 py-1.5 mt-4 tracking-widest uppercase"
                          style={{ background: "#F77F00", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
                        >
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
                  <div className="flex justify-between items-center border-b border-[#009E60] pb-1 mb-3 text-[11px] font-bold">
                    <span>{data.school_name} — {data.title}</span>
                    <span>Page {pageIndex + 1} / {pages.length}</span>
                  </div>
                )}

                {/* === 3. TABLEAU DES NOTES (Colonnes dynamiques, sans barème) === */}
                <table className="w-full border-collapse border border-[#009E60] text-center text-[11px]">
                  <thead>
                    <tr
                      className="font-bold text-white"
                      style={{ background: "#009E60", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}
                    >
                      <th className="border border-[#009E60] p-0 text-[11px]" style={{ minWidth: "18px", maxWidth: "24px" }}>N°</th>
                      <th className="border border-[#009E60] p-0 text-[11px] whitespace-nowrap" style={{ minWidth: "65px", maxWidth: "75px" }}>Matricule</th>
                      <th className="border border-[#009E60] p-0 text-[11px] whitespace-nowrap" style={{ minWidth: "48px" }}>Nom</th>
                      {/* Prénoms : pas de largeur fixe → s'étend dynamiquement */}
                      <th className="border border-[#009E60] p-0.5 text-[11px]">Prénoms</th>
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
                            className={`border border-[#009E60] p-0.5 text-center ${isEPS(s.name) ? "bg-yellow-300" : ""}`}
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
                          className={`border border-[#009E60] p-0.5 text-center`}
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
                      const num = pageOffsets[pageIndex] + i + 1;
                      const isFille = e.gender === "F";
                      return (
                        <tr key={num} className="h-4">
                          <td className="border border-[#009E60] p-0 font-semibold text-[11px]">{num}</td>
                          <td className="border border-[#009E60] p-0 font-bold text-[11px] font-mono">{e.matricule}</td>
                          <td className={`border border-[#009E60] p-0 px-0.5 text-left font-bold break-words leading-[1.15] text-[11px] ${isFille ? 'text-red-600' : ''}`}>
                            {e.last_name.toUpperCase()}
                          </td>
                          <td className={`border border-[#009E60] p-0 px-0.5 text-left font-bold break-words leading-[1.15] text-[11px] ${isFille ? 'text-red-600' : ''}`}>
                            {e.first_name.toUpperCase()}
                          </td>
                          {subjects.map((subj, idx) => {
                            const g = e.grades[idx];
                            const val = g ? fmt(g.value, g.has_grade) : "—";
                            return (
                              <td
                                key={idx}
                                className={`border border-[#009E60] p-0 text-[11px] ${isEPS(subj.name) ? "bg-yellow-200 font-bold" : ""}`}
                              >
                                {val}
                              </td>
                            );
                          })}
                          <td className="border border-[#009E60] p-0 font-bold text-[11px]">
                            {e.has_average ? fmt(e.total, true) : "—"}
                          </td>
                          <td className="border border-[#009E60] p-0 font-bold text-[11px]">
                            {e.has_average ? fmt(e.average, true) : "—"}
                          </td>
                          <td className="border border-[#009E60] p-0 font-bold text-[11px]">{e.observation}</td>
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
                  <div className="border-2 border-[#009E60] rounded-lg overflow-hidden">
                    {/* En-tête avec images garçon/fille */}
                    <div className="grid grid-cols-4 bg-white text-[11px] font-bold border-b-2 border-[#009E60]">
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
                  <div className="border-2 border-[#009E60] rounded-lg p-1.5 flex flex-col justify-between min-h-[90px]">
                    <span className="underline uppercase text-[11px]">Le Directeur</span>
                    <div className="flex-grow"></div>
                    <span className="uppercase text-[11px] tracking-wide">
                      {data.director_name || "................................"}
                    </span>
                  </div>

                  {/* Bloc Inspecteur compact */}
                  <div className="border-2 border-[#009E60] rounded-lg p-1.5 flex flex-col justify-between min-h-[90px]">
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
