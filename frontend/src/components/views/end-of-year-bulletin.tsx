"use client";

// === Bulletins individuels « RESULTATS DE FIN D'ANNEE » (modèle IEPP) ===
// S'INSPIRER DU MODÈLE DU MODULE « BULLETINS » (bulletins-a5-landscape) :
// une feuille A4 PAYSAGE reconvertie en DEUX demi-pages (format B5) —
// DEUX ÉLÈVES DIFFÉRENTS sur la même feuille (appariés dans l'ordre de
// mérite : 1er+2e, 3e+4e, …), séparés par un TRAIT DISCONTINU (zone de
// découpe avec ciseaux) qui partage la feuille en deux parties égales.
// La page est EMBELLIE AUX COULEURS DU DRAPEAU DE LA CÔTE D'IVOIRE
// (bandeaux de titres, bordures) — SANS rubans tricolores haut/bas :
// les drapeaux des bordures des feuilles imprimables sont supprimés.
//
// Chaque bulletin est rempli depuis la MÊME source que le tableau de
// classe (/api/reports/end-of-year — le document ne recalcule rien) :
//   - Moyenne de la composition de Passage, Moyenne des compositions
//     Mensuelles, Moyenne Annuelle = (MC + 2 × MCP)/3 — calculées par le
//     backend (module Évaluations → Sessions), au barème du niveau
//     (average_scale : « / 10 » CP-CE, « / 20 » CM) ;
//   - « Rang : X sur Y élèves. » — X = position de l'élève dans l'ORDRE DE
//     MÉRITE (rows arrive trié : moyenne annuelle décroissante, N° = rang),
//     Y = effectif de la classe (récapitulatif) ;
//   - DÉCISION DU CONSEIL DES MAÎTRES (A | R | ABD saisie dans le dossier
//     de l'élève) : la mention convenable OUI est ENTOURÉE et les autres
//     cases restent NON — A → ADMIS(E) OUI, R → REDOUBLE LE COURS OUI,
//     ABD → EXCLU(E) OUI ; sans décision, rien n'est entouré (papier
//     vierge, « rayer les mentions inutiles » reste possible à la main) ;
//   - « Fait à DABOU, le … » = DATE DU JOUR au format jj/mm/aaaa (le lieu
//     est celui de la Direction Régionale de l'IEP — DABOU) ;
//   - Signatures : noms du Maître chargé du cours (tenant de la classe) et
//     du Directeur de l'école écrits EN CARACTÈRE D'IMPRIMERIE (majuscules
//     gras) — AUCUN trait discontinu dans les cases (espace laissé libre
//     pour la signature et le cachet).
// En-tête institutionnel identique au tableau de classe (IEP : Direction
// Régionale, Inspection, BP/Tél, Courriel, armoiries). Noms des FILLES en
// rouge (même convention que le tableau). Session de passage en fin
// d'année civile (août → décembre) ⇒ année scolaire X-Y ; janvier →
// juillet ⇒ (X−1)-X.
// Impression 100 % navigateur (route dédiée /bulletin-fin-annee — zéro PDF
// serveur, discipline du projet).

import { useQuery } from "@tanstack/react-query";
import { Loader2, Scissors, X } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { parentPortalApi, reportsApi } from "@/lib/api";
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
import type { EndOfYearRow, EndOfYearSheet } from "@/lib/types";

import { INK, OFFICIAL_FONT } from "./official-doc";
import { CIArmoiriesWatermark } from "@/components/ci-decor";

// === Couleurs du drapeau de la Côte d'Ivoire (bandes verticales) ===
// Orange #F77F00 · Blanc #FFFFFF · Vert #009E60 — variantes pastel pour
// les fonds et variantes assombries pour le texte (contraste impression).
const CI_ORANGE = "#F77F00";
const CI_GREEN = "#009E60";
/** Vert assombri pour le TEXTE (contraste impression sur fond blanc). */
const GREEN_TEXT = "#00734A";
const GREEN_BG = "#E4F4ED";
/** Gris du trait discontinu de découpe. */
const CUT_DASH = "#9aa2ad";
const CUT_ICON = "#6b7280";
/** Rouge des noms de FILLES (convention des documents de classement). */
const FILLE_RED = "#c00000";

/** Moyenne : virgule française, 2 décimales — pointillés « ……… » si la
 *  moyenne n'existe pas (case vide du modèle). */
function fmtMoy(v: number | null | undefined, has: boolean | undefined): string {
  if (!has || v == null) return "………";
  return v.toFixed(2).replace(".", ",");
}

/** Date du jour au format jj/mm/aaaa (rendu identique serveur/client au
 *  sein d'une même requête — pas de décalage d'hydratation). */
function todayFr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** « Session de Décembre 2026 » — mois de la composition de passage de
 *  l'année (donnée réelle) ; à défaut, l'année de référence seule. */
function sessionLabel(d: EndOfYearSheet): string {
  const sp = d.session_passage;
  if (sp && sp.month >= 1 && sp.month <= 12) {
    const m = monthLabel(sp.month);
    if (m && m !== "—") {
      return `Session de ${m.charAt(0).toUpperCase()}${m.slice(1)} ${sp.year}`;
    }
  }
  return `Session de ${d.year}`;
}

/** Année scolaire du bulletin au format « 2026-2027 » : une session de
 *  passage de fin d'année civile (août → décembre) OUVRIT l'année X-Y ;
 *  une session de janvier → juillet CLOT l'année (X−1)-X. À défaut :
 *  annee_scolaire de l'API (rentrée août/septembre → juillet). */
function anneeScolaireBulletin(d: EndOfYearSheet): string {
  const sp = d.session_passage;
  if (sp && sp.month >= 1 && sp.month <= 12) {
    return sp.month >= 8
      ? `${sp.year}-${sp.year + 1}`
      : `${sp.year - 1}-${sp.year}`;
  }
  return (d.annee_scolaire || "").replace(" ", "-");
}

/** La mention OUI de la ligne `line` est-elle ENTOURÉE pour la décision
 *  `decision` (A | R | ABD) ? A → ADMIS(E), R → REDOUBLE LE COURS,
 *  ABD → EXCLU(E) — la ligne choisie porte OUI entouré, les deux autres
 *  restent NON (non entourés). Sans décision : rien n'est entouré. */
