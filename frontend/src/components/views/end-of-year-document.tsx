"use client";

// === Document officiel « RESULTATS DE FIN D'ANNEE » (modèle IEPP) ===
// Reproduction FIDÈLE de l'architecture du document reçu (A4 PORTRAIT,
// 2 pages — 72 lignes numérotées comme le modèle) :
//   - En-tête institutionnel : bloc ministériel (« Ministère de l'Education
//     Nationale / de l'Alphabétisation et de l'Enseignement Technique »,
//     Direction Régionale, Inspection Préscolaire et Primaire, BP/Tél,
//     Courriel) + « République de Côte d'Ivoire / Union-Discipline-Travail »
//     et armoiries ;
//   - Boîte du titre arrondie « RESULTATS DE FIN D'ANNEE » (police à
//     empattements, comme le modèle) ;
//   - Lignes « ECOLE : … » (gauche) et « Cours : … / Date : … » (droite,
//     date du jour au format jj/mm/aaaa) ;
//   - Tableau du modèle : N° | Nom et Prénoms | Âge (déduit de l'année de
//     naissance) | Scolarité dans le cours | Scolarité totale | Moyenne des
//     compositions | Moyenne de la composition de passage | Moyenne annuelle
//     | Décision du Conseil des Maîtres (sous-colonnes Admis | Red | Abd —
//     croix « X » selon la décision A / R / ABD de l'élève) ;
//   - Lignes numérotées 1 → 72 (élèves d'abord, lignes vierges ensuite),
//     rangées PAR ORDRE DE MÉRITE (moyenne annuelle décroissante — le N°
//     vaut rang) ; noms des FILLES en rouge ;
//   - Tableau récapitulatif du bas : Effectif / Admis / Redoublants
//     (CALCULÉS depuis les décisions) et Exclus / Abandons (saisies
//     manuelles de la classe) × Garçons / Filles / Total ;
//   - « Fait à …… Le ……/……/… » + signatures Le Directeur / Le tenant du
//     cours / Visa de l'Inspecteur (nom de l'inspecteur de l'IEP).
//
// Données : /api/reports/end-of-year (source unique — le document ne
// recalcule rien). Impression 100 % navigateur A4 portrait (route dédiée
// /resultats-fin-annee-doc — zéro PDF serveur, discipline du projet).

import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";
import type { CSSProperties } from "react";

import { reportsApi } from "@/lib/api";
import type { EndOfYearRow, EndOfYearSummaryRow } from "@/lib/types";

import { INK, OFFICIAL_FONT, THIN } from "./official-doc";

/** Compteur du tableau récapitulatif : 07, 11, 1238 — « 00 » pour un zéro
 *  calculé/saisi, case vide si non renseigné (comme le modèle reçu). */
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "";
  return n < 10 ? `0${n}` : `${n}`;
}

/** Moyenne : virgule française, 2 décimales — case vide si absente. */
function fmtMoy(v: number | null | undefined, has: boolean | undefined): string {
  if (!has || v == null) return "";
  return v.toFixed(2).replace(".", ",");
}

/** Date du jour au format du modèle : jj/mm/aaaa (rendu identique serveur/
 *  client au sein d'une même requête — pas de décalage d'hydratation). */
function todayFr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const th: CSSProperties = {
  border: THIN,
  padding: "2px 3px",
  fontSize: "9px",
  lineHeight: 1.2,
  fontWeight: 700, // entêtes en gras comme le modèle reçu
  textAlign: "center",
  verticalAlign: "middle",
  color: INK,
};

const td: CSSProperties = {
  border: THIN,
  padding: "1px 3px",
  fontSize: "9px",
  lineHeight: 1.2,
  textAlign: "center",
  verticalAlign: "middle",
  color: INK,
  height: "15px",
};

const tdLeft: CSSProperties = { ...td, textAlign: "left" };

/** Largeurs des colonnes du tableau principal (colgroup — PAS de nœuds
 *  texte entre les <col>, erreur d'hydratation React sinon). */
const COL_WIDTHS = [
  "4%", // N°
  "24%", // Nom et Prénoms
  "5.5%", // Âge
  "8%", // Scolarité dans le cours
  "7.5%", // Scolarité totale
  "9.5%", // Moyenne des compositions
  "10.5%", // Moyenne de la composition de passage
  "8.5%", // Moyenne annuelle
  "7.5%", // Décision — Admis
  "7.5%", // Décision — Red
  "7.5%", // Décision — Abd
];

/** Rouge des noms de FILLES (convention des tableaux de classement —
 *  rouge sombre, lisible et fidèle à l'impression). */
const FILLE_RED = "#c00000";

/** Nombre total de lignes numérotées du modèle reçu (1 → 72). */
const TOTAL_ROWS = 72;

