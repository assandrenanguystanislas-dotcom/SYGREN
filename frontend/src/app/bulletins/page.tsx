"use client";

// === Page /bulletins — impression A5 paysage des bulletins de notes ===
//
// URL : /bulletins?session_id=ID&t=TOKEN
//   - session_id : requis — ID de la session à imprimer
//   - t          : requis — token JWT (passé par le bouton "Imprimer les
//                  bulletins (A5)" dans bulletins-view.tsx). Stocké dans
//                  localStorage["sygren-auth"] au format zustand-persist
//                  minimal ({state: {token}, version: 0}) pour que apiFetch
//                  l'utilise automatiquement.
//
// Comportement :
//   1. Au montage : lit les URL params + stocke le token dans localStorage.
//   2. Fetch en parallèle :
//        a. liste des classes de la session (releve-classes) puis releve-data
//           pour chaque classe (notes, moyennes, effectifs, sexe, échelle) ;
//        b. résultats de la session (computation/session/:id) pour récupérer
//           le RANG réel de chaque élève (classement par classe avec
//           ex-aequo) — rapprochement par matricule.
//   3. Map chaque student → BulletinEleve via mapSubjectName().
//   4. Affiche la barre d'actions (Imprimer / Fermer) + <BulletinsA5Landscape>.
//   5. Bouton "Imprimer" → window.print() (dialog navigateur → PDF ou papier).
//
// Le CSS @page (A4 paysage, marges 0) est injecté par <PrintStyle /> :
// placé APRÈS la feuille globale (qui définit A4 portrait pour /releve),
// il gagne la cascade et s'applique uniquement à ce document.
//
// Aucune modification backend : on réutilise les endpoints existants
// /api/reports/releve-classes, /api/reports/releve-data et
// /api/computation/session/{id}.

import { useEffect, useState } from "react";
import { Loader2, X, AlertCircle, RefreshCw } from "lucide-react";

import { parentPortalApi, reportsApi, computationApi } from "@/lib/api";
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
import { fmtNoteFr } from "@/lib/notes-format";
import { fetchPreviousAverages, computeEvolution } from "@/lib/evolution";
import BulletinsA5Landscape, {
  type BulletinEleve,
  type IEPInfo,
} from "@/components/bulletins-a5-landscape";

// === Types locaux ===

// Type dérivé de la valeur de retour de reportsApi.getReleveData.
type ReleveData = Awaited<ReturnType<typeof reportsApi.getReleveData>>;
type SessionResults = Awaited<ReturnType<typeof computationApi.getSessionResults>>;

interface ClassInfo {
  id: string;
  name: string;
  level: string;
  student_count: number;
  exempted?: boolean;
}

// === Mapping matières SYGREN → slots bulletin ===
//
// Le backend releve-data renvoie students[].grades[] avec subject_name.
// Noms réels en base (vérifiés) : Exploitation de Texte, Etude du Milieu,
// Mathématiques, Dictée, EPS, Copie, Ecriture, Expression Ecrites, Dessin,
// EDHC, Lecture, Poesie & Chant.
//
// Si une matière n'est pas mappée, le slot reste vide (note "").
//
// Clés du BulletinEleve.notes :
//   explText, eveilMilieu, histGeo, edhcMilieu, sciences, maths, dictee,
//   eps, copie, ecriture, expressionEcrite, dessin, edhc, lecture,
//   poesieChant, edhcBase

type BulletinNoteKey = keyof BulletinEleve["notes"];

function mapSubjectName(name: string): BulletinNoteKey | null {
  const n = name.toLowerCase();
  if (n.includes("français") || n.includes("francais") || n.includes("exploit"))
    return "explText";
  if (n.includes("math")) return "maths";
  // « Etude du Milieu » / « Éveil au Milieu » → note globale (ligne unique
  // CE/CM ; pour CP elle alimente la ligne globale si l'école n'a pas de
  // matières détaillées séparées).
  if (
    n.includes("etude du milieu") ||
    n.includes("étude du milieu") ||
    n.includes("eveil")
  )
    return "eveilMilieu";
  if (n.includes("hist") || n.includes("géo") || n.includes("geo"))
    return "histGeo";
  if (n.includes("science")) return "sciences";
  if (n.includes("eps") || n.includes("sport")) return "eps";
  if (n.includes("dictée") || n.includes("dictee")) return "dictee";
  if (n.includes("copie")) return "copie";
  if (n.includes("expression") && (n.includes("écrit") || n.includes("ecrit")))
    return "expressionEcrite";
  // « écrit » / « ecrit » (sans « expression ») → ecriture
  if (n.includes("écrit") || n.includes("ecrit")) return "ecriture";
  if (n.includes("dessin")) return "dessin";
  if (n.includes("poés") || n.includes("poes") || n.includes("chant"))
    return "poesieChant";
  if (n.includes("lect")) return "lecture";
  if (n.includes("edhc")) {
    if (n.includes("milieu")) return "edhcMilieu";
    // « EDHC base » (si présent en DB) fusionne avec la ligne EDHC —
    // le doublon « E.D.H.C » a été supprimé du bulletin.
    return "edhc";
  }
  return null; // sujet non mappé — slot reste vide
}

// Formatage numérique SANS ZÉROS PARASITES → Task 37 : les nombres
// décimaux s'écrivent avec une VIRGULE et deux chiffres après la
// virgule (exemple : 7,37) — un entier reste entier (cf. fmtNoteFr).
function fmtNum(v: number): string {
  return fmtNoteFr(v);
}

// === Appréciation générale automatique ===
//
// Réplique EXACTEMENT getGeneralAppreciation du backend
// (report_cards.go) : mêmes seuils (/20), mêmes textes. La moyenne est
// normalisée sur /20 avant comparaison (le backend PDF avait le même bug
// — corrigé au même moment — : seuils /20 vs moyenne /10 pour CP/CE).
//
// Retourne aussi le statut « négatif » : true si moyenne < seuil passant
// (10/20 normalisés) ou aucune note → le texte s'affiche en ROUGE sur le
// bulletin ; sinon noir (appréciation positive).
function appreciationFor(
  avg: number,
  scale: number,
  hasAvg: boolean,
): { text: string; negative: boolean } {
  if (!hasAvg) {
    return {
      text: "Aucune note n'a été saisie pour cette session. Veuillez contacter l'administration.",
      negative: true, // anomalie — attire l'œil en rouge
    };
  }
  // Normalisation /20 (CP/CE : average × 2 ; CM : inchangée).
  const avg20 = scale > 0 ? (avg * 20) / scale : avg;
  if (avg20 >= 16)
    return {
      text: "Excellents résultats. Félicitations pour ce travail remarquable et la régularité dans l'effort. Continuez ainsi !",
      negative: false,
    };
  if (avg20 >= 14)
    return {
      text: "Très bons résultats d'ensemble. Continuez dans cette voie, l'année se présente sous les meilleurs auspices.",
      negative: false,
    };
  if (avg20 >= 12)
    return {
      text: "Bons résultats d'ensemble. Des efforts soutenus permettront de viser l'excellence. Encouragements.",
      negative: false,
    };
  if (avg20 >= 10)
    return {
      text: "Résultats satisfaisants. L'élève peut mieux faire avec davantage de rigueur et de régularité dans le travail.",
      negative: false,
    };
  if (avg20 >= 8)
    return {
      text: "Résultats fragiles. Un soutien et un encadrement renforcés sont nécessaires pour progresser.",
      negative: true,
    };
  if (avg20 >= 5)
    return {
      text: "Résultats insuffisants. Des difficultés importantes nécessitent un accompagnement personnalisé.",
      negative: true,
    };
  return {
    text: "Résultats très insuffisants. Une remédiation urgente est conseillée. Rencontre avec les parents recommandée.",
    negative: true,
  };
}