function isCircled(
  decision: string | null | undefined,
  line: "admis" | "redouble" | "exclu",
  choice: "OUI" | "NON",
): boolean {
  if (!decision) return false;
  const ouiLine =
    decision === "A" ? "admis" : decision === "R" ? "redouble" : "exclu";
  return (choice === "OUI") === (line === ouiLine);
}

/** Mention OUI / NON du modèle — entourée d'une ellipse quand la décision
 *  l'exige (bordure transparente sinon, pour alignement identique). */
function OuiNon({ choice, circled }: { choice: "OUI" | "NON"; circled: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        border: circled ? "1.5px solid #000000" : "1.5px solid transparent",
        borderRadius: "50%",
        padding: "2px 9px",
        lineHeight: 1.15,
        fontWeight: 700, // OUI / NON en gras comme le modèle reçu
      }}
    >
      {choice}
    </span>
  );
}

/** Trait DISCONTINU vertical entre les deux bulletins : partage la feuille
 *  en deux parties égales — zone de découpe (ciseaux + pointillés). */
function CutLine() {
  return (
    <div
      aria-hidden="true"
      style={{
        flex: "0 0 5mm",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0.8mm 0",
      }}
    >
      <Scissors
        style={{
          width: 12,
          height: 12,
          transform: "rotate(90deg)",
          color: CUT_ICON,
          flexShrink: 0,
        }}
      />
      <div
        style={{
          flex: 1,
          borderLeft: `1.5px dashed ${CUT_DASH}`,
          marginTop: "0.6mm",
        }}
      />
    </div>
  );
}

/** Bordure verte des cadres du bulletin (couleur drapeau). */
const B: CSSProperties = { border: `1.4px solid ${CI_GREEN}` };

/** Libellé de champ du bloc d'identification (vert drapeau, gras). */
const LABEL: CSSProperties = { fontWeight: 700, color: GREEN_TEXT };

/** Une ligne « Moyenne … | ………/ 10 » du tableau des résultats. */
function MoyRow({
  label,
  value,
  scale,
  highlight,
}: {
  label: string;
  value: string;
  scale: number;
  highlight?: boolean;
}) {
  return (
    <tr
      style={
        highlight ? { background: GREEN_BG } : undefined
      }
    >
      <td
        style={{
          ...B,
          padding: "2.2mm 2.4mm",
          fontWeight: highlight ? 700 : 400,
          fontSize: highlight ? "13px" : "12.5px",
          width: "64%",
        }}
      >
        {label}
      </td>
      <td
        style={{
          ...B,
          padding: "2.2mm 2.4mm",
          fontWeight: 700,
          fontSize: "13px",
          whiteSpace: "nowrap",
          textAlign: "right",
        }}
      >
        {value}/ {scale}
      </td>
    </tr>
  );
}

/** Barème des moyennes du bulletin : donnée backend (average_scale) sinon
 *  déduit du niveau de la classe — 20 pour CM, 10 pour CP/CE. */
function scaleOf(data: EndOfYearSheet, row: EndOfYearRow): number {
  if (row.average_scale && row.average_scale > 0) return row.average_scale;
  return (data.class.level || "").toUpperCase().startsWith("CM") ? 20 : 10;
}

/** UN bulletin d'UN élève (demi-feuille « B5 » — deux élèves DIFFÉRENTS
 *  par feuille A4, séparés par le trait discontinu). En mode PORTAIL
 *  PARENT (`full`), le même bulletin occupe SEUL une page B5 portrait
 *  (176×250 mm) : largeur pleine, sans contrainte de demi-feuille. */
