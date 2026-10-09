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
//   - POLICE AGENCY FB, taille 12 (demande utilisateur) — Arial/Helvetica
//     en secours si la police n'est pas installée sur le poste ;
//   - AUCUNE ligne vide de complétion (demande utilisateur : « annuler les
//     lignes qui ne comportent pas d'écriture ») — seules les lignes des
//     élèves réels sont imprimées ;
//   - 3 modèles d'impression (demande utilisateur) : PDF (impression
//     navigateur), WORD (.doc HTML MSO A4 paysage, en-tête + thead répété)
//     et EXCEL (.xlsx exceljs : en-tête fusionné, tableau bordé, paysage) ;
//   - Pagination MESURÉE — fix « le PDF n'affiche pas tous les noms à
//     imprimer » : les quotas 15 lignes (page 1) / 25 (suivantes) restent
//     la règle mais en MAXIMA, remplis selon la hauteur RÉELLE de chaque
//     ligne (mesurée dans le navigateur à la largeur d'impression 267mm).
//     L'ancien découpe comptait chaque ligne pour exactement 6,4mm : dès
//     qu'un nom long revenait sur deux lignes, la page débordait de sa
//     boîte 192mm à overflow:hidden et les DERNIÈRES lignes étaient
//     rognées — d'où des noms manquants à l'impression. Désormais :
//     minHeight + plus aucun overflow:hidden → aucune ligne rognable ;
//     la signature « LE DIRECTEUR » (soulignée) vient juste après la
//     dernière ligne du tableau, NOM du directeur 15 MM plus bas (espace
//     de signature) ;
//   - Numéro de page en haut au centre (comme le modèle) ; le pied
//     « ELEVES (n) » du bas de page est SUPPRIMÉ (demande utilisateur :
//     « enlever le nombre qui se trouve au bas des feuilles ») — idem
//     modèles Word et Excel ;
//   - Convention maison : noms/prénoms des FILLES en rouge (comme les
//     tableaux de classement et « RESULTATS DE FIN D'ANNEE »).

import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, Loader2, Printer, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

// Type seul (effacé au runtime) — le module exceljs reste importé
// dynamiquement dans exportExcelAsync (chunk séparé).
import type { Worksheet } from "exceljs";

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
import { canExportFiles, ExportLockBadge } from "@/lib/doc-export";

// POLICE AGENCY FB taille 12 (demande utilisateur) — Agency FB est une
// police Windows standard ; Arial/Helvetica/Liberation Sans en secours
// (poste non Windows).
const DOC_FONT =
  '"Agency FB", "Arial", "Helvetica", "Liberation Sans", sans-serif';

// === Pagination MESURÉE (A4 paysage : zone imprimable 194mm, boîte page
// 192mm — padding 6mm haut/bas → 180mm utiles) ===
// Règle utilisateur conservée : 15 lignes sur la page 1, 25 sur les
// suivantes, signature « LE DIRECTEUR » juste après la dernière ligne +
// 15mm + NOM. Mais les lignes ne font pas toutes 6,4mm : un nom/prénoms
// long revient sur deux lignes et la ligne du tableau s'ajuste (demande
// session 40 : tous les noms écrits en entier). Le découpe précédent
// comptait chaque ligne pour exactement 6,4mm : dès qu'une ligne
// grandissait, la page débordait de sa boîte 192mm à overflow:hidden et
// les dernières lignes étaient ROGNÉES (noms manquants à l'impression).
// Désormais les pages sont remplies selon la hauteur RÉELLE de chaque
// ligne (mesurée dans le navigateur à la largeur d'impression 267mm) :
//   - page 1    : en-tête mesuré + 3mm + en-têtes tableau mesurés +
//                 lignes ≤ 180mm utiles (et ≤ 15 lignes) ;
//   - suivantes : 3mm + en-têtes + lignes ≤ 180mm (et ≤ 25 lignes) ;
//   - dernière  : la zone signature mesurée est RÉSERVÉE — on n'y place
//                 que ce qui tient avec elle (plafond 21 lignes conservé) ;
//   - filet de sécurité : boîtes minHeight 192mm et plus aucun
//                 overflow:hidden → AUCUNE ligne ne peut être rognée.
const SIG_GAP_MM = 15;     // distance « LE DIRECTEUR » → NOM (demande utilisateur)
const ROWS_FIRST = 15;     // quota MAX de lignes page 1 (demande utilisateur)
const ROWS_MID = 25;       // quota MAX de lignes pages suivantes (demande utilisateur)
const SIGN_CAP = 21;       // max de lignes sur la page signature (conservé)
const ROW_MM = 6.4;        // hauteur nominale d'une ligne (police 12) — secours mesure
const USABLE_MM = 180;     // 192mm boîte - padding 6mm × 2
const MEASURE_W_MM = 267;  // largeur d'impression exacte : 281mm - padding 7mm × 2