// === Statistiques de classe (moyenne / plus forte / plus faible) ===
// Calculées côté navigateur depuis les élèves du releve-data de CHAQUE
// classe (mêmes données que le bulletin — zéro requête supplémentaire).
interface ClassStat {
  avg: number;
  max: number;
  min: number;
}

function computeClassStats(students: ReleveData["students"]): ClassStat | null {
  const withAvg = students.filter((s) => s.has_average);
  if (withAvg.length === 0) return null;
  let sum = 0;
  let max = withAvg[0].average;
  let min = withAvg[0].average;
  for (const s of withAvg) {
    sum += s.average;
    if (s.average > max) max = s.average;
    if (s.average < min) min = s.average;
  }
  return { avg: sum / withAvg.length, max, min };
}

// fetchPreviousAverages + computeEvolution extraits vers lib/evolution.ts
// (DRY — partagé avec le Dialog détail élève du module Résultats, œil).

// Construit un BulletinEleve à partir d'un élève du backend.
// rankLookup : matricule normalisé → rang (1-based, au sein de la classe)
// issu de l'API computation (gestion des ex-aequo côté backend).
function buildBulletinEleve(
  student: ReleveData["students"][number],
  className: string,
  classLevel: string,
  effectif: number,
  session: string,
  mois: string,
  anneeScolaire: string,
  rankLookup: Map<string, number>,
  maitre: string,
  classStat: ClassStat | null,
  prevLookup: Map<string, { average: number; scale: number }>,
): BulletinEleve {
  // Le backend renvoie last_name + first_name séparément. On les
  // concatène dans l'ordre "Nom Prénoms" (format officiel CI).
  const nomPrenoms = `${student.last_name} ${student.first_name}`.trim();

  const notes: BulletinEleve["notes"] = {};
  // Dénominateur du TOTAL : somme des barèmes des matières réellement notées.
  let totalSur = 0;
  let anyGrade = false;
  for (const g of student.grades) {
    const slot = mapSubjectName(g.subject_name);
    if (!slot) continue; // sujet non mappé → on ignore
    if (notes[slot] !== undefined) continue; // 1ère occurrence gagne (doublon)
    // Task 37 — note affichée au format français : virgule + 2 décimales
    // si décimal (7,37 · 8,50) — entier inchangé (10).
    notes[slot] = g.has_grade ? fmtNoteFr(g.value) : "";
    if (g.has_grade) {
      totalSur += g.max_score;
      anyGrade = true;
    }
  }

  // Rang réel : rapprochement par matricule normalisé. Les matricules
  // vides/N/A ne sont pas rapprochés (pas fiables) → rang pointillé.
  const matKey = (student.matricule || "").trim().toUpperCase();
  const rank =
    matKey && matKey !== "N/A" ? (rankLookup.get(matKey) ?? 0) : 0;

  // Maître de la classe (titulaire) — transmis par releve-data
  // (teacher_name, résolu depuis Class.TeacherID côté backend).
  const maitreName = maitre || "";

  return {
    id: student.matricule || student.num,
    nomPrenoms,
    matricule: student.matricule,
    classe: className || classLevel,
    effectif,
    sexe: student.gender === "F" ? "F" : "M",
    anneeScolaire,
    typeExamen: session,
    mois,
    // Échelle de la moyenne pour CET élève (10 CP/CE, 20 CM — backend).
    averageScale: student.average_scale,
    notes,
    // TOTAL : points obtenus / points possibles (matières notées).
    total: anyGrade ? `${fmtNum(student.total)}/${fmtNum(totalSur)}` : undefined,
    moyenne: student.has_average ? fmtNum(student.average) : undefined,
    rangNum: rank > 0 ? rank : undefined,
    maitreName: maitreName || undefined,
    // Statistiques de LA classe de l'élève (moyenne / plus forte / plus
    // faible) — calculées depuis les mêmes données que le bulletin.
    stats: classStat
      ? {
          moyenneClasse: classStat.avg,
          plusForte: classStat.max,
          plusFaible: classStat.min,
        }
      : undefined,
    // Évolution vs session précédente — logique partagée (lib/evolution.ts)
    // utilisée aussi par le Dialog détail élève du module Résultats.
    ...(() => {
      const evo = computeEvolution(student, prevLookup);
      return evo.kind === "none"
        ? { evolution: undefined }
        : { evolution: { delta: evo.delta, previousAvg: evo.previousAvg } };
    })(),
    // Appréciation générale automatique — mêmes seuils et textes que le
    // backend PDF (getGeneralAppreciation), moyenne normalisée /20.
    // negative : < 10/20 ou aucune note → texte ROUGE sur le bulletin.
    ...(() => {
      const appr = appreciationFor(
        student.average,
        student.average_scale,
        student.has_average,
      );
      return {
        appreciation: appr.text,
        appreciationNegative: appr.negative,
      };
    })(),
  };
}

// === CSS d'impression spécifique à ce document ===
// Injecté dans le body (après la <link> globals.css en head) : gagne la
// cascade sur la règle @page A4 portrait (module /releve) et ne s'applique
// qu'au présent document.
// v3 — mode `b5` (PORTAIL PARENT) : page B5 PORTRAIT (176×250 mm, marge 0)
// — UN SEUL bulletin par page, sans trait de découpe. Dimensions
// explicites (comme /resultats-fin-annee-doc) : zéro ambiguïté d'orientation.
function PrintStyle({ b5 }: { b5?: boolean }) {
  return (
    <style>{`
      @media print {
        @page { size: ${b5 ? "176mm 250mm" : "A4 landscape"}; margin: 0; }
      }
    `}</style>
  );
}

// === Page ===

// === MODÈLES WORD (.doc) et EXCEL (.xlsx) — bulletins PÉRIODIQUES ===
// Extension des 3 modèles d'impression (demande utilisateur : « étendre
// les 3 modèles PDF / Word / Excel à tous les documents, en respectant les
// en-têtes d'origine ») au bulletin A5 du module Bulletins :
//   WORD  : un SEUL fichier .doc contenant les bulletins de TOUS les
//           élèves enchaînés, chaque bulletin séparé par un SAUT DE PAGE
//           (mso-special-character:line-break) ; chaque bulletin
//           reproduit le rendu du bulletin A5 (en-tête institutionnel,
//           MOIS DE, tableau MATIÈRES | NOTES | VISA DU DIRECTEUR avec
//           l'accolade du bloc « Éveil au Milieu », VISA DES PARENTS,
//           RÉSULTATS, STATISTIQUES, APPRÉCIATION ET VISA DU MAÎTRE).
//   EXCEL : un classeur avec UNE FEUILLE PAR ÉLÈVE (nom « Bulletin N —
//           NOM » ≤ 31 caractères, caractères invalides remplacés) ; au-
//           delà de 60 élèves, le classeur est limité à 60 feuilles et
//           une note rouge est insérée en tête de la première feuille.
// Rendus PDF inchangés ; Arial dans Word/Excel.

const BULLETIN_EXPORT_MAX_SHEETS = 60;