function BulletinCopy({
  data,
  row,
  rang,
  effectif,
  full,
}: {
  data: EndOfYearSheet;
  row: EndOfYearRow;
  rang: number;
  effectif: number;
  /** Portail parent : le bulletin est SEUL sur sa page B5 — pleine
   *  largeur (pas de demi-feuille A4 paysage). */
  full?: boolean;
}) {
  const iep = data.iep;
  const annee = anneeScolaireBulletin(data);
  const isFille = row.gender === "F";
  const scale = scaleOf(data, row);
  // « Fait à … » : ville de la Direction Régionale (DABOU sur le modèle).
  const faitA = (iep?.region || "DABOU").toUpperCase();

  const decisionRows = [
    { key: "admis" as const, label: "ADMIS(E) EN CLASSE SUPÉRIEURE" },
    { key: "redouble" as const, label: "REDOUBLE LE COURS" },
    { key: "exclu" as const, label: "EXCLU(E)" },
  ];

  return (
    <div
      className="bulletin-copy"
      style={{
        flex: full ? "1 1 auto" : "1 1 137mm",
        maxWidth: full ? "none" : "137mm",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        background: "#ffffff",
        color: INK,
        fontSize: "12px",
        lineHeight: 1.35,
        position: "relative", // filigrane armoiries DANS LE FOND
        overflow: "hidden",
      }}
    >
      {/* --- ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane (fond du bulletin).
           Ruban tricolore du haut SUPPRIMÉ : aucune bordure drapeau sur
           les feuilles imprimables. --- */}
      <CIArmoiriesWatermark opacity={0.06} width="62%" />

      {/* --- En-tête institutionnel (identique au tableau de classe) --- */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          margin: "1.8mm 0 2mm",
          gap: "2mm",
          padding: "0 0.8mm",
        }}
      >
        <div style={{ fontSize: "8.8px", lineHeight: 1.35 }}>
          <div>Ministère de l&apos;Education Nationale Et de l&apos;Alphabétisation</div>
          <div>et de l&apos;Enseignement Technique</div>
          <div style={{ fontStyle: "italic", marginTop: "1px" }}>
            Direction Régionale de {(iep?.region || "…………").toUpperCase()}
          </div>
          <div style={{ fontWeight: 700, marginTop: "1px" }}>
            Inspection de l&apos;Enseignement Préscolaire et Primaire de{" "}
            {(iep?.name || "…………").toUpperCase()}
          </div>
          <div style={{ marginTop: "1px" }}>
            BP : {iep?.bp || "……"} / Tel : {iep?.inspector_phone || "…………"}
          </div>
          <div>
            Courriel :{" "}
            <span style={{ color: "#0563C1", textDecoration: "underline" }}>
              {iep?.inspector_email || "…………"}
            </span>
          </div>
        </div>
        <div style={{ textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: "9.6px" }}>République de Côte d&apos;Ivoire</div>
          <div style={{ fontSize: "9px", padding: "1px 0" }}>
            Union-Discipline-Travail
          </div>
          <img
            src="/ci-coat-of-arms.png"
            alt="Armoiries de la République de Côte d'Ivoire"
            style={{ height: "38px", margin: "1px auto 0", display: "block" }}
          />
        </div>
      </div>

      {/* --- Bandeau du titre (vert drapeau) + session --- */}
      <div
        style={{
          background: CI_GREEN,
          color: "#ffffff",
          textAlign: "center",
          padding: "2.4mm 2mm 2.2mm",
          marginBottom: "2.4mm",
        }}
      >
        <div
          style={{
            fontSize: "18px",
            fontWeight: 700,
            letterSpacing: "0.5px",
          }}
        >
          RESULTATS DE FIN D&apos;ANNÉE
        </div>
        <div style={{ fontSize: "12.5px", marginTop: "0.8mm", fontWeight: 600 }}>
          {sessionLabel(data)}
        </div>
      </div>

      {/* --- Identification de l'élève (modèle : 2 colonnes) --- */}
      <div
        style={{
          ...B,
          borderWidth: "1.8px",
          padding: "2mm 2.6mm",
          display: "flex",
          flexDirection: "column",
          gap: "1.2mm",
          marginBottom: "2.4mm",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "2mm" }}>
          <span style={LABEL}>
            Élève :{" "}
            <span
              style={{
                color: isFille ? FILLE_RED : undefined,
                fontWeight: 600,
                // Prénoms et noms de l'élève EN CARACTÈRE D'IMPRIMERIE
                // (majuscules), comme le document officiel de la classe.
                textTransform: "uppercase",
              }}
            >
              {row.full_name}
            </span>
          </span>
          <span style={LABEL}>
            Matricule :{" "}
            <span style={{ color: INK, fontWeight: 700 }}>{row.matricule}</span>
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={LABEL}>
            Classe :{" "}
            <span style={{ color: INK, fontWeight: 700 }}>{data.class.name}</span>
          </span>
          <span style={LABEL}>
            Effectif :{" "}
            <span style={{ color: INK, fontWeight: 700 }}>{effectif}</span>
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={LABEL}>
            Sexe :{" "}
            <span style={{ color: INK, fontWeight: 700 }}>{row.gender}</span>
          </span>
          <span style={LABEL}>
            Année scolaire :{" "}
            <span style={{ color: INK, fontWeight: 700 }}>{annee}</span>
          </span>
        </div>
      </div>

      {/* --- RESULTATS DE FIN D'ANNEE (moyennes + rang) --- */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
          marginBottom: "2.4mm",
        }}
      >
        <tbody>
          <MoyRow
            label="Moyenne de la composition de Passage"
            value={fmtMoy(row.moyenne_passage, row.has_moyenne_passage)}
            scale={scale}
          />
          <MoyRow
            label="Moyenne des compositions Mensuelles"
            value={fmtMoy(row.moyenne_compositions, row.has_moyenne_compositions)}
            scale={scale}
          />
          <MoyRow
            label="Moyenne Annuelle"
            value={fmtMoy(row.moyenne_annuelle, row.has_moyenne_annuelle)}
            scale={scale}
            highlight
          />
          <tr>
            <td
              colSpan={2}
              style={{ ...B, padding: "2mm 2.4mm", fontSize: "13px" }}
            >
              <b>Rang :</b> {rang} sur <b>{effectif}</b> élèves.
            </td>
          </tr>
        </tbody>
      </table>

      {/* --- DÉCISION DU CONSEIL DES MAÎTRES (OUI entouré selon A/R/ABD) --- */}
      <table
        style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}
      >
        <tbody>
          <tr>
            <td
              colSpan={3}
              style={{
                ...B,
                borderWidth: "1.8px",
                background: CI_ORANGE,
                color: "#ffffff",
                textAlign: "center",
                padding: "2mm 2mm",
                fontSize: "13.5px",
                fontWeight: 700,
                letterSpacing: "0.3px",
              }}
            >
              DÉCISION DU CONSEIL DES MAÎTRES
            </td>
          </tr>
          {decisionRows.map((d) => (
            <tr key={d.key}>
              <td
                style={{
                  ...B,
                  padding: "1.8mm 2.2mm",
                  fontWeight: 700,
                  fontSize: "12px",
                  width: "58%",
                }}
              >
                {d.label}
              </td>
              <td style={{ ...B, textAlign: "center", width: "21%" }}>
                <OuiNon
                  choice="OUI"
                  circled={isCircled(row.decision_conseil, d.key, "OUI")}
                />
              </td>
              <td style={{ ...B, textAlign: "center", width: "21%" }}>
                <OuiNon
                  choice="NON"
                  circled={isCircled(row.decision_conseil, d.key, "NON")}
                />
              </td>
            </tr>
          ))}
          <tr>
            <td
              colSpan={3}
              style={{
                ...B,
                textAlign: "center",
                fontSize: "10.6px",
                fontStyle: "italic",
                padding: "1.2mm 2mm",
              }}
            >
              (Rayer les mentions inutiles)
            </td>
          </tr>
          <tr>
            <td
              colSpan={3}
              style={{ ...B, textAlign: "center", fontSize: "12.5px", padding: "1.8mm 2mm" }}
            >
              Fait à {faitA}, le <b>{todayFr()}</b>
            </td>
          </tr>
        </tbody>
      </table>

      {/* --- Signatures (noms écrits, place pour signature + cachet) ---
           collées au bas de la demi-feuille (marginTop auto). */}
      <div style={{ marginTop: "auto", paddingTop: "3mm" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  ...B,
                  borderWidth: "1.8px",
                  verticalAlign: "top",
                  padding: "1.8mm 2.6mm",
                  height: "30mm",
                  // Task 37 — nom + libellé CENTRÉS dans la case (comme la
                  // case « Le Directeur » en face).
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    // Remplit la case (30mm − padding 1.8mm × 2) : le nom
                    // est poussé EN BAS de la case (marginTop auto) —
                    // « juste avant le trait du bas » (demande utilisateur).
                    height: "26.4mm",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: GREEN_TEXT,
                      textDecoration: "underline",
                    }}
                  >
                    Le Maître chargé du cours
                  </div>
                  {data.class.teacher_name ? (
                    /* Nom du titulaire EN CARACTÈRE D'IMPRIMERIE (majuscules
                       gras), JUSTE AVANT LE TRAIT DU BAS de la case —
                       AUCUN trait discontinu dans la case */
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        marginTop: "auto",
                        textTransform: "uppercase",
                        letterSpacing: "0.3px",
                      }}
                    >
                      {data.class.teacher_name}
                    </div>
                  ) : null}
                </div>
              </td>
              <td
                style={{
                  ...B,
                  borderWidth: "1.8px",
                  verticalAlign: "top",
                  padding: "1.8mm 2.6mm",
                  height: "30mm",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    // Remplit la case (30mm − padding 1.8mm × 2) : le nom
                    // est poussé EN BAS de la case (marginTop auto) —
                    // « juste avant le trait du bas » (demande utilisateur).
                    height: "26.4mm",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: GREEN_TEXT,
                      textDecoration: "underline",
                    }}
                  >
                    Le Directeur
                  </div>
                  {data.directeur ? (
                    /* Nom du directeur EN CARACTÈRE D'IMPRIMERIE (majuscules
                       gras), JUSTE AVANT LE TRAIT DU BAS de la case —
                       AUCUN trait discontinu dans la case */
                    <div
                      style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        marginTop: "auto",
                        textTransform: "uppercase",
                        letterSpacing: "0.3px",
                      }}
                    >
                      {data.directeur}
                    </div>
                  ) : null}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}