const ROW_HEIGHT = "6.4mm";

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
// Largeurs rééquilibrées (révision 2 puis 3 — demande utilisateur) :
// révision 3 : MATRICULE réduite (8% → 7%), LIEUACTE élargie
// (5,5% → 6,5%). Libellés en minuscules comme le modèle.
const COLS: Array<{
  w: string;
  label: string;
  align: "left" | "center";
}> = [
  { w: "3%", label: "n°", align: "center" },
  { w: "7%", label: "matricule", align: "center" },
  { w: "7.5%", label: "nom", align: "left" },
  { w: "16.5%", label: "prenoms", align: "left" },
  { w: "3%", label: "sexe", align: "center" },
  { w: "14%", label: "date et lieu de naissance", align: "left" },
  { w: "7.5%", label: "nationalite", align: "left" },
  { w: "12.5%", label: "nom et prénoms du père", align: "left" },
  { w: "11.5%", label: "nom et prénoms de la mère", align: "left" },
  { w: "4.5%", label: "nacte", align: "center" },
  { w: "6.5%", label: "date de l'acte", align: "center" },
  { w: "6.5%", label: "lieuacte", align: "center" },
];

// AUCUNE ligne vide de complétion (demande utilisateur : « annuler les
// lignes qui ne comportent pas d'écriture ») — une page ne contient que
// les lignes des élèves réels.
type DocPage = StudentWithClass[];

// Découpe la classe en pages à QUOTAS COMPTÉS : 15 lignes sur la page 1,
// 25 sur les suivantes (demande utilisateur — comptées, sans aucune
// estimation de hauteur). La DERNIÈRE page porte la zone signature :
// elle reçoit au plus SIGN_CAP lignes pour que « LE DIRECTEUR » (juste
// après la dernière ligne) + 15mm + NOM tiennent sur la page ; si les
// lignes restantes dépassent ce plafond sans pouvoir remplir une page
// entière (reste entre SIGN_CAP+1 et 25), la page courante rend toutes
// les lignes sauf UNE — la dernière page n'est jamais chevauchée ni
// vide.
function buildPages(students: StudentWithClass[]): DocPage[] {
  const n = students.length;
  if (n === 0) return [[]]; // page d'en-tête + signature même à effectif nul
  const pages: DocPage[] = [];
  let i = 0;
  while (i < n) {
    const quota = pages.length === 0 ? ROWS_FIRST : ROWS_MID;
    const remaining = n - i;
    if (remaining <= quota) {
      if (remaining <= SIGN_CAP) {
        // Dernière page : toutes les lignes restantes + zone signature.
        pages.push(students.slice(i));
      } else {
        // Reste trop plein pour la signature : cette page rend toutes
        // les lignes sauf UNE, la dernière page reçoit la ligne restante
        // ET la zone signature (ajustée à la page).
        pages.push(students.slice(i, n - 1));
        pages.push(students.slice(n - 1));
      }
      break;
    }
    // Page pleine au quota exact : 15 (page 1) puis 25 (suivantes).
    pages.push(students.slice(i, i + quota));
    i += quota;
  }
  return pages;
}

// Référence stable « liste vide » — évite de relancer la mesure du même
// payload à chaque rendu.
const EMPTY_STUDENTS: StudentWithClass[] = [];