/** SAUT DE PAGE Word entre deux bulletins (fichier .doc unique). */
const BULLETIN_PAGE_BREAK =
  "<br clear=all style='mso-special-character:line-break;page-break-before:always'>";

/** Nom de feuille Excel sûr : ≤ 31 caractères, sans \ / ? * [ ] : */
function safeSheetName(base: string): string {
  return base
    .replace(/[\\/?*[\]:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
}

/** Barème de la moyenne d'un bulletin (10 CP/CE, 20 CM — donnée backend
 *  average_scale, fallback déduit du préfixe de la classe, comme le PDF). */
function baremeOf(e: BulletinEleve): number {
  return e.averageScale ?? (e.classe.toUpperCase().startsWith("CM") ? 20 : 10);
}

/** Ligne RANG du bulletin (« 1er / 25 » — même suffixe er/ème que le PDF,
 *  pointillés si le rang n'est pas rapproché). */
function rangLabelOf(e: BulletinEleve): string {
  if (!e.rangNum) return "....../.....";
  const s = String(e.rangNum);
  return `${s}${s === "1" ? "er" : "ème"} / ${e.effectif}`;
}

// Couleurs du modèle A5 (drapeau CI — mêmes valeurs que le composant PDF).
const BTX = "border:1.4px solid #009E60;";
const GREEN_TXT_S = "#00734A";
const NEGATIVE_S = "rgb(200,20,20)";
const POSITIVE_S = "rgb(0,120,50)";

/** Autres matières du tableau (même ordre que BulletinsA5Landscape). */
const AUTRES_MATIERES: Array<[string, keyof BulletinEleve["notes"]]> = [
  ["Mathématiques", "maths"],
  ["Dictée", "dictee"],
  ["EPS", "eps"],
  ["Copie", "copie"],
  ["Ecriture", "ecriture"],
  ["Expression Écrite", "expressionEcrite"],
  ["Dessin", "dessin"],
  ["EDHC", "edhc"],
  ["Lecture", "lecture"],
  ["Poésie/ Chant", "poesieChant"],
];

/** UN bulletin périodique en HTML (modèle Word) — reproduction fidèle du
 *  bulletin A5 : en-tête institutionnel, titre, infos élève, puis LE
 *  tableau principal à 5 colonnes (matières / accolade / sous-lignes /
 *  notes / colonne visas-résultats) avec l'accolade du bloc « Éveil au
 *  Milieu », la zone « Visa du Directeur » (nom imprimé en bas), puis
 *  VISA DES PARENTS, RÉSULTATS, STATISTIQUES et l'appréciation pleine
 *  largeur. */
function periodBulletinWordHtml(e: BulletinEleve, iepInfo?: IEPInfo): string {
  const esc = escHtml;
  const bareme = baremeOf(e);
  const directeur = (iepInfo?.director_name || "").trim().toUpperCase();
  const maitre = (e.maitreName || "").trim().toUpperCase();

  // Ligne matière simple : libellé (vert gras, gauche) + note (noir gras).
  const matRow = (label: string, note: string | number | undefined) =>
    `<tr>` +
    `<td colspan=3 style="${BTX} padding:1px 4px; text-align:left; font-weight:bold; color:#00734A; font-size:11px;">${esc(label)}</td>` +
    `<td style="${BTX} padding:1px 2px; text-align:center; font-weight:bold; font-size:11px;">${esc(note == null ? "" : String(note))}</td>` +
    `</tr>`;
  // Lignes du bloc « Éveil au Milieu » : label vertical + accolade « { » en
  // rowspan sur les 3 sous-lignes (Hist-Géo / EDHC / Sciences), note
  // GLOBALE unique en rowspan sur la colonne NOTES.
  const sousRow = (label: string, isFirst: boolean) =>
    (isFirst
      ? `<td rowspan=3 style="${BTX} text-align:center; font-weight:bold; color:#00734A; font-size:10px;">Éveil<br>au<br>Milieu</td>` +
        `<td rowspan=3 style="${BTX} text-align:center; color:#009E60; font-size:15px;">&#123;</td>`
      : "") +
    `<td style="${BTX} padding:1px 4px; text-align:left; font-weight:bold; color:#00734A; font-size:10px;">${esc(label)}</td>` +
    (isFirst
      ? `<td rowspan=3 style="${BTX} text-align:center; font-weight:bold; font-size:11px;">${esc(e.notes.eveilMilieu == null ? "" : String(e.notes.eveilMilieu))}</td>`
      : "");

  // 14 lignes de matières (Exploitation + Éveil (3) + 10 autres) — la
  // zone « VISA DU DIRECTEUR » couvre TOUTES ces lignes (rowspan), nom du
  // directeur imprimé EN BAS de la zone (comme le PDF).
  const matieres =
    // Exploitation de Texte — la cellule visa (rowspan=14) y est ancrée.
    `<tr>` +
    `<td colspan=3 style="${BTX} padding:1px 4px; text-align:left; font-weight:bold; color:#00734A; font-size:11px;">Exploitation de Texte</td>` +
    `<td style="${BTX} padding:1px 2px; text-align:center; font-weight:bold; font-size:11px;">${esc(e.notes.explText == null ? "" : String(e.notes.explText))}</td>` +
    `<td rowspan=14 style="${BTX} text-align:center; vertical-align:bottom; font-weight:bold; font-size:9px; letter-spacing:0.3px; height:96px;">${esc(directeur)}</td>` +
    `</tr>` +
    sousRow("Hist – Géo.", true) +
    sousRow("EDHC", false) +
    sousRow("Sciences", false) +
    AUTRES_MATIERES.map(([label, key]) => matRow(label, e.notes[key])).join("");

  // Bloc droit (sous les matières) : VISA DES PARENTS, RÉSULTATS,
  // STATISTIQUES — la colonne gauche reste vide (rowspan calculé).
  const droitRows: string[] = [];
  const hasStats = !!(e.stats || e.evolution);
  const nbDroit =
    2 +
    4 + // titre RÉSULTATS + TOTAL + MOYENNE + RANG
    (hasStats ? 1 + (e.stats ? 3 : 0) + (e.evolution ? 1 : 0) : 0);
  const libValeur = (
    lib: string,
    val: string,
    valColor?: string,
  ) =>
    `<td style="${BTX} padding:1px 4px; font-weight:bold; color:#00734A; font-size:11px;">${esc(lib)}</td>` +
    `<td style="${BTX} padding:1px 4px; text-align:right; font-weight:bold; font-size:11px;${valColor ? ` color:${valColor};` : ""}">${esc(val)}</td>`;
  droitRows.push(
    `<td colspan=3 rowspan=${nbDroit} style="${BTX}; padding:0;"></td>` +
      `<td colspan=2 style="${BTX} text-align:center; font-weight:bold; color:#00734A; font-size:10px;">VISA DES PARENTS</td>`,
    `<td colspan=2 style="${BTX}; height:20mm;"></td>`,
    `<td colspan=2 style="${BTX} text-align:center; font-weight:bold; color:#00734A; font-size:10px;">RÉSULTATS</td>`,
    libValeur("TOTAL :", e.total == null ? "......../........" : String(e.total)),
    libValeur(
      "MOYENNE :",
      e.moyenne ? `${e.moyenne} /${bareme}` : `........ /${bareme}`,
    ),
    libValeur("RANG :", rangLabelOf(e)),
  );
  if (e.stats) {
    droitRows.push(
      `<td colspan=2 style="${BTX} text-align:center; font-weight:bold; color:#00734A; font-size:10px;">STATISTIQUES</td>`,
      libValeur("MOY. CLASSE :", fmtNum(e.stats.moyenneClasse)),
      libValeur("PLUS FORTE :", fmtNum(e.stats.plusForte)),
      libValeur("PLUS FAIBLE :", fmtNum(e.stats.plusFaible)),
    );
  }
  if (e.evolution) {
    droitRows.push(
      libValeur(
        e.evolution.delta > 0
          ? "ÉLÈVE EN PROGRESSION :"
          : e.evolution.delta < 0
            ? "ÉLÈVE EN RÉGRESSION :"
            : "ÉLÈVE STABLE :",
        e.evolution.delta > 0
          ? `▲ +${fmtNum(e.evolution.delta)}`
          : e.evolution.delta < 0
            ? `▼ ${fmtNum(e.evolution.delta)}`
            : "= 0",
        e.evolution.delta > 0
          ? POSITIVE_S
          : e.evolution.delta < 0
            ? NEGATIVE_S
            : undefined,
      ),
    );
  }

  return (
    `<div>` +
    // --- En-tête institutionnel (dynamique, comme le bulletin PDF) ---
    `<table style="border-collapse:collapse; width:100%; table-layout:fixed;"><tr>` +
    `<td style="border:none; width:62%; vertical-align:top; font-size:9px; line-height:1.35;">` +
    `<p style="font-weight:600;">Ministère de l'Education Nationale Et de l'Alphabétisation</p>` +
    `<p style="font-style:italic;">et de l'Enseignement Technique</p>` +
    `<p style="font-style:italic;">Direction Régionale de ${esc((iepInfo?.region || ".........").toUpperCase())}</p>` +
    `<p style="font-weight:bold;">Inspection de l'Enseignement Préscolaire et Primaire de ${esc((iepInfo?.name || ".........").toUpperCase())}</p>` +
    `<p>BP : ${esc(iepInfo?.bp || ".....")} / Tel : ${esc(iepInfo?.inspector_phone || ".............")}</p>` +
    `<p style="color:#1d4ed8; text-decoration:underline;">Courriel : ${esc(iepInfo?.inspector_email || "............")}</p>` +
    `</td>` +
    `<td style="border:none; width:38%; text-align:center; vertical-align:top;">` +
    `<p style="font-weight:600; font-size:9px;">République de Côte d'Ivoire</p>` +
    `<p style="font-style:italic; font-size:8px;">Union-Discipline-Travail</p>` +
    `</td></tr></table>` +
    // --- Titre + type d'examen ---
    `<p style="text-align:center; font-weight:bold; font-size:14px; margin:4px 0 0;">BULLETIN DE NOTES</p>` +
    `<p style="text-align:center; font-weight:600; font-size:12px; text-transform:uppercase;">${esc((e.typeExamen || "COMPOSITION N°1").toUpperCase())}</p>` +
    // --- Infos élève (Élève/Classe/Sexe — Matricule/Effectif/Année) ---
    `<table style="border-collapse:collapse; width:100%; table-layout:fixed; margin:2px 0 3px;">` +
    `<colgroup><col style="width:52%"><col style="width:48%"></colgroup>` +
    `<tr><td style="border:none; font-weight:bold; color:#00734A; font-size:10px;">Élève : <span style="font-weight:normal; color:#000;">${esc(e.nomPrenoms)}</span></td>` +
    `<td style="border:none; font-weight:bold; color:#00734A; font-size:10px;">Matricule : <span style="font-weight:normal; color:#000;">${esc(e.matricule)}</span></td></tr>` +
    `<tr><td style="border:none; font-weight:bold; color:#00734A; font-size:10px;">Classe : <span style="font-weight:normal; color:#000;">${esc(e.classe)}</span></td>` +
    `<td style="border:none; font-weight:bold; color:#00734A; font-size:10px;">Effectif : <span style="font-weight:normal; color:#000;">${e.effectif}</span></td></tr>` +
    `<tr><td style="border:none; font-weight:bold; color:#00734A; font-size:10px;">Sexe : <span style="font-weight:normal; color:#000;">${esc(e.sexe)}</span></td>` +
    `<td style="border:none; font-weight:bold; color:#00734A; font-size:10px;">Année scolaire : <span style="font-weight:normal; color:#000;">${esc(e.anneeScolaire)}</span></td></tr>` +
    `</table>` +
    // --- Tableau principal (MOIS DE / matières / visas / résultats) ---
    `<table style="border-collapse:collapse; width:100%; table-layout:fixed;">` +
    `<colgroup><col style="width:32%"><col style="width:6%"><col style="width:14%"><col style="width:16%"><col style="width:32%"></colgroup>` +
    `<tr><td colspan=5 style="${BTX} text-align:center; font-weight:bold; color:#00734A; font-size:12px; padding:2px;">MOIS DE : ${esc(e.mois || "........................................................20......")}</td></tr>` +
    `<tr>` +
    `<td colspan=3 style="${BTX} text-align:left; padding:1px 4px; font-weight:bold; color:#00734A; font-size:11px;">MATIÈRES</td>` +
    `<td style="${BTX} text-align:center; font-weight:bold; color:#00734A; font-size:11px;">NOTES</td>` +
    `<td style="${BTX} text-align:center; font-weight:bold; color:#00734A; font-size:11px;">VISA DU DIRECTEUR</td>` +
    `</tr>` +
    matieres +
    droitRows.join("") +
    // --- Appréciation et Visa du Maître (pleine largeur) ---
    `<tr><td colspan=5 style="${BTX} text-align:center; font-weight:bold; color:#00734A; font-size:10px; padding:1px;">APPRÉCIATION ET VISA DU MAÎTRE</td></tr>` +
    `<tr><td colspan=5 style="${BTX} text-align:center; font-weight:bold; font-style:italic; font-size:10px; padding:1px 4px;${e.appreciationNegative ? ` color:${NEGATIVE_S};` : ""}">${esc(e.appreciation ?? "")}</td></tr>` +
    `<tr><td colspan=5 style="${BTX} text-align:center; vertical-align:bottom; font-weight:bold; font-size:9px; letter-spacing:0.3px; height:12mm;">${esc(maitre)}</td></tr>` +
    `</table>` +
    `</div>`
  );
}

/** Modèle WORD (.doc) du lot : un SEUL fichier, les bulletins de TOUS les
 *  élèves enchaînés, séparés par un saut de page Word. */
function buildBulletinsWordHtml(
  eleves: BulletinEleve[],
  iepInfo?: IEPInfo,
): string {
  return buildWordShell({
    title: `Bulletins de notes — ${iepInfo?.school_name || "École"}`,
    orientation: "portrait",
    marginMm: 8,
    styles: `p { margin:0; }`,
    bodyHtml: eleves
      .map((e) => periodBulletinWordHtml(e, iepInfo))
      .join(BULLETIN_PAGE_BREAK),
  });
}

/** Modèle EXCEL (.xlsx) du lot : UNE FEUILLE PAR ÉLÈVE (≤ 60 feuilles —
 *  au-delà, note en tête de la première feuille). Chaque feuille
 *  reproduit le bulletin : en-tête institutionnel fusionné, tableau
 *  matières (accolade « Éveil au Milieu », notes, zone Visa du Directeur
 *  avec nom en bas), VISA DES PARENTS, RÉSULTATS, STATISTIQUES,
 *  appréciation et signatures. */
async function exportBulletinsExcelAsync(
  eleves: BulletinEleve[],
  iepInfo: IEPInfo | undefined,
  filename: string,
): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";

  const limited = eleves.length > BULLETIN_EXPORT_MAX_SHEETS;
  const list = limited ? eleves.slice(0, BULLETIN_EXPORT_MAX_SHEETS) : eleves;

  // Couleurs du modèle (drapeau CI) + bordures vertes + police Arial.
  const GREEN = { argb: "FF009E60" };
  const GREEN_TXT = { argb: "FF00734A" };
  const RED = { argb: "FFC00000" };
  const POSITIVE = { argb: "FF007832" };
  const NEGATIVE = { argb: "FFC81414" };
  const BORDER = { style: "thin" as const, color: GREEN };
  const BOX = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
  const font = (
    size: number,
    bold = false,
    argb?: string,
    italic = false,
  ) => ({
    name: "Arial",
    size,
    bold,
    italic,
    ...(argb ? { color: { argb } } : {}),
  });
  type RichPart = { font: ReturnType<typeof font>; text: string };

  // Armoiries (meilleur effort — fetch unique, répétées sur chaque feuille).
  let arm: Uint8Array | null = null;
  try {
    const res = await fetch("/ci-coat-of-arms.png");
    if (res.ok) arm = new Uint8Array(await res.arrayBuffer());
  } catch {
    // armoiries omises — l'en-tête reste lisible
  }

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const bareme = baremeOf(e);
    const directeur = (iepInfo?.director_name || "").trim().toUpperCase();
    const maitre = (e.maitreName || "").trim().toUpperCase();
    const ws = wb.addWorksheet(
      safeSheetName(`Bulletin ${i + 1} — ${e.nomPrenoms}`),
      {
        views: [{ showGridLines: false }],
        pageSetup: {
          paperSize: 9,
          orientation: "portrait",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
        },
      },
    );
    ws.columns = [30, 4, 13, 10, 15, 16].map((width) => ({ width }));

    // Rangée de départ (décalée si la note de limitation est insérée).
    let r = 1;
    if (limited && i === 0) {
      ws.mergeCells(1, 1, 1, 6);
      const note = ws.getCell(1, 1);
      note.value = `Note : le lot compte ${eleves.length} bulletins ; le classeur est limité à ${BULLETIN_EXPORT_MAX_SHEETS} feuilles — imprimer par classe pour les élèves restants.`;
      note.font = font(11, true, RED.argb);
      note.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      ws.getRow(1).height = 28;
      r = 3;
    }

    // Ligne fusionnée sur les 6 colonnes (en-tête institutionnel, titres).
    const full = (
      rr: number,
      value: string | { richText: RichPart[] },
      size: number,
      bold = false,
      opts?: { italic?: boolean; argb?: string; box?: boolean; h?: number; fill?: string },
    ) => {
      ws.mergeCells(rr, 1, rr, 6);
      const c = ws.getCell(rr, 1);
      c.value = value;
      c.font = font(size, bold, opts?.argb, opts?.italic ?? false);
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      if (opts?.fill) {
        for (let col = 1; col <= 6; col++) {
          ws.getCell(rr, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
        }
      }
      if (opts?.box) for (let col = 1; col <= 6; col++) ws.getCell(rr, col).border = BOX;
      if (opts?.h) ws.getRow(rr).height = opts.h;
    };

    // --- En-tête institutionnel (fidèle au bulletin PDF) ---
    full(r, "Ministère de l'Education Nationale Et de l'Alphabétisation — et de l'Enseignement Technique", 12, true);
    full(r + 1, `Direction Régionale de ${(iepInfo?.region || ".........").toUpperCase()} — Inspection de l'Enseignement Préscolaire et Primaire de ${(iepInfo?.name || ".........").toUpperCase()}`, 11, true, { italic: true });
    full(r + 2, `BP : ${iepInfo?.bp || "....."} / Tel : ${iepInfo?.inspector_phone || "............."} — Courriel : ${iepInfo?.inspector_email || "............"}`, 11);
    full(r + 3, "République de Côte d'Ivoire — Union-Discipline-Travail", 11, true);
    // --- Titre + type d'examen ---
    full(r + 4, "BULLETIN DE NOTES", 14, true);
    full(r + 5, (e.typeExamen || "COMPOSITION N°1").toUpperCase(), 12, true);
    ws.getRow(r + 6).height = 4;

    // --- Infos élève (2 colonnes de paires, comme le bulletin PDF) ---
    const ident = (
      rr: number,
      leftLabel: string,
      leftValue: string,
      rightLabel: string,
      rightValue: string,
    ) => {
      ws.mergeCells(rr, 1, rr, 3);
      const lc = ws.getCell(rr, 1);
      lc.value = {
        richText: [
          { font: font(10, true, GREEN_TXT.argb), text: leftLabel },
          { font: font(10), text: leftValue },
        ],
      };
      lc.alignment = { horizontal: "left", vertical: "middle" };
      ws.mergeCells(rr, 4, rr, 6);
      const rc = ws.getCell(rr, 4);
      rc.value = {
        richText: [
          { font: font(10, true, GREEN_TXT.argb), text: rightLabel },
          { font: font(10), text: rightValue },
        ],
      };
      rc.alignment = { horizontal: "left", vertical: "middle" };
      ws.getRow(rr).height = 15;
    };
    ident(r + 7, "Élève : ", e.nomPrenoms, "Matricule : ", e.matricule);
    ident(r + 8, "Classe : ", e.classe, "Effectif : ", String(e.effectif));
    ident(r + 9, "Sexe : ", e.sexe, "Année scolaire : ", e.anneeScolaire);

    // --- Tableau principal (bordures vertes, comme le modèle) ---
    const m0 = r + 10; // ligne MOIS DE
    const box = (rr: number, c1: number, c2: number) => {
      for (let col = c1; col <= c2; col++) ws.getCell(rr, col).border = BOX;
    };
    // MOIS DE (pleine largeur)
    ws.mergeCells(m0, 1, m0, 6);
    const mois = ws.getCell(m0, 1);
    mois.value = `MOIS DE : ${e.mois || "........................................................20......"}`;
    mois.font = font(11, true, GREEN_TXT.argb);
    mois.alignment = { horizontal: "center", vertical: "middle" };
    box(m0, 1, 6);
    // Entêtes : MATIÈRES (1-3) | NOTES (4) | VISA DU DIRECTEUR (5-6)
    const h0 = m0 + 1;
    ws.mergeCells(h0, 1, h0, 3);
    ws.mergeCells(h0, 5, h0, 6);
    ws.getCell(h0, 1).value = "MATIÈRES";
    ws.getCell(h0, 4).value = "NOTES";
    ws.getCell(h0, 5).value = "VISA DU DIRECTEUR";
    for (let col = 1; col <= 6; col++) {
      const c = ws.getCell(h0, col);
      c.font = font(11, true, GREEN_TXT.argb);
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.border = BOX;
    }
    // Zone « Visa du Directeur » : fusion verticale sur les 14 lignes de
    // matières, nom du directeur imprimé EN BAS (comme le bulletin PDF).
    const matStart = h0 + 1;
    const matEnd = matStart + 13; // 14 lignes : Exploitation + Éveil (3) + 10
    ws.mergeCells(matStart, 5, matEnd, 6);
    const visa = ws.getCell(matStart, 5);
    if (directeur) visa.value = directeur; // caractère d'imprimerie
    visa.font = font(9, true);
    visa.alignment = { horizontal: "center", vertical: "bottom", wrapText: true };
    // Lignes matières.
    const matLabel = (rr: number, label: string, note: string | number | undefined) => {
      ws.mergeCells(rr, 1, rr, 3);
      const lc = ws.getCell(rr, 1);
      lc.value = label;
      lc.font = font(10, true, GREEN_TXT.argb);
      lc.alignment = { horizontal: "left", vertical: "middle" };
      const nc = ws.getCell(rr, 4);
      nc.value = note == null ? "" : String(note);
      nc.font = font(10, true);
      nc.alignment = { horizontal: "center", vertical: "middle" };
    };
    matLabel(matStart, "Exploitation de Texte", e.notes.explText);
    // Bloc « Éveil au Milieu » : label vertical + accolade + 3 sous-lignes,
    // note globale unique fusionnée sur les 3 lignes (colonne NOTES).
    ws.mergeCells(matStart + 1, 1, matStart + 3, 1);
    const eveil = ws.getCell(matStart + 1, 1);
    eveil.value = "Éveil au Milieu";
    eveil.font = font(10, true, GREEN_TXT.argb);
    eveil.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    ws.mergeCells(matStart + 1, 2, matStart + 3, 2);
    const brace = ws.getCell(matStart + 1, 2);
    brace.value = "{";
    brace.font = font(14, false, GREEN.argb);
    brace.alignment = { horizontal: "center", vertical: "middle" };
    ["Hist – Géo.", "EDHC", "Sciences"].forEach((label, k) => {
      const sc = ws.getCell(matStart + 1 + k, 3);
      sc.value = label;
      sc.font = font(9, true, GREEN_TXT.argb);
      sc.alignment = { horizontal: "left", vertical: "middle" };
    });
    ws.mergeCells(matStart + 1, 4, matStart + 3, 4);
    const eveilNote = ws.getCell(matStart + 1, 4);
    eveilNote.value = e.notes.eveilMilieu == null ? "" : String(e.notes.eveilMilieu);
    eveilNote.font = font(10, true);
    eveilNote.alignment = { horizontal: "center", vertical: "middle" };
    // Autres matières.
    AUTRES_MATIERES.forEach(([label, key], k) => {
      matLabel(matStart + 4 + k, label, e.notes[key]);
    });
    // Bordures de tout le bloc matières/visas.
    for (let rr = matStart; rr <= matEnd; rr++) box(rr, 1, 6);

    // --- Bloc droit : VISA DES PARENTS / RÉSULTATS / STATISTIQUES ---
    const hasStats = !!(e.stats || e.evolution);
    const nbDroit =
      2 + 4 + (hasStats ? 1 + (e.stats ? 3 : 0) + (e.evolution ? 1 : 0) : 0);
    const d0 = matEnd + 1;
    ws.mergeCells(d0, 1, d0 + nbDroit - 1, 4); // colonne gauche vide
    for (let rr = d0; rr <= d0 + nbDroit - 1; rr++) box(rr, 1, 4);
    const pair = (rr: number, lib: string, val: string, valArgb?: string) => {
      const lc = ws.getCell(rr, 5);
      lc.value = lib;
      lc.font = font(10, true, GREEN_TXT.argb);
      lc.alignment = { horizontal: "left", vertical: "middle" };
      const vc = ws.getCell(rr, 6);
      vc.value = val;
      vc.font = font(10, true, valArgb);
      vc.alignment = { horizontal: "right", vertical: "middle" };
      box(rr, 5, 6);
    };
    const zoneTitre = (rr: number, label: string) => {
      ws.mergeCells(rr, 5, rr, 6);
      const c = ws.getCell(rr, 5);
      c.value = label;
      c.font = font(10, true, GREEN_TXT.argb);
      c.alignment = { horizontal: "center", vertical: "middle" };
      box(rr, 5, 6);
    };
    zoneTitre(d0, "VISA DES PARENTS");
    ws.mergeCells(d0 + 1, 5, d0 + 1, 6); // place signature parents
    box(d0 + 1, 5, 6);
    ws.getRow(d0 + 1).height = 26;
    zoneTitre(d0 + 2, "RÉSULTATS");
    pair(d0 + 3, "TOTAL :", e.total == null ? "......../........" : String(e.total));
    pair(d0 + 4, "MOYENNE :", e.moyenne ? `${e.moyenne} /${bareme}` : `........ /${bareme}`);
    pair(d0 + 5, "RANG :", rangLabelOf(e));
    let dr = d0 + 6;
    if (e.stats) {
      zoneTitre(dr, "STATISTIQUES");
      dr += 1;
      pair(dr, "MOY. CLASSE :", fmtNum(e.stats.moyenneClasse));
      pair(dr + 1, "PLUS FORTE :", fmtNum(e.stats.plusForte));
      pair(dr + 2, "PLUS FAIBLE :", fmtNum(e.stats.plusFaible));
      dr += 3;
    }
    if (e.evolution) {
      pair(
        dr,
        e.evolution.delta > 0
          ? "ÉLÈVE EN PROGRESSION :"
          : e.evolution.delta < 0
            ? "ÉLÈVE EN RÉGRESSION :"
            : "ÉLÈVE STABLE :",
        e.evolution.delta > 0
          ? `▲ +${fmtNum(e.evolution.delta)}`
          : e.evolution.delta < 0
            ? `▼ ${fmtNum(e.evolution.delta)}`
            : "= 0",
        e.evolution.delta > 0
          ? POSITIVE.argb
          : e.evolution.delta < 0
            ? NEGATIVE.argb
            : undefined,
      );
      dr += 1;
    }

    // --- Appréciation et Visa du Maître (pleine largeur, 6 colonnes) ---
    const a0 = d0 + nbDroit;
    ws.mergeCells(a0, 1, a0, 6);
    const apT = ws.getCell(a0, 1);
    apT.value = "APPRÉCIATION ET VISA DU MAÎTRE";
    apT.font = font(10, true, GREEN_TXT.argb);
    apT.alignment = { horizontal: "center", vertical: "middle" };
    box(a0, 1, 6);
    ws.mergeCells(a0 + 1, 1, a0 + 1, 6);
    const appr = ws.getCell(a0 + 1, 1);
    appr.value = e.appreciation ?? "";
    appr.font = font(10, true, e.appreciationNegative ? NEGATIVE.argb : undefined, true);
    appr.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    box(a0 + 1, 1, 6);
    ws.getRow(a0 + 1).height = 24;
    ws.mergeCells(a0 + 2, 1, a0 + 2, 6);
    const nm = ws.getCell(a0 + 2, 1);
    if (maitre) nm.value = maitre; // caractère d'imprimerie
    nm.font = font(9, true);
    nm.alignment = { horizontal: "center", vertical: "bottom" };
    box(a0 + 2, 1, 6);
    ws.getRow(a0 + 2).height = 20;

    // --- Armoiries en haut de feuille (meilleur effort) ---
    if (arm) {
      try {
        const imgId = wb.addImage({
          buffer: arm as unknown as Parameters<typeof wb.addImage>[0]["buffer"],
          extension: "png",
        });
        ws.addImage(imgId, { tl: { col: 4.2, row: 0.2 }, ext: { width: 46, height: 46 } });
      } catch {
        // armoiries omises — l'en-tête reste lisible
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: XLSX_MIME }), filename);
}

export default function BulletinsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eleves, setEleves] = useState<BulletinEleve[]>([]);
  const [iepInfo, setIepInfo] = useState<IEPInfo | undefined>(undefined);
  // v2 — VERROU D'IMPRESSION : admin + inspector (mode normal) ou PARENT
  // en mode portail (bulletin individuel de l'enfant par matricule).
  const role = usePrintRole();
  // Mode portail parent : dérivé de l'URL (lazy init — pas de setState
  // dans l'effet). Le matricule de l'enfant dans l'URL active ce mode.
  const [parentMode] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("matricule"),
  );
  const canPrint = canPrintDocument(role, parentMode);
  const [meta, setMeta] = useState<{
    schoolName: string;
    sessionLabel: string;
    /** Nom de la classe (filtre class_id) ou « Toutes les classes » —
        sert au nom des fichiers Word/Excel (bulletins-<classe>-<session>). */
    className: string;
  } | null>(null);
  // Modèles Word/Excel : état d'export (« doc » | « xlsx » | null) —
  // useState PLACÉ AVANT LES RETOURS CONDITIONNELS (discipline React).
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);

  // Fetch au montage.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const urlToken = params.get("t");
    // class_id (optionnel) : restreint l'impression à UNE classe.
    // Absent = toutes les classes (comportement historique).
    const classIdParam = params.get("class_id");
    // v2 — mode PORTAIL PARENT : matricule de l'enfant présent dans l'URL
    // → un seul bulletin (UN exemplaire, format B5), données via /api/parent/…
    const matriculeParam = params.get("matricule");

    // Si pas de session_id → erreur immédiate.
    if (!sessionId) {
      Promise.resolve().then(() => {
        setError("session_id est requis dans l'URL.");
        setLoading(false);
      });
      return;
    }

    // Si on a un token dans l'URL, on l'écrit dans localStorage au format
    // zustand-persist minimal ({state: {token}, version: 0}). apiFetch lit
    // ensuite ce token via getToken() et l'injecte dans Authorization.
    // NB : on préserve les autres champs du store (user, modules, etc.)
    // si l'entrée existe déjà, pour ne pas déconnecter l'onglet principal.
    if (urlToken) {
      try {
        const raw = localStorage.getItem("sygren-auth");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.state) {
            parsed.state.token = urlToken;
            localStorage.setItem("sygren-auth", JSON.stringify(parsed));
          } else {
            // Format inattendu → on écrase avec le format minimal.
            localStorage.setItem(
              "sygren-auth",
              JSON.stringify({ state: { token: urlToken }, version: 0 }),
            );
          }
        } else {
          localStorage.setItem(
            "sygren-auth",
            JSON.stringify({ state: { token: urlToken }, version: 0 }),
          );
        }
      } catch {
        // En cas d'erreur de parsing : on écrase avec le format minimal.
        try {
          localStorage.setItem(
            "sygren-auth",
            JSON.stringify({ state: { token: urlToken }, version: 0 }),
          );
        } catch {}
      }
    }

    // === v2 — MODE PORTAIL PARENT ===
    // Un seul bulletin (UN exemplaire, page B5 portrait) : celui de
    // l'enfant identifié par
    // son matricule, pour la session demandée. Données via le portail
    // parent (rangs inclus — les endpoints génériques lui sont fermés).
    if (matriculeParam) {
      Promise.all([
        parentPortalApi.periodBulletin(matriculeParam, sessionId),
        parentPortalApi.student(matriculeParam),
      ])
        .then(async ([pb, info]) => {
          const { releve, student_id, ranks } = pb;
          const rankLookup = new Map<string, number>();
          for (const r of ranks ?? []) {
            const key = (r.matricule || "").trim().toUpperCase();
            if (key && key !== "N/A") rankLookup.set(key, r.rank);
          }
          const child =
            releve.students.find(
              (s) =>
                (s.matricule || "").trim().toUpperCase() ===
                matriculeParam.trim().toUpperCase(),
            ) ??
            releve.students.find(
              (s) =>
                `${s.last_name} ${s.first_name}`.toLowerCase() ===
                (info.student.full_name || "").toLowerCase(),
            );
          if (!child) {
            throw new Error(
              "Aucun bulletin disponible pour cet élève dans cette session.",
            );
          }
          const classStat = computeClassStats(releve.students);
          const anneeScolaire =
            releve.month >= 9
              ? `${releve.year}-${releve.year + 1}`
              : `${releve.year - 1}-${releve.year}`;
          const mois = `${monthLabel(releve.month)} ${releve.year}`;
          const eleve = buildBulletinEleve(
            child,
            releve.class_name,
            releve.class_level,
            releve.total_t,
            releve.type_examen,
            mois,
            anneeScolaire,
            rankLookup,
            releve.teacher_name,
            classStat,
            new Map(),
          );
          // v3 — UN SEUL EXEMPLAIRE : le bulletin de l'enfant, seul sur sa
          // page B5 portrait (plus de double ni de trait de découpe).
          setEleves([eleve]);
          setIepInfo({
            name: releve.iep_name,
            region: releve.iep_region,
            bp: releve.iep_bp,
            inspector_name: releve.inspector_name,
            inspector_email: releve.inspector_email,
            inspector_phone: releve.inspector_phone,
            school_name: releve.school_name,
            director_name: releve.director_name,
          });
          const sessionLabel = `${releve.type_examen} — ${monthLabel(releve.month)} ${releve.year}`;
          setMeta({
            schoolName: releve.school_name,
            sessionLabel,
            className: releve.class_name,
          });
          document.title = `Bulletin — ${child.last_name} ${child.first_name} — ${sessionLabel}`;
          setLoading(false);
        })
        .catch((e: unknown) => {
          const msg =
            e instanceof Error
              ? e.message
              : typeof e === "string"
                ? e
                : "Erreur inconnue";
          setError(msg);
          setLoading(false);
        });
      return;
    }

    // Fetch parallèle :
    //   A. classes de la session (releve-classes) + releve-data par classe
    //   B. résultats de la session (rangs par classe — computation)
    // B est non bloquant : s'il échoue, les bulletins s'impriment sans rang.
    const ranksPromise: Promise<SessionResults | null> = computationApi
      .getSessionResults(sessionId)
      .catch((e) => {
        console.warn("computation/session failed (rangs indisponibles):", e);
        return null;
      });

    // Évolution vs session précédente — non bloquant (Map vide si absent).
    const prevPromise = fetchPreviousAverages(sessionId);

    reportsApi
      .listReleveClasses(sessionId)
      .then(async (cls) => {
        const classes: ClassInfo[] = (cls.classes || [])
          // Exclusions : classes exemptées de la session (directement ou
          // via leur niveau) — aucun bulletin à imprimer pour elles.
          .filter((c) => !c.exempted)
          // Impression ciblée : ne garder que la classe demandée si
          // class_id est présent dans l'URL.
          .filter((c) => !classIdParam || c.id === classIdParam);
        if (classes.length === 0) {
          setEleves([]);
          setMeta({ schoolName: "—", sessionLabel: "Session inconnue", className: "" });
          setLoading(false);
          return;
        }

        // Pour chaque classe : releve-data en parallèle.
        const datas = await Promise.all(
          classes.map((c) =>
            reportsApi
              .getReleveData(sessionId, c.id)
              .then((d) => ({ classInfo: c, data: d }))
              .catch((e) => {
                // Si une classe échoue, on ne casse pas tout : on logge et continue.
                console.error(
                  `releve-data failed for class ${c.id} (${c.name}):`,
                  e,
                );
                return null;
              }),
          ),
        );

        const valid = datas.filter(
          (d): d is { classInfo: ClassInfo; data: ReleveData } => d !== null,
        );
        if (valid.length === 0) {
          throw new Error(
            "Aucune donnée récupérée pour cette session (toutes les classes ont échoué).",
          );
        }

        // Table de correspondance matricule → rang (1-based, par classe).
        const sessionResults = await ranksPromise;
        const rankLookup = new Map<string, number>();
        if (sessionResults?.results) {
          for (const r of sessionResults.results) {
            const key = (r.matricule || "").trim().toUpperCase();
            if (key && key !== "N/A" && r.rank > 0) {
              rankLookup.set(key, r.rank);
            }
          }
        }

        // Construire le IEPInfo commun (toutes les classes partagent le même
        // IEP car même session → on prend le 1er).
        const first = valid[0].data;
        const iep: IEPInfo = {
          name: first.iep_name,
          region: first.iep_region,
          bp: first.iep_bp,
          inspector_name: first.inspector_name,
          inspector_email: first.inspector_email,
          inspector_phone: first.inspector_phone,
          school_name: first.school_name,
          director_name: first.director_name,
        };
        setIepInfo(iep);

        // Construire le sessionLabel : ex: "Composition N°2 — Décembre 2026".
        const sessionLabel = `${first.type_examen} — ${monthLabel(first.month)} ${first.year}`;
        setMeta({
          schoolName: first.school_name,
          sessionLabel,
          // Nom de classe pour le fichier Word/Excel : la classe visée par
          // class_id, sinon « Toutes les classes » (lot multi-classes).
          className: classIdParam
            ? (classes[0]?.name ?? "Classe")
            : "Toutes les classes",
        });

        // Année scolaire : si month >= 9 (sept-déc), année scolaire commence
        // cette année (year/year+1). Sinon (jan-juil), année scolaire a
        // commencé l'année précédente (year-1/year).
        const anneeScolaire =
          first.month >= 9
            ? `${first.year}-${first.year + 1}`
            : `${first.year - 1}-${first.year}`;

        // Mois lisible (ex: "Décembre 2026").
        const mois = `${monthLabel(first.month)} ${first.year}`;

        // Construire les BulletinEleve pour toutes les classes.
        const { averages: prevLookup } = await prevPromise;
        const allEleves: BulletinEleve[] = [];
        for (const { classInfo, data } of valid) {
          const classStat = computeClassStats(data.students);
          for (const s of data.students) {
            allEleves.push(
              buildBulletinEleve(
                s,
                data.class_name || classInfo.name,
                data.class_level || classInfo.level,
                data.total_t || classInfo.student_count,
                data.type_examen,
                mois,
                anneeScolaire,
                rankLookup,
                data.teacher_name,
                classStat,
                prevLookup,
              ),
            );
          }
        }

        setEleves(allEleves);

        // Titre onglet indicatif (le navigateur l'utilise pour le nom du PDF).
        document.title = `Bulletins A5 — ${first.school_name} — ${sessionLabel}`;

        setLoading(false);
      })
      .catch((e: unknown) => {
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : "Erreur inconnue";
        setError(msg);
        setLoading(false);
      });
  }, []);

  // === Rendus ===

  if (loading) {
    return (
      <>
        <PrintStyle b5={parentMode} />
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
          <Loader2 className="w-8 h-8 animate-spin text-blue-700" />
          <p className="mt-2 text-sm text-gray-700">Chargement des bulletins…</p>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PrintStyle b5={parentMode} />
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
          <div className="text-center max-w-md">
            <AlertCircle className="w-10 h-10 text-red-600 mx-auto" />
            <p className="mt-2 text-red-600 font-semibold">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-md text-sm font-semibold hover:bg-blue-800"
            >
              <RefreshCw className="w-4 h-4" />
              Réessayer
            </button>
            <button
              onClick={() => window.close()}
              className="mt-2 ml-2 inline-flex items-center gap-2 px-4 py-2 bg-gray-200 rounded-md text-sm"
            >
              <X className="w-4 h-4" />
              Fermer
            </button>
          </div>
        </div>
      </>
    );
  }

  if (eleves.length === 0) {
    return (
      <>
        <PrintStyle b5={parentMode} />
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
          <div className="text-center max-w-md">
            <AlertCircle className="w-10 h-10 text-amber-600 mx-auto" />
            <p className="mt-2 text-amber-700 font-semibold">
              Aucun élève à imprimer pour cette session.
            </p>
            <button
              onClick={() => window.close()}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gray-200 rounded-md text-sm"
            >
              <X className="w-4 h-4" />
              Fermer
            </button>
          </div>
        </div>
      </>
    );
  }

  // === Modèles WORD / EXCEL (3 modèles d'impression) ===
  // Noms de fichiers : bulletins-<slug classe>-<slug session>.doc/.xlsx.
  const fileBase = `bulletins-${slugFile(meta?.className || "toutes-classes")}-${slugFile(
    meta?.sessionLabel || "session",
  )}`;

  // Modèle WORD (.doc) — un SEUL fichier, un bulletin par élève, séparés
  // par un saut de page Word (mêmes verrous que l'impression).
  function handleWord() {
    setExporting("doc");
    try {
      saveWordDoc(buildBulletinsWordHtml(eleves, iepInfo), `${fileBase}.doc`);
    } finally {
      setExporting(null);
    }
  }

  // Modèle EXCEL (.xlsx) — une feuille par élève (exceljs importé à la
  // demande, comme la liste des candidats).
  async function handleExcel() {
    setExporting("xlsx");
    try {
      await exportBulletinsExcelAsync(eleves, iepInfo, `${fileBase}.xlsx`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      <PrintStyle b5={parentMode} />
      <div className="bg-gray-100 min-h-screen py-6 print:bg-white print:py-0 print:min-h-0">
        {/* Barre d'outils — cachée à l'impression */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden shadow-sm">
          <div>
            <h1 className="font-semibold text-sm text-gray-900">
              {parentMode ? "Bulletin — " : "Bulletins A5 — "}{meta?.schoolName ?? "École"} —{" "}
              {meta?.sessionLabel ?? "Session"}
            </h1>
            <p className="text-[11px] text-gray-500">
              {parentMode
                ? "1 bulletin · format B5 portrait — bulletin unique (un seul exemplaire)"
                : `${eleves.length} élève(s) · 2 bulletins/page A4 paysage · entête institutionnel officiel`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canPrint ? (
              /* Barre uniforme des documents officiels : PDF (impression
                 navigateur) + Word (.doc) + Excel (.xlsx) — verrous
                 d'impression inchangés (canPrint / PrintLockBadge). */
              <DocExportButtons
                canPrint
                exporting={exporting}
                onPdf={() => window.print()}
                onWord={handleWord}
                onExcel={handleExcel}
              />
            ) : (
              <PrintLockBadge />
            )}
            <button
              onClick={() => window.close()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 rounded-md text-sm hover:bg-gray-300"
            >
              <X className="w-4 h-4" />
              Fermer
            </button>
          </div>
        </div>

        {/* Message imprimé si impression verrouillée */}
        {!canPrint && <PrintLockDocumentMessage />}
        {/* === DOCUMENT === */}
        <div
          id="bulletins-doc"
          className={`py-4 print:p-0 print:py-0 ${canPrint ? "" : "print-locked"}`}
        >
          <BulletinsA5Landscape eleves={eleves} iepInfo={iepInfo} singleB5={parentMode} />
        </div>
      </div>
    </>
  );
}
