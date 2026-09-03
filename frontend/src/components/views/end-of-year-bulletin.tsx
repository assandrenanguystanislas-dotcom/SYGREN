"use client";

// === Bulletins individuels « RESULTATS DE FIN D'ANNEE » (modèle IEPP) ===
// S'INSPIRER DU MODÈLE DU MODULE « BULLETINS » (bulletins-a5-landscape) :
// une feuille A4 PAYSAGE reconvertie en DEUX demi-pages (format B5) —
// DEUX ÉLÈVES DIFFÉRENTS sur la même feuille (appariés dans l'ordre de
// mérite : 1er+2e, 3e+4e, …), séparés par un TRAIT DISCONTINU (zone de
// découpe avec ciseaux) qui partage la feuille en deux parties égales.
// La page est EMBELLIE AUX COULEURS DU DRAPEAU DE LA CÔTE D'IVOIRE
// (bandes orange-blanc-vert : rubans, bandeaux de titres, bordures).
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
//     du Directeur de l'école écrits au-dessus de la ligne de signature —
//     place réservée à la signature et au cachet.
// En-tête institutionnel identique au tableau de classe (IEP : Direction
// Régionale, Inspection, BP/Tél, Courriel, armoiries). Noms des FILLES en
// rouge (même convention que le tableau). Session de passage en fin
// d'année civile (août → décembre) ⇒ année scolaire X-Y ; janvier →
// juillet ⇒ (X−1)-X.
// Impression 100 % navigateur (route dédiée /bulletin-fin-annee — zéro PDF
// serveur, discipline du projet).

import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, Scissors, X } from "lucide-react";
import type { CSSProperties } from "react";

import { parentPortalApi, reportsApi } from "@/lib/api";
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
const ORANGE_BG = "#FDEBDA";
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

/** Ruban tricolore ivoirien (trois bandes VERTICALES orange-blanc-vert,
 *  comme le drapeau) — filet décoratif haut et bas de chaque bulletin. */
function FlagRibbon({ height = "2.6mm" }: { height?: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        height,
        boxSizing: "border-box",
        border: "0.5px solid #d1d5db",
      }}
    >
      <div style={{ flex: 1, background: CI_ORANGE }} />
      <div style={{ flex: 1, background: "#FFFFFF" }} />
      <div style={{ flex: 1, background: CI_GREEN }} />
    </div>
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
      {/* --- ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane (fond du bulletin) --- */}
      <CIArmoiriesWatermark opacity={0.06} width="62%" />
      {/* --- Ruban tricolore (haut) --- */}
      <FlagRibbon />

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
            <span style={{ color: isFille ? FILLE_RED : undefined, fontWeight: 600 }}>
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
                  <div style={{ fontSize: "11.5px", fontWeight: 600, marginTop: "1.2mm" }}>
                    {data.class.teacher_name}
                  </div>
                ) : null}
                <div
                  style={{
                    marginTop: "8mm",
                    marginInline: "6mm",
                    borderBottom: `1px dotted ${CUT_DASH}`,
                  }}
                />
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
                    fontSize: "12px",
                    fontWeight: 700,
                    color: GREEN_TEXT,
                    textDecoration: "underline",
                  }}
                >
                  Le Directeur
                </div>
                {data.directeur ? (
                  <div style={{ fontSize: "11.5px", fontWeight: 600, marginTop: "1.2mm" }}>
                    {data.directeur}
                  </div>
                ) : null}
                <div
                  style={{
                    marginTop: "8mm",
                    marginInline: "6mm",
                    borderBottom: `1px dotted ${CUT_DASH}`,
                  }}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* --- Ruban tricolore (bas) --- */}
      <div style={{ paddingTop: "2mm" }}>
        <FlagRibbon height="2mm" />
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
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90"
            >
              <Printer className="w-4 h-4" />
              Imprimer / PDF
            </button>
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