// Pagination MESURÉE : remplit chaque page selon les hauteurs RÉELLES
// (mm) mesurées dans le navigateur — quotas 15/25 en MAXIMA, zone
// signature réservée sur la dernière page. Garantit qu'aucune ligne ne
// dépasse la boîte de page (donc qu'aucun nom n'est rogné à l'impression)
// tout en conservant la règle utilisateur 15/25 quand les lignes sont
// droites (6,4mm).
function paginateMeasured(
  students: StudentWithClass[],
  heights: number[],
  hHeader: number,
  hThead: number,
  hSig: number,
): DocPage[] {
  const n = students.length;
  if (n === 0) return [[]]; // page d'en-tête + signature même à effectif nul
  const h = (k: number) => heights[k] || ROW_MM; // secours si mesure absente
  const sumFrom = (from: number) => {
    let s = 0;
    for (let k = from; k < n; k++) s += h(k);
    return s;
  };
  // Capacités (mm) par type de page — planchers de sécurité.
  const capFirst = Math.max(USABLE_MM - hHeader - 3 - hThead, 40);
  const capMid = Math.max(USABLE_MM - 3 - hThead, 40);
  const capSigFirst = Math.max(capFirst - hSig, 20);
  const capSigMid = Math.max(capMid - hSig, 20);
  const pages: DocPage[] = [];
  let i = 0;
  while (i < n) {
    const isFirst = pages.length === 0;
    const quota = isFirst ? ROWS_FIRST : ROWS_MID;
    const capPage = isFirst ? capFirst : capMid;
    const capSig = isFirst ? capSigFirst : capSigMid;
    const remaining = n - i;
    // Tout le reste tient sur cette page AVEC la zone signature → on
    // termine ici (dernière page).
    if (remaining <= SIGN_CAP && sumFrom(i) <= capSig) {
      pages.push(students.slice(i));
      break;
    }
    // Remplissage au quota / à la capacité réelle — on garde toujours au
    // moins UNE ligne pour la page signature finale (jamais de tableau
    // plein sans place pour « LE DIRECTEUR »).
    const takeMax = Math.min(quota, remaining - 1);
    let take = 0;
    let used = 0;
    while (take < takeMax && used + h(i + take) <= capPage) {
      used += h(i + take);
      take++;
    }
    if (take === 0) take = 1; // ligne plus haute que la page : jamais de ligne abandonnée
    pages.push(students.slice(i, i + take));
    i += take;
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
  // Nom du directeur signataire (demande utilisateur : inscrit sous
  // « LE DIRECTEUR » dans les 3 modèles).
  directeur: string;
  // Pages déjà calculées par la pagination mesurée du modèle PDF — les
  // modèles Word et Excel reprennent EXACTEMENT les mêmes pages
  // (fallback : quotas comptés 15/25).
  pages?: DocPage[];
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
// encadré, UNE table 12 colonnes bordée par page selon les MÊMES pages que
// le modèle PDF (pagination mesurée partagée, fallback quotas 15/25 — saut
// de page Word explicite entre les tables, le <br> empêche aussi Word de
// fusionner les tables adjacentes), signature « LE DIRECTEUR » (juste
// après la dernière ligne du tableau, NOM 15 mm plus bas). Aucune ligne
// vide ; pied « ELEVES (n) » SUPPRIMÉ (demande utilisateur).
async function buildWordHtml(o: CandidatsExportData): Promise<string> {
  const armoiries = await armoiriesBase64();
  const iep = o.iep;
  const th = COLS.map((c) => `<th>${escHtml(c.label)}</th>`).join("");
  const colgroup = COLS.map((c) => `<col style="width:${c.w}">`).join("");
  // Pages QUOTAS 15/25 — numérotation continue des lignes d'une page à
  // l'autre (identique au modèle PDF).
  let numero = 0;
  const tables = (o.pages ?? buildPages(o.students))
    .map((rows, p) => {
      const body = rows
        .map((s) => {
          numero++;
          const red = s.gender === "F" ? ` style="color:#dc2626"` : "";
          const td = (v: string, extra = "") => `<td${extra}>${escHtml(v)}</td>`;
          return (
            `<tr>` +
            td(String(numero)) +
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
      const brk =
        p === 0
          ? ""
          : `<br clear=all style='mso-special-character:line-break;page-break-before:always'>`;
      return `${brk}<table class=doc><colgroup>${colgroup}</colgroup><thead class=rep><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
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
body { font-family:'Agency FB',Arial,Helvetica,sans-serif; font-size:12px; color:#000; }
p { margin:0; }
table.hdr { border-collapse:collapse; width:100%; }
table.hdr td { border:none; vertical-align:top; font-size:12px; line-height:1.3; }
table.doc { border-collapse:collapse; width:100%; table-layout:fixed; }
table.doc td, table.doc th { border:1px solid #000; padding:0 3px; font-size:12px; vertical-align:middle; overflow-wrap:break-word; }
table.doc th { font-weight:bold; text-align:center; height:8mm; }
table.doc td { height:6.4mm; } /* lignes 6,4mm — quotas comptés 15/25 (demande utilisateur) */
thead.rep { display:table-header-group; }
.titre { display:inline-block; border:2px solid #000; padding:7px 20px 8px; font-size:16px; font-weight:bold; text-align:center; line-height:1.35; }
.sig { font-weight:bold; text-decoration:underline; margin-top:3mm; } /* juste après la dernière ligne (demande utilisateur) */
/* NOM 15 mm sous « LE DIRECTEUR » — espace de signature (demande utilisateur) */
.signame { font-weight:bold; text-transform:uppercase; letter-spacing:0.3px; margin-top:${SIG_GAP_MM}mm; }
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
${tables}
<p class=sig>LE DIRECTEUR</p>
${o.directeur.trim() ? `<p class=signame>${escHtml(o.directeur.trim().toUpperCase())}</p>` : ""}
</div>
</body>
</html>`;
}

// Modèle EXCEL (.xlsx) — classeur mis en page (exceljs, import dynamique) :
// en-tête officiel fusionné + armoiries, tableau 12 colonnes bordé (filles en
// rouge), signature « LE DIRECTEUR » (pied « ELEVES (n) » SUPPRIMÉ — demande
// utilisateur), impression paysage ajustée à 1 page de large avec répétition
// de la ligne d'en-têtes, et SAUTS DE PAGE aux MÊMES pages que le modèle PDF
// (pagination mesurée partagée, fallback quotas 15/25 — rowBreaks).
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
  // Révision 3 : matricule réduite (13 → 11), lieuacte élargie (13 → 15).
  const colWidths = [4, 11, 15, 30, 5, 28, 14, 24, 22, 11, 13, 15];
  ws.columns = colWidths.map((width) => ({ width }));
  const font = (size: number, bold = false, argb?: string) => ({
    name: "Agency FB",
    size,
    bold,
    ...(argb ? { color: { argb } } : {}),
  });

  const merged = (row: number, text: string, size: number, bold = false, italic = false) => {
    ws.mergeCells(row, 1, row, 12);
    const c = ws.getCell(row, 1);
    c.value = text;
    c.font = { name: "Agency FB", size, bold, italic };
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
    const values = [
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
    row.values = values;
    // Hauteur 18pt FIXÉE seulement si aucun texte ne risque de revenir à
    // la ligne ; sinon hauteur AUTO (Excel ajuste la ligne) — un nom
    // long n'est jamais coupé dans la cellule.
    const mayWrap = values.some(
      (v, idx) => String(v ?? "").length > colWidths[idx] * 0.9,
    );
    if (!mayWrap) row.height = 18;
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = EXCEL_BOX;
      c.font = font(10, false, girl && (col === 3 || col === 4) ? "FFDC2626" : undefined);
      c.alignment =
        col === 3 || col === 4 || col === 6 || col === 7 || col === 8 || col === 9
          ? { horizontal: "left", vertical: "middle", wrapText: true }
          : { horizontal: "center", vertical: "middle", wrapText: true };
    });
  });

  // Sauts de page = MÊMES pages que le modèle PDF (pagination mesurée
  // partagée — fallback QUOTAS COMPTÉS 15/25, demande utilisateur) ; la
  // dernière garde la place de la zone signature (LE DIRECTEUR juste
  // après la dernière ligne + 15 mm + NOM) sous le tableau.
  // Ligne 9 = en-têtes du tableau (répétée à l'impression), données à
  // partir de la ligne 10 → un saut après la ligne 9 + lignes cumulées.
  const excelPages = o.pages ?? buildPages(o.students);
  const breaks: Array<{ id: number; max: number; min: number; man: number }> = [];
  let done = 0;
  for (let p = 0; p < excelPages.length - 1; p++) {
    done += excelPages[p].length;
    breaks.push({ id: 9 + done, max: 16383, min: 0, man: 1 });
  }
  // exceljs 4.x sérialise bien rowBreaks (WorksheetModel.rowBreaks →
  // <rowBreaks><brk id max min man/></rowBreaks>) mais ne l'expose pas
  // dans le type public Worksheet — cast ciblé.
  (
    ws as Worksheet & {
      rowBreaks: Array<{ id: number; max: number; min: number; man: number }>;
    }
  ).rowBreaks = breaks;

  const rEnd = 10 + o.students.length;
  // Pied « ELEVES (n) » SUPPRIMÉ (demande utilisateur : « enlever le
  // nombre qui se trouve au bas des feuilles »).
  const dir = ws.getCell(rEnd + 1, 1); // JUSTE APRÈS la dernière ligne
  dir.value = "LE DIRECTEUR";
  dir.font = { name: "Agency FB", size: 11, bold: true, underline: true };
  // 15 mm d'espace de signature entre « LE DIRECTEUR » et son NOM
  // (demande utilisateur) — ligne intercalaire vide (43pt ≈ 15mm).
  ws.getRow(rEnd + 2).height = Math.round((SIG_GAP_MM * 72) / 25.4);
  // Nom du directeur signataire SOUS « LE DIRECTEUR » (demande utilisateur).
  if (o.directeur.trim()) {
    const dirName = ws.getCell(rEnd + 3, 1);
    dirName.value = o.directeur.trim().toUpperCase();
    dirName.font = { name: "Agency FB", size: 10, bold: true };
  }

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
  // Task 71 — production/transfert de fichiers (Word / Excel) réservée
  // au Super Admin (anti-fuite WhatsApp) — le PDF (impression papier)
  // suit la politique print-guard inchangée.
  const canExport = canExportFiles(role);
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["liste-candidats", classId],
    queryFn: () => studentsApi.candidates(classId),
  });

  // Liste source — RÉFÉRENCE STABLE (structurellement partagée par
  // react-query) : la mesure ne se relance que si la liste change vraiment.
  const students: StudentWithClass[] = data?.students ?? EMPTY_STUDENTS;

  // === Pagination MESURÉE en 2 passes (fix « le PDF n'affiche pas tous
  // les noms ») === Passe 1 : rendu masqué à la largeur d'impression
  // EXACTE (267mm) → mesure de l'en-tête, des en-têtes du tableau, de la
  // zone signature et de CHAQUE ligne élève ; paginateMeasured() découpe
  // alors les pages (quotas 15/25 en MAXIMA, signature réservée). Passe
  // 2 : rendu du document paginé, conteneur de mesure démonté.
  // useLayoutEffect → mesure + rendu final AVANT le premier paint.
  const [layout, setLayout] = useState<{
    for: StudentWithClass[];
    pages: DocPage[];
  } | null>(null);
  const pages = layout && layout.for === students ? layout.pages : null;
  const measureRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return; // chargement : pas de conteneur de mesure
    const pxToMm = (px: number) => (px * 25.4) / 96;
    const hHeader = pxToMm(
      root.querySelector<HTMLElement>('[data-measure="header"]')?.offsetHeight ?? 0,
    );
    const hThead = pxToMm(
      root.querySelector<HTMLElement>('[data-measure="thead"]')?.offsetHeight ?? 0,
    );
    const hSig = pxToMm(
      root.querySelector<HTMLElement>('[data-measure="sig"]')?.offsetHeight ?? 0,
    );
    const heights = Array.from(
      root.querySelectorAll<HTMLElement>('[data-measure="row"]'),
    ).map((el) => pxToMm(el.offsetHeight));
    setLayout({
      for: students,
      pages: paginateMeasured(students, heights, hHeader, hThead, hSig),
    });
  }, [students]);

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

  const total = data.count ?? students.length;
  const garcons = students.filter((s) => s.gender === "M").length;
  const filles = students.filter((s) => s.gender === "F").length;

  const iep = data.iep;
  const annee = cepeExamYear();
  const directeur = data.directeur ?? "";

  // Pages calculées par la pagination MESURÉE (null = passe 1 en cours) ;
  // « LE DIRECTEUR » vient juste après la dernière ligne de la DERNIÈRE
  // page, NOM 15 mm plus bas (demande utilisateur).
  const lastPageIdx = pages ? pages.length - 1 : -1;

  // === Blocs PARTAGÉS entre la passe de mesure et le rendu réel ===
  // (une seule source de vérité : les mesures correspondent EXACTEMENT
  // au document imprimé).

  // En-tête institutionnel (page 1).
  const headerBlock = (
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
  );

  // Cellules d'en-tête du tableau (partagées mesure / rendu).
  const headCells = (
    <>
      {COLS.map((c) => (
        <th key={c.label} style={thStyle}>
          {c.label}
        </th>
      ))}
    </>
  );
  const tableHeadRow = <tr>{headCells}</tr>;

  // Une ligne élève complète (numérotation continue d'une page à l'autre)
  // — `measure` renseigné UNIQUEMENT dans la passe de mesure.
  const renderRow = (s: StudentWithClass, numero: number, measure?: string) => (
    <tr key={s.id} data-measure={measure} style={{ pageBreakInside: "avoid" }}>
      <td style={tdStyle("center")}>{numero}</td>
      <td style={tdStyle("center")}>{cell(s?.matricule)}</td>
      <td style={tdStyle("left", s?.gender === "F")}>
        {cell(s?.last_name).toUpperCase()}
      </td>
      <td style={tdStyle("left", s?.gender === "F")}>
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

  // Signature « LE DIRECTEUR » + NOM (15 mm plus bas — demande
  // utilisateur). paddingTop au lieu de marginTop : même rendu, aucune
  // fusion de marges (mesure exacte en passe 1).
  const sigBlock = (
    <div
      style={{
        paddingTop: "3mm",
        fontWeight: 700,
        fontSize: "12px",
        color: INK,
        ...PRINT_COLOR_STYLE,
      }}
    >
      <div style={{ textDecoration: "underline" }}>LE DIRECTEUR</div>
      {directeur ? (
        <div
          style={{
            marginTop: `${SIG_GAP_MM}mm`,
            textTransform: "uppercase",
            letterSpacing: "0.3px",
          }}
        >
          {directeur}
        </div>
      ) : null}
    </div>
  );

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
    directeur,
    pages: pages ?? undefined,
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

      {/* === DOCUMENT OFFICIEL (isolement impression #liste-candidats-doc) === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="liste-candidats-doc"
        className={`mx-auto my-3 ${canPrint ? "" : "print-locked"}`}
        style={{ width: "100%", maxWidth: "281mm", fontFamily: DOC_FONT, color: INK }}
      >
        {pages === null ? (
          /* Passe 1 — MESURE (invisible, largeur d'impression EXACTE
             267mm) : les MÊMES blocs que le document réel pour des mesures
             exactes ; démonté dès que les pages sont calculées. */
          <div
            ref={measureRef}
            aria-hidden
            style={{
              position: "absolute",
              left: "-10000px",
              top: 0,
              width: `${MEASURE_W_MM}mm`,
              visibility: "hidden",
              background: "#ffffff",
            }}
          >
            <div data-measure="header">{headerBlock}</div>
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
                <tr data-measure="thead">{headCells}</tr>
              </thead>
              <tbody>
                {students.map((s, i) => renderRow(s, i + 1, "row"))}
              </tbody>
            </table>
            <div data-measure="sig">{sigBlock}</div>
          </div>
        ) : (
          pages.map((rows, pageIdx) => {
          const isFirst = pageIdx === 0;
          const isLast = pageIdx === lastPageIdx;
          return (
            <div
              key={pageIdx}
              className={`candidats-page bg-white shadow-lg print:shadow-none ${!isLast ? "mb-4 print:mb-0" : ""}`}
              style={{
                position: "relative",
                minHeight: "192mm", // < zone imprimable 194mm — s'ADAPTE si une ligne mesurée est plus haute (plus aucun rognage)
                padding: "6mm 7mm",
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

              {/* --- En-tête complet : page 1 uniquement (bloc partagé
                  headerBlock — mesuré à l'identique en passe 1) --- */}
              {isFirst && headerBlock}

              {/* Espace entre en-tête et tableau — 3mm sur TOUTES les pages */}
              <div style={{ height: "3mm" }} />

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
                <thead>{tableHeadRow}</thead>
                <tbody>
                  {rows.map((s, i) => renderRow(s, idxOffset(pages, pageIdx) + i + 1))}
                </tbody>
              </table>

              {/* Signature « LE DIRECTEUR » + NOM du directeur signataire
                  (demande utilisateur) — EN FLUX, JUSTE APRÈS la dernière
                  ligne du tableau de la DERNIÈRE page : le NOM est imprimé
                  15 mm SOUS « LE DIRECTEUR » (espace de signature). */}
              {isLast && sigBlock}

              {/* Pied « ELEVES (n) » SUPPRIMÉ de toutes les pages
                  (demande utilisateur : « enlever le nombre qui se trouve
                  au bas des feuilles »). */}
            </div>
          );
          })
        )}
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