/** Demi-feuille vide (nombre impair d'élèves : le dernier bulletin seul,
 *  la moitié droite reste blanche — prête à la découpe). */
function EmptyHalf() {
  return (
    <div
      aria-hidden="true"
      style={{ flex: "1 1 137mm", maxWidth: "137mm", minWidth: 0 }}
    />
  );
}

// === MODÈLE WORD (.doc) — un SEUL fichier, UN bulletin par élève ===
// Les bulletins de TOUS les élèves sont enchaînés dans le même document,
// séparés par un SAUT DE PAGE Word (mso-special-character:line-break).
// Chaque bulletin reproduit le rendu PDF de BulletinCopy : en-tête
// institutionnel (Ministère / Direction Régionale / Inspection IEP / BP /
// Courriel + République / Union-Discipline-Travail), bandeau vert du
// titre + session, encadré d'identification, tableau des moyennes (fond
// pastel sur la moyenne annuelle), « Rang », DÉCISION DU CONSEIL DES
// MAÎTRES (bandeau orange, OUI entouré selon la décision A/R/ABD),
// « Fait à … » et signatures « Le Maître chargé du cours » / « Le
// Directeur » avec noms en caractère d'imprimerie (majuscules).
const EOY_WORD_PAGE_BREAK =
  "<br clear=all style='mso-special-character:line-break;page-break-before:always'>";

