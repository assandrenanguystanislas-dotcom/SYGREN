"use client";

// === Bulletins individuels « RESULTATS DE FIN D'ANNEE » (modèle IEPP) ===
// UN bulletin PAR ÉLÈVE, imprimé A4 PAYSAGE avec DEUX exemplaires côte à
// côte (un pour l'école, un pour les parents — à découper), rempli depuis
// la MÊME source que le tableau de classe (/api/reports/end-of-year — le
// document ne recalcule rien) :
//   - Moyenne de la composition de Passage, Moyenne des compositions
//     Mensuelles, Moyenne Annuelle = (MC + 2 × MCP)/3 — calculées par le
//     backend (module Évaluations → Sessions) ;
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
//     du Directeur de l'école écrits sous les mentions — place réservée à
//     la signature et au cachet.
// En-tête institutionnel identique au tableau de classe (IEP : Direction
// Régionale, Inspection, BP/Tél, Courriel, armoiries). Noms des FILLES en
// rouge (même convention que le tableau). Session de passage en fin
// d'année civile (août → décembre) ⇒ année scolaire X-Y ; janvier →
// juillet ⇒ (X−1)-X.
// Impression 100 % navigateur (route dédiée /bulletin-fin-annee — zéro PDF
// serveur, discipline du projet).

import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";
import type { CSSProperties } from "react";

import { reportsApi } from "@/lib/api";
import { monthLabel } from "@/lib/session-utils";
import type { EndOfYearRow, EndOfYearSheet } from "@/lib/types";

import { INK, OFFICIAL_FONT } from "./official-doc";

/** Bleu du modèle reçu (cadres du bulletin). */
const BLUE_LINE = "#3b6fd4";
/** Bleu des titres « RESULTATS DE FIN D'ANNEE » / « DÉCISION… ». */
const BLUE_TITLE = "#1d4fb8";
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

/** Bordure bleue des cadres du bulletin. */
const B: CSSProperties = { border: `1.4px solid ${BLUE_LINE}` };

/** Une ligne « Moyenne … | ………/ 10 » du tableau des résultats. */
function MoyRow({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <tr>
      <td
        style={{
          ...B,
          padding: "1.6mm 2mm",
          fontWeight: bold ? 700 : 400,
          fontSize: bold ? "12px" : "11.5px",
          width: "64%",
        }}
      >
        {label}
      </td>
      <td
        style={{
          ...B,
          padding: "1.6mm 2mm",
          fontWeight: bold ? 700 : 400,
          fontSize: "12px",
          whiteSpace: "nowrap",
        }}
      >
        {value}/ 10
      </td>
    </tr>
  );
}