export function EndOfYearDocument({
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
  const summary = data.summary;
  const iep = data.iep;
  // Lignes numérotées du modèle : les élèves d'abord, les lignes vierges
  // ensuite (le modèle reçu garde ses 72 lignes même si le cours est petit).
  const numbered: Array<EndOfYearRow | null> = [
    ...rows,
    ...Array.from({ length: Math.max(0, TOTAL_ROWS - rows.length) }, () => null),
  ];

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Résultats de fin d&apos;année — {data.school.name} · {data.class.name}{" "}
          · {data.count} élève(s) · Année {data.year}
        </h3>
        <div className="flex items-center gap-2">
          {/* Format d'impression verrouillé par @page (portrait) — rappel
              visible pour l'utilisateur (masqué à l'impression) */}
          <span className="hidden sm:inline text-xs text-muted-foreground mr-1">
            Format : A4 portrait
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

      {/* === DOCUMENT OFFICIEL (isolement impression #resultats-fin-annee-doc) === */}
      <div
        id="resultats-fin-annee-doc"
        className="bg-white mx-auto shadow-lg print:shadow-none mt-3"
        style={{
          width: "100%",
          maxWidth: "210mm", // A4 portrait
          padding: "8mm 9mm",
          fontFamily: OFFICIAL_FONT,
          color: INK,
          overflowX: "auto",
        }}
      >
        {/* --- En-tête institutionnel (modèle reçu) --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "8px",
          }}
        >
          <div style={{ fontSize: "11.5px", color: INK, lineHeight: 1.35 }}>
            <div>Ministère de l&apos;Education Nationale</div>
            <div>de l&apos;Alphabétisation et de l&apos;Enseignement Technique</div>
            <div style={{ fontWeight: 600, marginTop: "2px" }}>
              Direction Régionale de {(iep?.region || "…………").toUpperCase()}
            </div>
            <div style={{ fontWeight: 700, marginTop: "2px" }}>
              Inspection de l&apos;Enseignement
            </div>
            <div style={{ fontWeight: 700 }}>
              Préscolaire et Primaire de {(iep?.name || "…………").toUpperCase()}
            </div>
            <div style={{ marginTop: "2px" }}>
              BP : {iep?.bp || "……"} / Tel : {iep?.inspector_phone || "…………"}
            </div>
            <div>
              Courriel :{" "}
              <span style={{ color: "#0563C1", textDecoration: "underline" }}>
                {iep?.inspector_email || "…………"}
              </span>
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "12.5px", color: INK }}>
              République de Côte d&apos;Ivoire
            </div>
            <div style={{ fontSize: "11.5px", color: INK, padding: "1px 0" }}>
              Union-Discipline-Travail
            </div>
            <img
              src="/ci-coat-of-arms.png"
              alt="Armoiries de la République de Côte d'Ivoire"
              style={{ height: "52px", margin: "2px auto 0", display: "block" }}
            />
          </div>
        </div>

        {/* --- Boîte du titre (bord arrondi, police à empattements — modèle) --- */}
        <div style={{ textAlign: "center", margin: "4px 0 8px" }}>
          <span
            style={{
              display: "inline-block",
              border: "2.2px solid #000000",
              borderRadius: "14px",
              padding: "6px 34px 7px",
              fontFamily:
                '"Cambria", "Caladea", Georgia, "Times New Roman", serif',
              fontSize: "19px",
              fontWeight: 700,
              letterSpacing: "1.5px",
              lineHeight: 1.25,
              color: INK,
              boxShadow: "2.5px 2.5px 0 #bfbfbf",
              textAlign: "center",
            }}
          >
            RESULTATS DE FIN D&apos;ANNEE
          </span>
        </div>

        {/* --- Lignes École (gauche) / Cours + Date (droite) --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: "11.5px",
            margin: "0 2px 4px",
            color: INK,
          }}
        >
          <span>
            <b>ECOLE</b> : <b>{data.school.name}</b>
          </span>
          <span style={{ textAlign: "right", lineHeight: 1.5 }}>
            <div>
              Cours: <b>{data.class.name}</b>
            </div>
            <div>
              Date: <b>{todayFr()}</b>
            </div>
          </span>
        </div>

        {/* --- Tableau principal (modèle : 11 colonnes) --- */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
            color: INK,
          }}
        >
          <colgroup>
            {COL_WIDTHS.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={th} rowSpan={2}>
                N°
              </th>
              <th style={th} rowSpan={2}>
                Nom et Prénoms
              </th>
              <th style={th} rowSpan={2}>
                Âge
              </th>
              <th style={th} rowSpan={2}>
                Scolarité dans le cours
              </th>
              <th style={th} rowSpan={2}>
                Scolarité totale
              </th>
              <th style={th} rowSpan={2}>
                Moyenne des compositions
              </th>
              <th style={th} rowSpan={2}>
                Moyenne de la composition de passage
              </th>
              <th style={th} rowSpan={2}>
                Moyenne annuelle
              </th>
              <th style={th} colSpan={3}>
                Décision du Conseil des Maîtres
              </th>
            </tr>
            <tr>
              <th style={th}>Admis</th>
              <th style={th}>Red</th>
              <th style={th}>Abd</th>
            </tr>
          </thead>
          <tbody>
            {numbered.map((row, i) => (
              <EndOfYearTableRow key={row?.student_id ?? `empty-${i}`} row={row} n={i + 1} />
            ))}
          </tbody>
        </table>

        {/* --- Tableau récapitulatif du bas (modèle) --- */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
          <table
            style={{
              borderCollapse: "collapse",
              tableLayout: "fixed",
              width: "58%",
              color: INK,
            }}
          >
            <colgroup>
              <col style={{ width: "40%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...th, border: "none" }}>&nbsp;</th>
                <th style={th}>Garçons</th>
                <th style={th}>Filles</th>
                <th style={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              <SummaryRow label="Effectif" row={summary.effectif} />
              <SummaryRow label="Admis" row={summary.admis} />
              <SummaryRow label="Redoublants" row={summary.redoublants} />
              <SummaryRow label="Exclus" row={summary.exclus} />
              <SummaryRow label="Abandons" row={summary.abandons} />
            </tbody>
          </table>
        </div>

        {/* --- Fait à / Le (modèle) --- */}
        <div
          style={{
            textAlign: "right",
            fontSize: "12px",
            margin: "12px 4% 0 0",
            color: INK,
          }}
        >
          Fait à ……………………. Le ……..…/…….……/{data.year}
        </div>

        {/* --- Signatures (modèle) --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "12.5px",
            fontWeight: 700,
            marginTop: "18px",
            padding: "0 2%",
            color: INK,
          }}
        >
          <div>Le Directeur</div>
          <div style={{ textAlign: "center" }}>
            <div>Le tenant du cours</div>
            {data.class.teacher_name ? (
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 400,
                  fontStyle: "italic",
                  marginTop: "14px",
                }}
              >
                {data.class.teacher_name}
              </div>
            ) : null}
          </div>
          <div style={{ textAlign: "right" }}>
            <div>Visa de l&apos;Inspecteur</div>
            {data.inspecteur ? (
              <div style={{ fontSize: "11px", fontWeight: 400, marginTop: "14px" }}>
                {data.inspecteur}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Une ligne élève (ou vierge) du tableau principal. La décision du conseil
 *  des maîtres marque une croix « X » dans UNE des sous-colonnes
 *  Admis / Red / Abd (comme sur le document papier). */
function EndOfYearTableRow({ row, n }: { row: EndOfYearRow | null; n: number }) {
  if (!row) {
    return (
      <tr>
        <td style={td}>{n}</td>
        <td style={tdLeft}>&nbsp;</td>
        {Array.from({ length: 9 }, (_, k) => (
          <td key={k} style={td}>
            &nbsp;
          </td>
        ))}
      </tr>
    );
  }
  const decision = row.decision_conseil;
  return (
    <tr style={{ pageBreakInside: "avoid" }}>
      <td style={td}>{n}</td>
      <td
        style={{
          ...tdLeft,
          fontWeight: 600,
          // Noms des FILLES en rouge (demande utilisateur — les garçons
          // restent en encre noire).
          color: row.gender === "F" ? FILLE_RED : undefined,
        }}
      >
        {row.full_name}
      </td>
      <td style={td}>{row.age ?? ""}</td>
      <td style={td}>{row.scolarite_cours ?? ""}</td>
      <td style={td}>{row.scolarite_totale ?? ""}</td>
      <td style={td}>{fmtMoy(row.moyenne_compositions, row.has_moyenne_compositions)}</td>
      <td style={td}>{fmtMoy(row.moyenne_passage, row.has_moyenne_passage)}</td>
      <td style={{ ...td, fontWeight: 700 }}>
        {fmtMoy(row.moyenne_annuelle, row.has_moyenne_annuelle)}
      </td>
      <td style={td}>{decision === "A" ? "X" : ""}</td>
      <td style={td}>{decision === "R" ? "X" : ""}</td>
      <td style={td}>{decision === "ABD" ? "X" : ""}</td>
    </tr>
  );
}

/** Une ligne du tableau récapitulatif (G / F / T). */
function SummaryRow({ label, row }: { label: string; row: EndOfYearSummaryRow }) {
  return (
    <tr>
      <td style={{ ...td, fontWeight: 700 }}>{label}</td>
      <td style={td}>{fmtNum(row.garcons)}</td>
      <td style={td}>{fmtNum(row.filles)}</td>
      <td style={{ ...td, fontWeight: 700 }}>{fmtNum(row.total)}</td>
    </tr>
  );
}