function buildEofyBulletinsWordHtml(
  data: EndOfYearSheet,
  rows: EndOfYearRow[],
  effectif: number,
): string {
  const esc = escHtml;
  const iep = data.iep;
  const annee = anneeScolaireBulletin(data);
  // « Fait à … » : ville de la Direction Régionale (DABOU sur le modèle).
  const faitA = (iep?.region || "DABOU").toUpperCase();

  // Cadres du modèle (vert drapeau) + libellés verts gras.
  const BO = "border:1.8px solid #009E60;";
  const BT = "border:1.4px solid #009E60;";
  const LBL = "font-weight:bold; color:#00734A;";

  const bulletin = (row: EndOfYearRow, rang: number): string => {
    const scale = scaleOf(data, row);
    const isFille = row.gender === "F";
    const nom = esc(row.full_name.toUpperCase());
    const nomStyle = isFille ? "font-weight:600; color:#c00000;" : "font-weight:600;";

    // Mention OUI / NON — l'ellipse du modèle est rendue par une bordure
    // noire (Word HTML 2003 ne gère pas border-radius).
    const ouiNon = (choice: "OUI" | "NON", circled: boolean) =>
      `<span style="border:1.5px solid ${circled ? "#000000" : "transparent"}; padding:2px 9px; font-weight:bold;">${choice}</span>`;

    const decisions = [
      { key: "admis" as const, label: "ADMIS(E) EN CLASSE SUPÉRIEURE" },
      { key: "redouble" as const, label: "REDOUBLE LE COURS" },
      { key: "exclu" as const, label: "EXCLU(E)" },
    ];

    // Ligne « Moyenne … | ………/ 10 » (fond pastel sur la moyenne annuelle).
    const moyRow = (label: string, value: string, highlight: boolean) =>
      `<tr>` +
      `<td style="${BT} padding:2.2mm 2.4mm; width:64%; ${highlight ? "font-weight:bold; font-size:13px; background:#E4F4ED;" : "font-size:12.5px;"}">${esc(label)}</td>` +
      `<td style="${BT} padding:2.2mm 2.4mm; font-weight:bold; font-size:13px; white-space:nowrap; text-align:right;">${esc(value)}/ ${scale}</td>` +
      `</tr>`;

    // Case signature : table imbriquée — intitulé souligné EN HAUT, nom en
    // CARACTÈRE D'IMPRIMERIE (majuscules) JUSTE AVANT LE TRAIT DU BAS
    // (vertical-align:bottom, comme le modèle PDF, AUCUN trait discontinu).
    const sigCell = (label: string, name: string) =>
      `<td style="${BO} width:50%; vertical-align:top; padding:1.8mm 2.6mm;">` +
      `<table style="border-collapse:collapse; width:100%; height:26.4mm;"><tr>` +
      `<td style="border:none; text-align:center; font-size:12px; font-weight:bold; color:#00734A; text-decoration:underline;">${esc(label)}</td>` +
      `</tr><tr>` +
      `<td style="border:none; vertical-align:bottom; text-align:center; font-size:12px; font-weight:bold; letter-spacing:0.3px;">${name ? esc(name.toUpperCase()) : ""}</td>` +
      `</tr></table></td>`;

    return (
      `<div>` +
      // --- En-tête institutionnel (identique au tableau de classe) ---
      `<table style="border-collapse:collapse; width:100%; table-layout:fixed;"><tr>` +
      `<td style="border:none; width:62%; vertical-align:top; font-size:8.8px; line-height:1.35;">` +
      `<p>Ministère de l'Education Nationale Et de l'Alphabétisation</p>` +
      `<p>et de l'Enseignement Technique</p>` +
      `<p style="font-style:italic;">Direction Régionale de ${esc((iep?.region || "…………").toUpperCase())}</p>` +
      `<p style="font-weight:bold;">Inspection de l'Enseignement Préscolaire et Primaire de ${esc((iep?.name || "…………").toUpperCase())}</p>` +
      `<p>BP : ${esc(iep?.bp || "……")} / Tel : ${esc(iep?.inspector_phone || "…………")}</p>` +
      `<p>Courriel : ${esc(iep?.inspector_email || "…………")}</p>` +
      `</td>` +
      `<td style="border:none; width:38%; text-align:center; vertical-align:top;">` +
      `<p style="font-size:9.6px;">République de Côte d'Ivoire</p>` +
      `<p style="font-size:9px;">Union-Discipline-Travail</p>` +
      `</td></tr></table>` +
      // --- Bandeau du titre (vert drapeau) + session ---
      `<table style="border-collapse:collapse; width:100%; margin-top:2mm;"><tr>` +
      `<td style="border:none; background:#009E60; color:#ffffff; text-align:center; padding:2.4mm 2mm;">` +
      `<p style="font-size:18px; font-weight:bold; letter-spacing:0.5px;">RESULTATS DE FIN D'ANNÉE</p>` +
      `<p style="font-size:12.5px; font-weight:600; margin-top:1px;">${esc(sessionLabel(data))}</p>` +
      `</td></tr></table>` +
      // --- Identification de l'élève (modèle : 2 colonnes) ---
      `<table style="border-collapse:collapse; width:100%; table-layout:fixed; margin-top:2.4mm;">` +
      `<colgroup><col style="width:58%"><col style="width:42%"></colgroup>` +
      `<tr><td style="${BO} padding:1.2mm 2.6mm;"><p><span style="${LBL}">Élève : </span><span style="${nomStyle} text-transform:uppercase;">${nom}</span></p></td>` +
      `<td style="${BO} padding:1.2mm 2.6mm;"><p><span style="${LBL}">Matricule : </span><span style="font-weight:bold;">${esc(row.matricule)}</span></p></td></tr>` +
      `<tr><td style="${BO} padding:1.2mm 2.6mm;"><p><span style="${LBL}">Classe : </span><span style="font-weight:bold;">${esc(data.class.name)}</span></p></td>` +
      `<td style="${BO} padding:1.2mm 2.6mm;"><p><span style="${LBL}">Effectif : </span><span style="font-weight:bold;">${effectif}</span></p></td></tr>` +
      `<tr><td style="${BO} padding:1.2mm 2.6mm;"><p><span style="${LBL}">Sexe : </span><span style="font-weight:bold;">${esc(row.gender)}</span></p></td>` +
      `<td style="${BO} padding:1.2mm 2.6mm;"><p><span style="${LBL}">Année scolaire : </span><span style="font-weight:bold;">${esc(annee)}</span></p></td></tr>` +
      `</table>` +
      // --- RESULTATS DE FIN D'ANNEE (moyennes + rang) ---
      `<table style="border-collapse:collapse; width:100%; table-layout:fixed; margin-top:2.4mm;">` +
      moyRow("Moyenne de la composition de Passage", fmtMoy(row.moyenne_passage, row.has_moyenne_passage), false) +
      moyRow("Moyenne des compositions Mensuelles", fmtMoy(row.moyenne_compositions, row.has_moyenne_compositions), false) +
      moyRow("Moyenne Annuelle", fmtMoy(row.moyenne_annuelle, row.has_moyenne_annuelle), true) +
      `<tr><td colspan=2 style="${BT} padding:2mm 2.4mm; font-size:13px;"><b>Rang :</b> ${rang} sur <b>${effectif}</b> élèves.</td></tr>` +
      `</table>` +
      // --- DÉCISION DU CONSEIL DES MAÎTRES (OUI entouré selon A/R/ABD) ---
      `<table style="border-collapse:collapse; width:100%; table-layout:fixed;">` +
      `<tr><td colspan=3 style="${BT} background:#F77F00; color:#ffffff; text-align:center; padding:2mm; font-size:13.5px; font-weight:bold; letter-spacing:0.3px;">DÉCISION DU CONSEIL DES MAÎTRES</td></tr>` +
      decisions
        .map(
          (d) =>
            `<tr>` +
            `<td style="${BT} padding:1.8mm 2.2mm; width:58%; font-weight:bold; font-size:12px;">${esc(d.label)}</td>` +
            `<td style="${BT} width:21%; text-align:center;">${ouiNon("OUI", isCircled(row.decision_conseil, d.key, "OUI"))}</td>` +
            `<td style="${BT} width:21%; text-align:center;">${ouiNon("NON", isCircled(row.decision_conseil, d.key, "NON"))}</td>` +
            `</tr>`,
        )
        .join("") +
      `<tr><td colspan=3 style="${BT} text-align:center; font-size:10.6px; font-style:italic; padding:1.2mm 2mm;">(Rayer les mentions inutiles)</td></tr>` +
      `<tr><td colspan=3 style="${BT} text-align:center; font-size:12.5px; padding:1.8mm 2mm;">Fait à ${esc(faitA)}, le <b>${todayFr()}</b></td></tr>` +
      `</table>` +
      // --- Signatures (noms écrits, place pour signature + cachet) ---
      `<table style="border-collapse:collapse; width:100%; table-layout:fixed; margin-top:3mm;"><tr>` +
      sigCell("Le Maître chargé du cours", data.class.teacher_name || "") +
      sigCell("Le Directeur", data.directeur || "") +
      `</tr></table>` +
      `</div>`
    );
  };

  return buildWordShell({
    title: `Bulletins de fin d'année — ${data.class.name} — ${data.school.name} — ${data.year}`,
    orientation: "portrait",
    marginMm: 8,
    styles: `p { margin:0; }`,
    bodyHtml: rows
      .map((row, i) => bulletin(row, i + 1))
      .join(EOY_WORD_PAGE_BREAK),
  });
}