/** UN exemplaire du bulletin d'UN élève (deux exemplaires par feuille). */
function BulletinCopy({
  data,
  row,
  rang,
  effectif,
}: {
  data: EndOfYearSheet;
  row: EndOfYearRow;
  rang: number;
  effectif: number;
}) {
  const iep = data.iep;
  const annee = anneeScolaireBulletin(data);
  const isFille = row.gender === "F";
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
        width: "136mm",
        flexShrink: 0,
        background: "#ffffff",
        color: INK,
        fontSize: "11px",
        lineHeight: 1.3,
      }}
    >
      {/* --- En-tête institutionnel (identique au tableau de classe) --- */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1.5mm",
          gap: "2mm",
        }}
      >
        <div style={{ fontSize: "8.4px", lineHeight: 1.32 }}>
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
          <div style={{ fontSize: "9.2px" }}>République de Côte d&apos;Ivoire</div>
          <div style={{ fontSize: "8.8px", padding: "1px 0" }}>
            Union-Discipline-Travail
          </div>
          <img
            src="/ci-coat-of-arms.png"
            alt="Armoiries de la République de Côte d'Ivoire"
            style={{ height: "34px", margin: "1px auto 0", display: "block" }}
          />
        </div>
      </div>

      {/* --- Boîte du titre + session --- */}
      <div
        style={{
          border: "1.4px solid #000000",
          padding: "2.2mm 3mm 2mm",
          textAlign: "center",
          marginBottom: "1.8mm",
        }}
      >
        <div
          style={{
            fontSize: "16.5px",
            fontWeight: 700,
            color: BLUE_TITLE,
            letterSpacing: "0.4px",
          }}
        >
          RESULTATS DE FIN D&apos;ANNÉE
        </div>
        <div style={{ fontSize: "12px", marginTop: "1mm" }}>
          {sessionLabel(data)}
        </div>
      </div>

      {/* --- Identification de l'élève (modèle : 2 colonnes) --- */}
      <div
        style={{
          ...B,
          borderWidth: "1.8px",
          padding: "1.8mm 2.5mm",
          display: "flex",
          flexDirection: "column",
          gap: "1.1mm",
          marginBottom: "2mm",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "2mm" }}>
          <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
            Élève :{" "}
            <span style={{ color: isFille ? FILLE_RED : undefined }}>
              {row.full_name}
            </span>
          </span>
          <span style={{ whiteSpace: "nowrap" }}>
            Matricule : <b>{row.matricule}</b>
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>
            Classe : <b>{data.class.name}</b>
          </span>
          <span>
            Effectif : <b>{effectif}</b>
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>
            Sexe : <b>{row.gender}</b>
          </span>
          <span>
            Année scolaire : <b>{annee}</b>
          </span>
        </div>
      </div>

      {/* --- RESULTATS DE FIN D'ANNEE (moyennes + rang) --- */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
          marginBottom: "2mm",
        }}
      >
        <tbody>
          <tr>
            <td
              colSpan={2}
              style={{
                ...B,
                borderWidth: "1.8px",
                textAlign: "center",
                fontSize: "14px",
                fontWeight: 700,
                color: BLUE_TITLE,
                padding: "1.8mm 2mm",
              }}
            >
              RESULTATS DE FIN D&apos;ANNÉE
            </td>
          </tr>
          <MoyRow
            label="Moyenne de la composition de Passage"
            value={fmtMoy(row.moyenne_passage, row.has_moyenne_passage)}
          />
          <MoyRow
            label="Moyenne des compositions Mensuelles"
            value={fmtMoy(row.moyenne_compositions, row.has_moyenne_compositions)}
          />
          <MoyRow
            label="Moyenne Annuelle"
            value={fmtMoy(row.moyenne_annuelle, row.has_moyenne_annuelle)}
            bold
          />
          <tr>
            <td
              colSpan={2}
              style={{ ...B, padding: "1.5mm 2mm", fontSize: "12px" }}
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
                textAlign: "center",
                padding: "1.6mm 2mm",
              }}
            >
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: BLUE_TITLE,
                  textDecoration: "underline",
                }}
              >
                DÉCISION DU CONSEIL DES MAÎTRES
              </span>
            </td>
          </tr>
          {decisionRows.map((d) => (
            <tr key={d.key}>
              <td
                style={{
                  ...B,
                  padding: "1.4mm 2mm",
                  fontWeight: 700,
                  fontSize: "11.2px",
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
              style={{ ...B, textAlign: "center", fontSize: "10.3px", padding: "1.1mm 2mm" }}
            >
              (Rayer les mentions inutiles)
            </td>
          </tr>
          <tr>
            <td
              colSpan={3}
              style={{ ...B, textAlign: "center", fontSize: "11.5px", padding: "1.5mm 2mm" }}
            >
              Fait à {faitA}, le <b>{todayFr()}</b>
            </td>
          </tr>
        </tbody>
      </table>

      {/* --- Signatures (noms écrits, place pour signature + cachet) --- */}
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
                padding: "1.6mm 2.5mm",
                height: "27mm",
              }}
            >
              <div
                style={{
                  fontSize: "11.5px",
                  fontWeight: 700,
                  color: BLUE_TITLE,
                  textDecoration: "underline",
                }}
              >
                Le Maître chargé du cours
              </div>
              {data.class.teacher_name ? (
                <div style={{ fontSize: "11px", fontWeight: 600, marginTop: "1.2mm" }}>
                  {data.class.teacher_name}
                </div>
              ) : null}
            </td>
            <td
              style={{
                ...B,
                borderWidth: "1.8px",
                verticalAlign: "top",
                padding: "1.6mm 2.5mm",
                height: "27mm",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "11.5px",
                  fontWeight: 700,
                  color: BLUE_TITLE,
                  textDecoration: "underline",
                }}
              >
                Le Directeur
              </div>
              {data.directeur ? (
                <div style={{ fontSize: "11px", fontWeight: 600, marginTop: "1.2mm" }}>
                  {data.directeur}
                </div>
              ) : null}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Page complète : barre d'outils + un bulletin × 2 exemplaires par élève
 *  (ordre de mérite — les rows arrivent triés par l'API). */
export function EndOfYearBulletin({
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
  const effectif = data.summary?.effectif?.total ?? data.count;

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
            Format : A4 paysage — 2 exemplaires par élève (à découper)
          </span>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90"
          >
            <Printer className="w-4 h-4" />
            Imprimer / PDF
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 rounded-md text-sm"
          >
            <X className="w-4 h-4" />
            Fermer
          </button>
        </div>
      </div>

      {/* === BULLETINS (isolement impression #bulletins-fin-annee-doc) === */}
      <div
        id="bulletins-fin-annee-doc"
        className="bg-white mx-auto shadow-lg print:shadow-none mt-3 print:mt-0"
        style={{
          width: "fit-content",
          maxWidth: "100%",
          padding: "6mm",
          fontFamily: OFFICIAL_FONT,
          color: INK,
        }}
      >
        {rows.map((row, i) => (
          <div
            key={row.student_id}
            className="bulletin-pair"
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              alignItems: "flex-start",
              gap: "5mm",
            }}
          >
            <BulletinCopy
              data={data}
              row={row}
              rang={i + 1}
              effectif={effectif}
            />
            <BulletinCopy
              data={data}
              row={row}
              rang={i + 1}
              effectif={effectif}
            />
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-10">
            Aucun élève inscrit dans ce cours.
          </p>
        )}
      </div>
    </div>
  );
}