// === MODÈLE EXCEL (.xlsx) — UNE FEUILLE PAR ÉLÈVE ===
// Classeur exceljs : chaque feuille reproduit le bulletin (en-tête
// institutionnel fusionné, bandeau vert, identification, moyennes bordées
// vertes, décision avec OUI entouré, « Fait à … », signatures). Au-delà
// de 60 élèves le classeur est LIMITÉ À 60 FEUILLES et une note rouge est
// insérée en tête de la première feuille (éviter les classeurs
// monstrueux). Nom de feuille « Bulletin N — NOM » tronqué à 31
// caractères, caractères invalides Excel remplacés.
const EOY_EXCEL_MAX_SHEETS = 60;

/** Nom de feuille Excel sûr : ≤ 31 caractères, sans \ / ? * [ ] : */
function safeSheetName(base: string): string {
  return base
    .replace(/[\\/?*[\]:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
}

async function exportEofyBulletinsExcelAsync(
  data: EndOfYearSheet,
  rows: EndOfYearRow[],
  effectif: number,
  filename: string,
): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";

  const limited = rows.length > EOY_EXCEL_MAX_SHEETS;
  const list = limited ? rows.slice(0, EOY_EXCEL_MAX_SHEETS) : rows;

  const iep = data.iep;
  const annee = anneeScolaireBulletin(data);
  const teacher = (data.class.teacher_name || "").trim();
  const directeur = (data.directeur || "").trim();

  // Couleurs du drapeau CI (mêmes que le PDF) + bordures vertes.
  const GREEN = { argb: "FF009E60" };
  const GREEN_TXT = { argb: "FF00734A" };
  const RED = { argb: "FFC00000" };
  const WHITE = "FFFFFFFF";
  const BORDER = { style: "thin" as const, color: GREEN };
  const BOX = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
  const BLACK_C = { style: "medium" as const, color: { argb: "FF000000" } };

  // Police Arial (police des modèles Word/Excel du projet).
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
    const row = list[i];
    const scale = scaleOf(data, row);
    const ws = wb.addWorksheet(
      safeSheetName(`Bulletin ${i + 1} — ${row.full_name}`),
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
    ws.columns = [30, 14, 14, 12, 15].map((width) => ({ width }));

    // Rangée de départ (décalée si la note de limitation est insérée).
    let r = 1;
    if (limited && i === 0) {
      ws.mergeCells(1, 1, 1, 5);
      const note = ws.getCell(1, 1);
      note.value = `Note : le lot compte ${rows.length} élèves ; le classeur est limité à ${EOY_EXCEL_MAX_SHEETS} feuilles — exporter les classes restantes une par une.`;
      note.font = font(11, true, RED.argb);
      note.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      ws.getRow(1).height = 28;
      r = 3;
    }

    // Ligne fusionnée sur les 5 colonnes (en-tête institutionnel, bandeaux).
    const full = (
      rr: number,
      value: string | { richText: RichPart[] },
      size: number,
      bold = false,
      opts?: { italic?: boolean; argb?: string; fill?: string; box?: boolean; h?: number },
    ) => {
      ws.mergeCells(rr, 1, rr, 5);
      const c = ws.getCell(rr, 1);
      c.value = value;
      c.font = font(size, bold, opts?.argb, opts?.italic ?? false);
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      if (opts?.fill) {
        for (let col = 1; col <= 5; col++) {
          ws.getCell(rr, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
        }
      }
      if (opts?.box) for (let col = 1; col <= 5; col++) ws.getCell(rr, col).border = BOX;
      if (opts?.h) ws.getRow(rr).height = opts.h;
    };

    // --- En-tête institutionnel (fidèle au modèle PDF) ---
    full(r, "Ministère de l'Education Nationale Et de l'Alphabétisation — et de l'Enseignement Technique", 12, true);
    full(r + 1, `Direction Régionale de ${(iep?.region || "…………").toUpperCase()} — Inspection de l'Enseignement Préscolaire et Primaire de ${(iep?.name || "…………").toUpperCase()}`, 11, true, { italic: true });
    full(r + 2, `BP : ${iep?.bp || "……"} / Tel : ${iep?.inspector_phone || "…………"} — Courriel : ${iep?.inspector_email || "…………"}`, 11);
    full(r + 3, "République de Côte d'Ivoire — Union-Discipline-Travail", 11, true);
    // --- Bandeau du titre (vert drapeau) + session ---
    full(r + 4, "RESULTATS DE FIN D'ANNÉE", 14, true, { argb: WHITE, fill: "FF009E60", box: true });
    full(r + 5, sessionLabel(data), 12, true, { argb: WHITE, fill: "FF009E60", box: true });
    ws.getRow(r + 6).height = 4;

    // --- Identification de l'élève (libellés verts gras + valeur, boîte) ---
    const ident = (
      rr: number,
      leftLabel: string,
      leftValue: string,
      leftColor: string | undefined,
      rightLabel: string,
      rightValue: string,
    ) => {
      ws.mergeCells(rr, 1, rr, 3);
      const lc = ws.getCell(rr, 1);
      lc.value = {
        richText: [
          { font: font(11, true, GREEN_TXT.argb), text: leftLabel },
          { font: font(11, true, leftColor), text: leftValue },
        ],
      };
      lc.alignment = { horizontal: "left", vertical: "middle" };
      ws.mergeCells(rr, 4, rr, 5);
      const rc = ws.getCell(rr, 4);
      rc.value = {
        richText: [
          { font: font(11, true, GREEN_TXT.argb), text: rightLabel },
          { font: font(11, true), text: rightValue },
        ],
      };
      rc.alignment = { horizontal: "left", vertical: "middle" };
      for (let col = 1; col <= 5; col++) ws.getCell(rr, col).border = BOX;
      ws.getRow(rr).height = 16;
    };
    ident(r + 7, "Élève : ", row.full_name.toUpperCase(), row.gender === "F" ? RED.argb : undefined, "Matricule : ", row.matricule);
    ident(r + 8, "Classe : ", data.class.name, undefined, "Effectif : ", String(effectif));
    ident(r + 9, "Sexe : ", row.gender, undefined, "Année scolaire : ", annee);
    ws.getRow(r + 10).height = 4;

    // --- Moyennes (fond pastel sur la moyenne annuelle) ---
    const moy = (rr: number, label: string, value: string, highlight: boolean) => {
      ws.mergeCells(rr, 1, rr, 3);
      const lc = ws.getCell(rr, 1);
      lc.value = label;
      lc.font = font(11, highlight);
      lc.alignment = { horizontal: "left", vertical: "middle" };
      ws.mergeCells(rr, 4, rr, 5);
      const vc = ws.getCell(rr, 4);
      vc.value = `${value}/ ${scale}`;
      vc.font = font(11, true);
      vc.alignment = { horizontal: "right", vertical: "middle" };
      for (let col = 1; col <= 5; col++) {
        const c = ws.getCell(rr, col);
        c.border = BOX;
        if (highlight) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F4ED" } };
      }
      ws.getRow(rr).height = 16;
    };
    moy(r + 11, "Moyenne de la composition de Passage", fmtMoy(row.moyenne_passage, row.has_moyenne_passage), false);
    moy(r + 12, "Moyenne des compositions Mensuelles", fmtMoy(row.moyenne_compositions, row.has_moyenne_compositions), false);
    moy(r + 13, "Moyenne Annuelle", fmtMoy(row.moyenne_annuelle, row.has_moyenne_annuelle), true);
    full(r + 14, `Rang : ${i + 1} sur ${effectif} élèves.`, 11, false, { box: true });
    ws.getRow(r + 15).height = 4;

    // --- DÉCISION DU CONSEIL DES MAÎTRES (bandeau orange, OUI entouré) ---
    full(r + 16, "DÉCISION DU CONSEIL DES MAÎTRES", 12, true, { argb: WHITE, fill: "FFF77F00", box: true });
    const decRows = [
      { key: "admis" as const, label: "ADMIS(E) EN CLASSE SUPÉRIEURE" },
      { key: "redouble" as const, label: "REDOUBLE LE COURS" },
      { key: "exclu" as const, label: "EXCLU(E)" },
    ];
    decRows.forEach((d, k) => {
      const rr = r + 17 + k;
      ws.mergeCells(rr, 1, rr, 3);
      const lc = ws.getCell(rr, 1);
      lc.value = d.label;
      lc.font = font(11, true);
      lc.alignment = { horizontal: "left", vertical: "middle" };
      const oui = ws.getCell(rr, 4);
      oui.value = "OUI";
      const non = ws.getCell(rr, 5);
      non.value = "NON";
      [oui, non].forEach((c) => {
        c.font = font(11, true);
        c.alignment = { horizontal: "center", vertical: "middle" };
      });
      for (let col = 1; col <= 5; col++) ws.getCell(rr, col).border = BOX;
      // Ellipse du modèle → bordure noire épaisse sur le OUI entouré.
      if (isCircled(row.decision_conseil, d.key, "OUI")) {
        ws.getCell(rr, 4).border = { top: BLACK_C, left: BLACK_C, bottom: BLACK_C, right: BLACK_C };
      }
      ws.getRow(rr).height = 16;
    });
    full(r + 20, "(Rayer les mentions inutiles)", 10, false, { italic: true, box: true });
    full(r + 21, `Fait à ${(iep?.region || "DABOU").toUpperCase()}, le ${todayFr()}`, 12, false, { box: true });
    ws.getRow(r + 22).height = 6;

    // --- Signatures (intitulé en haut, nom en bas de la case) ---
    const rs = r + 23;
    const sigZone = (colStart: number, colEnd: number, label: string, name: string) => {
      ws.mergeCells(rs, colStart, rs, colEnd);
      const lab = ws.getCell(rs, colStart);
      lab.value = label;
      lab.font = { name: "Arial", size: 12, bold: true, underline: true, color: { argb: GREEN_TXT.argb } };
      lab.alignment = { horizontal: "center", vertical: "middle" };
      ws.mergeCells(rs + 1, colStart, rs + 2, colEnd); // place signature + cachet
      ws.mergeCells(rs + 3, colStart, rs + 3, colEnd);
      const nm = ws.getCell(rs + 3, colStart);
      if (name) nm.value = name.toUpperCase(); // caractère d'imprimerie
      nm.font = font(12, true);
      nm.alignment = { horizontal: "center", vertical: "bottom" };
      for (let rr = rs; rr <= rs + 3; rr++) {
        for (let col = colStart; col <= colEnd; col++) ws.getCell(rr, col).border = BOX;
      }
    };
    sigZone(1, 2, "Le Maître chargé du cours", teacher);
    sigZone(4, 5, "Le Directeur", directeur);
    ws.getRow(rs).height = 15;
    ws.getRow(rs + 1).height = 14;
    ws.getRow(rs + 2).height = 14;
    ws.getRow(rs + 3).height = 15;

    // --- Armoiries en haut de feuille (meilleur effort) ---
    if (arm) {
      try {
        const imgId = wb.addImage({
          buffer: arm as unknown as Parameters<typeof wb.addImage>[0]["buffer"],
          extension: "png",
        });
        ws.addImage(imgId, { tl: { col: 3.5, row: 0.2 }, ext: { width: 46, height: 46 } });
      } catch {
        // armoiries omises — l'en-tête reste lisible
      }
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: XLSX_MIME }), filename);
}

/** Page complète : barre d'outils + les feuilles (2 élèves DIFFÉRENTS par
 *  feuille A4 paysage, appariés dans l'ordre de mérite). */
export function EndOfYearBulletin({
  schoolId,
  classId,
  year,
  onClose,
  matricule,
}: {
  schoolId?: string;
  classId?: string;
  year: number;
  onClose: () => void;
  /** v2 — PORTAIL PARENT : si présent, mode « bulletin individuel de
   *  l'enfant » — données chargées par MATRICULE via /api/parent/… et la
   *  page n'affiche que le bulletin de CET élève (v3 : UN SEUL
   *  exemplaire, page B5 portrait). */
  matricule?: string;
}) {
  const role = usePrintRole();
  // Impression : admin + inspector (documents internes) OU parent en mode
  // portail parent (bulletin individuel de son enfant uniquement).
  const canPrint = canPrintDocument(role, !!matricule);
  const parentMode = !!matricule;
  // Modèles Word/Excel : état d'export (« doc » | « xlsx » | null) —
  // useState PLACÉ AVANT LES RETOURS CONDITIONNELS (discipline React).
  const [exporting, setExporting] = useState<"doc" | "xlsx" | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: [
      "end-of-year",
      parentMode ? `parent:${matricule}` : schoolId,
      classId,
      year,
    ],
    queryFn: () =>
      parentMode
        ? parentPortalApi.endOfYear(matricule!, year)
        : reportsApi.endOfYearSheet(schoolId!, classId!, year),
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

  // v2 — mode parent : isoler le bulletin de l'enfant (student_id renvoyé
  // par l'API) ; le rang et l'effectif restent ceux de la classe complète.
  const rows = parentMode
    ? data.rows.filter((r) => r.student_id === data.student_id)
    : data.rows;
  const effectif = data.summary?.effectif?.total ?? data.count;
  // RANG RÉEL de l'enfant dans l'ordre de mérite de la classe (1-based) —
  // les copies du mode parent affichent ce rang (pas la position sur la
  // feuille).
  const childRang =
    data.rows.findIndex((r) => r.student_id === data.student_id) + 1;

  // Nom de base des fichiers Word/Excel : bulletins-fin-annee-<slug classe>
  // (slugFile — même convention que les autres documents du projet).
  const fileBase = `bulletins-fin-annee-${slugFile(data.class.name)}`;
  // data est non-nulle ici (retours conditionnels ci-dessus) — const locale
  // pour que la réduction de type traverse les closures des handlers.
  const sheet: EndOfYearSheet = data;

  // Modèle WORD (.doc) — un SEUL fichier, un bulletin par élève, séparés
  // par un saut de page Word (mêmes verrous que l'impression).
  function handleWord() {
    setExporting("doc");
    try {
      saveWordDoc(
        buildEofyBulletinsWordHtml(sheet, rows, effectif),
        `${fileBase}.doc`,
      );
    } finally {
      setExporting(null);
    }
  }

  // Modèle EXCEL (.xlsx) — une feuille par élève (exceljs importé à la
  // demande, comme la liste des candidats).
  async function handleExcel() {
    setExporting("xlsx");
    try {
      await exportEofyBulletinsExcelAsync(sheet, rows, effectif, `${fileBase}.xlsx`);
    } finally {
      setExporting(null);
    }
  }

  // Appariement des élèves (ordre de mérite — les rows arrivent triés) :
  // 1er + 2e sur la première feuille, 3e + 4e sur la suivante, etc.
  // (nombre impair → le dernier bulletin est seul sur sa feuille).
  // v3 — MODE PARENT : plus de double exemplaire — UN SEUL bulletin,
  // seul sur sa page au FORMAT B5 PORTRAIT (176×250 mm), sans trait de
  // découpe (rendu dédié `parent-b5-sheet`, voir plus bas).
  const pairs: EndOfYearRow[][] = [];
  if (!parentMode) {
    for (let i = 0; i < rows.length; i += 2) {
      pairs.push(rows.slice(i, i + 2));
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Bulletins de fin d&apos;année — {data.school.name} · {data.class.name}{" "}
          · {data.count} élève(s) · Année {data.year}
        </h3>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-xs text-muted-foreground mr-1">
            {parentMode
              ? "Format : B5 portrait — bulletin unique (un seul exemplaire)"
              : "Format : A4 paysage — 2 bulletins par feuille (2 élèves différents, à découper)"}
          </span>
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
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 rounded-md text-sm"
          >
            <X className="w-4 h-4" />
            Fermer
          </button>
        </div>
      </div>

      {/* Message imprimé à la place du document si impression verrouillée */}
      {!canPrint && <PrintLockDocumentMessage />}
      {/* v3 — MODE PORTAIL PARENT : @page B5 portrait (176×250 mm, marge
          8 mm) — <style> rendu dans le corps (APRÈS le <link> print.css de
          la tête) : il prime sur la règle @page « 297mm 210mm » (A4
          paysage) du mode admin, même technique que /bulletins. */}
      {parentMode && (
        <style>{`@page { size: 176mm 250mm; margin: 8mm; }`}</style>
      )}
      {/* === BULLETINS (isolement impression #bulletins-fin-annee-doc) === */}
      <div
        id="bulletins-fin-annee-doc"
        className={canPrint ? undefined : "print-locked"}
        style={{
          fontFamily: OFFICIAL_FONT,
          color: INK,
          padding: "16px 8px 24px",
        }}
      >
        {parentMode ? (
          /* === MODE PARENT : UN SEUL BULLETIN — FEUILLE B5 PORTRAIT ===
             Le bulletin de l'enfant occupe SEUL sa page (176×250 mm) :
             pleine largeur, signatures poussées en bas, AUCUN trait de
             découpe ni second exemplaire. */
          <div className="parent-b5-sheet">
            {rows.length > 0 && (
              <BulletinCopy
                data={data}
                row={rows[0]}
                rang={childRang}
                effectif={effectif}
                full
              />
            )}
          </div>
        ) : (
          pairs.map((pair, pageIdx) => {
          const isLastPage = pageIdx === pairs.length - 1;
          return (
            <div
              key={pageIdx}
              className="bulletin-pair"
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                alignItems: "stretch",
                width: "fit-content",
                maxWidth: "100%",
                margin: "0 auto 16px",
                background: "#ffffff",
                boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
                pageBreakAfter: isLastPage ? "auto" : "always",
              }}
            >
              {pair.length > 0 && (
                <BulletinCopy
                  data={data}
                  row={pair[0]}
                  rang={pageIdx * 2 + 1}
                  effectif={effectif}
                />
              )}
              <CutLine />
              {pair.length > 1 ? (
                <BulletinCopy
                  data={data}
                  row={pair[1]}
                  rang={pageIdx * 2 + 2}
                  effectif={effectif}
                />
              ) : (
                <EmptyHalf />
              )}
            </div>
          );
          })
        )}
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-10">
            Aucun élève inscrit dans ce cours.
          </p>
        )}
      </div>
    </div>
  );
}
