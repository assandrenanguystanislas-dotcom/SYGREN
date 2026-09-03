"use client";

// === PDA IEPP — Document officiel imprimable du SUIVI PLURIANNUEL ===
// Version « document officiel » de la matrice élève × évaluations :
// en-tête ministériel (bloc + République + armoiries, police Calibri/
// Carlito — même en-tête que les documents officiels reçus de l'IEPP) +
// titre normalisé « SUIVI DU PLAN D'ACTION PLURIANNUEL DE L'IEPP » +
// matrice des niveaux (E/M/D par évaluation) + TOTAUX DE COLONNE
// (ADMIS / NON ADMIS calculés — directive IEPP) + signatures. Toutes les
// données viennent de /api/pda/timeline (source unique de vérité — le
// document ne recalcule rien). Impression A4 paysage 100 % navigateur
// (isolement #pda-tl-doc, page nommée pda-timeline) : les lignes ne sont
// JAMAIS fractionnées entre deux pages (break-inside: avoid, globals.css).
//
// v3 — EMBELLISSEMENT DRAPEAU CI (inspiré des bulletins individuels) :
// bandeau du titre en VERT DRAPEAU (texte blanc), entêtes de la matrice
// sur fond vert drapeau, bordures vertes, totaux sur fond pastel vert,
// ARMOIRIES en filigrane (répétées à chaque page imprimée) + rubans
// tricolores haut/bas de chaque page.

import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";

import { pdaApi } from "@/lib/api";
import {
  canPrintDocument,
  PrintLockBadge,
  PrintLockDocumentMessage,
  usePrintRole,
} from "@/lib/print-guard";
import type { PdaTimelineResponse } from "@/lib/types";

import {
  INK,
  OFFICIAL_FONT,
  OfficialDocHeader,
} from "./official-doc";
import {
  CIArmoiriesWatermark,
  CIFlagRibbon,
  CI_GREEN,
  CI_GREEN_BG,
  CI_GREEN_TEXT,
  PRINT_COLOR_STYLE,
} from "@/components/ci-decor";

// v3 — bordures de la matrice en VERT DRAPEAU ; ligne des TOTAUX sur
// fond pastel vert drapeau (texte vert foncé, gras).
const BORDER = `1px solid ${CI_GREEN}`;
/** Fond des lignes TOTAUX (ancien gris du modèle). */
const TOTAL_BG = CI_GREEN_BG;

/** Effectif CALCULÉ au format du modèle reçu : 07, 12 — « 00 » pour un
 *  zéro calculé (l'évaluation a eu lieu, aucun admis), case vide si
 *  l'évaluation n'a pas eu lieu (aucune note). */
function fmtTlNum(n: number | undefined | null): string {
  if (n == null) return "";
  return n <= 0 ? "00" : n < 10 ? `0${n}` : `${n}`;
}

const thStyle: CSSProperties = {
  border: BORDER,
  padding: "3px 4px",
  fontSize: "9px",
  fontWeight: 700,
  textAlign: "center",
  color: "#ffffff",
  background: CI_GREEN,
  ...PRINT_COLOR_STYLE,
};

const tdStyle: CSSProperties = {
  border: BORDER,
  padding: "2px 4px",
  fontSize: "9px",
  textAlign: "center",
  color: INK,
};

const labelTdStyle: CSSProperties = {
  ...tdStyle,
  textAlign: "left",
  fontWeight: 600,
};

/** Symbole de maîtrise en encre pour la version officielle imprimée. */
function DocCell({ present, marks }: { present: boolean; marks: [string, boolean][] }) {
  if (!present) return <span style={{ fontSize: "8px", color: "#6b7280" }}>abs</span>;
  return (
    <div className="flex items-center justify-center gap-1 tabular-nums">
      {marks.map(([sym, ok], i) =>
        sym === "–" ? (
          <span key={i} style={{ fontSize: "9px", color: "#6b7280" }}>
            –
          </span>
        ) : (
          <span key={i} style={{ fontSize: "9px", fontWeight: 700, color: INK }}>
            {ok ? "✓" : "✕"}
          </span>
        ),
      )}
    </div>
  );
}

export function PdaTimelineDocument({
  classId,
  year,
  onClose,
}: {
  classId: string;
  year: number;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pda-timeline", classId, year],
    queryFn: () => pdaApi.getTimeline(classId, year),
  });

  // Task 23 — verrou d'impression : consultation à l'écran ouverte aux
  // rôles autorisés par le backend, mais la zone « Imprimer / PDF » est
  // GRISÉE (l'impression reste réservée à l'Admin IEP et au Super Admin).
  const printRole = usePrintRole();
  const canPrint = canPrintDocument(printRole, false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Préparation du document…
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <p className="text-sm text-destructive mb-3">
            {(error as Error)?.message ?? "Document indisponible"}
          </p>
          <button onClick={onClose} className="px-3 py-1.5 bg-gray-200 rounded-md text-sm">
            Retour
          </button>
        </div>
      </div>
    );
  }

  const tl: PdaTimelineResponse = data;
  const evaluations = tl.evaluations ?? [];
  const students = tl.students ?? [];
  const subjects = tl.subjects ?? [];
  const iep = tl.iep;
  const schoolName = tl.school?.name || "…………";

  // Totaux de colonne (API) : lignes ADMIS / NON ADMIS de la matrice —
  // la dernière colonne porte les totaux sur toutes les évaluations.
  const totalAdmis = evaluations.reduce((acc, e) => acc + (e.admis ?? 0), 0);
  const totalNonAdmis = evaluations.reduce(
    (acc, e) => acc + (e.non_admis ?? 0),
    0,
  );
  const totalPresents = evaluations.reduce(
    (acc, e) => acc + (e.presents ?? 0),
    0,
  );
  const summaryRow: CSSProperties = {
    ...tdStyle,
    fontWeight: 700,
    background: TOTAL_BG,
    color: CI_GREEN_TEXT,
  };
  const summaryLabel: CSSProperties = {
    ...summaryRow,
    whiteSpace: "nowrap",
  };

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white print:min-h-0">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Plan d&apos;Action IEPP — Suivi pluriannuel · {tl.class.name} · {tl.year}
        </h3>
        <div className="flex items-center gap-2">
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

      {/* === DOCUMENT OFFICIEL (isolement impression #pda-tl-doc) === */}
      {!canPrint && <PrintLockDocumentMessage />}
      <div
        id="pda-tl-doc"
        className={`bg-white mx-auto shadow-lg print:shadow-none ${canPrint ? "" : "print-locked"}`}
        style={{
          width: "100%",
          maxWidth: "297mm", // A4 paysage — la matrice est large
          padding: "10mm 8mm",
          fontFamily: OFFICIAL_FONT,
          color: INK,
          overflowX: "auto",
          position: "relative", // filigrane armoiries DANS LE FOND
        }}
      >
        {/* v3 — ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane (répétées sur
            chaque page imprimée) + rubans tricolores haut/bas de chaque
            page (position fixed — zéro impact sur la mise en page) */}
        <CIArmoiriesWatermark fixed />
        <div style={{ position: "fixed", top: 0, left: 0, right: 0 }}>
          <CIFlagRibbon height="2.4mm" bordered={false} />
        </div>
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0 }}>
          <CIFlagRibbon height="2.4mm" bordered={false} />
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
        {/* --- En-tête institutionnel (identique aux documents officiels reçus) --- */}
        <OfficialDocHeader iep={iep} variant="plan" size="sm" />

        {/* --- Bandeau du titre VERT DRAPEAU (texte blanc — inspiration
            bulletins individuels) + sous-titre souligné --- */}
        <div style={{ textAlign: "center", margin: "4px 0 10px" }}>
          <div
            style={{
              display: "inline-block",
              background: CI_GREEN,
              color: "#ffffff",
              padding: "6px 24px",
              fontSize: "13.5px",
              fontWeight: 700,
              lineHeight: 1.45,
              ...PRINT_COLOR_STYLE,
            }}
          >
            SUIVI DU PLAN D&apos;ACTION PLURIANNUEL DE L&apos;IEPP
          </div>
          <div
            style={{
              fontSize: "12.5px",
              fontWeight: 700,
              textDecoration: "underline",
              marginTop: "8px",
              color: CI_GREEN_TEXT,
            }}
          >
            SUIVI PLURIANNUEL DES NIVEAUX — CLASSE {tl.class.name.toUpperCase()} —
            ANNEE {tl.year}
          </div>
        </div>

        {/* --- École / Classe / Effectif (labels gras, modèle reçu) --- */}
        <div style={{ fontSize: "11.5px", marginBottom: "8px" }}>
          <span style={{ fontWeight: 700 }}>ECOLE : {schoolName}</span>
          <span style={{ marginLeft: "32px", fontWeight: 700 }}>
            CLASSE : {tl.class.name}
          </span>
          <span style={{ marginLeft: "32px", fontWeight: 400 }}>
            {students.length} élève(s) · {evaluations.length} évaluation(s)
          </span>
        </div>

        {/* --- Matrice élève × évaluations --- */}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "24px" }}>#</th>
              <th style={{ ...thStyle, border: "none", textAlign: "left" }}>ÉLÈVE</th>
              {evaluations.map((e) => (
                <th
                  key={e.id}
                  style={{ ...thStyle, border: "none", width: "40px" }}
                  title={`${e.label} — seuil ${e.threshold} % du barème`}
                >
                  {e.short_label}
                </th>
              ))}
              <th style={{ ...thStyle, border: "none", width: "52px" }}>% ADMIS</th>
            </tr>
            <tr>
              <th style={{ ...thStyle, border: "none" }} />
              <th style={{ ...thStyle, border: "none", textAlign: "left" }}>
                (E = Exploitation · M = Mathématiques · D = Dictée)
              </th>
              {evaluations.map((e) => (
                <th key={`s-${e.id}`} style={{ ...thStyle, border: "none" }}>
                  E M D
                </th>
              ))}
              <th style={{ ...thStyle, border: "none" }} />
            </tr>
          </thead>
          <tbody>
            {students.map((st, idx) => (
              <tr key={st.student_id}>
                <td style={tdStyle}>{idx + 1}</td>
                <td style={labelTdStyle}>
                  {st.last_name} {st.first_name}{" "}
                  <span style={{ fontWeight: 400, fontSize: "8px" }}>
                    ({st.matricule} · {st.gender === "F" ? "Fille" : "Garçon"})
                  </span>
                </td>
                {evaluations.map((e) => {
                  const cell = st.cells[e.id];
                  const marks: [string, boolean][] = [0, 1, 2].map((i) => {
                    if (!cell || !cell.present) return ["abs", false] as [string, boolean];
                    if (cell.notes[i] == null) return ["–", false] as [string, boolean];
                    return [cell.admis[i] ? "✓" : "✕", cell.admis[i]] as [string, boolean];
                  });
                  return (
                    <td key={e.id} style={tdStyle}>
                      <DocCell present={!!cell?.present} marks={marks} />
                    </td>
                  );
                })}
                <td style={tdStyle}>
                  {st.pct_admis > 0 ? `${st.pct_admis} %` : "—"}
                </td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={evaluations.length + 3}>
                  Aucun élève dans cette classe.
                </td>
              </tr>
            )}
          </tbody>
          {/* === Totaux de colonne (directive IEPP : les admis et les
              non admis de chaque colonne sont calculés) — tbody FRÈRE du
              tbody principal (un tbody ne peut pas s'y imbriquer) ; les
              DEUX lignes forment un groupe insécable : elles restent
              toujours ensemble sur la même page. === */}
          {evaluations.length > 0 && (
            <tbody
              style={{
                breakInside: "avoid",
                pageBreakInside: "avoid",
              }}
            >
              <tr>
                <td style={summaryLabel} colSpan={2}>
                  ADMIS
                </td>
                {evaluations.map((e) => (
                  <td key={`a-${e.id}`} style={summaryRow} title={`${e.label} — ${e.admis} admis / ${e.presents} présents`}>
                    {(e.presents ?? 0) > 0 ? fmtTlNum(e.admis) : ""}
                  </td>
                ))}
                <td style={summaryRow}>
                  {totalPresents > 0 ? fmtTlNum(totalAdmis) : ""}
                </td>
              </tr>
              <tr>
                <td style={summaryLabel} colSpan={2}>
                  NON ADMIS
                </td>
                {evaluations.map((e) => (
                  <td key={`na-${e.id}`} style={summaryRow} title={`${e.label} — ${e.non_admis} non admis / ${e.presents} présents`}>
                    {(e.presents ?? 0) > 0 ? fmtTlNum(e.non_admis) : ""}
                  </td>
                ))}
                <td style={summaryRow}>
                  {totalPresents > 0 ? fmtTlNum(totalNonAdmis) : ""}
                </td>
              </tr>
            </tbody>
          )}
        </table>

        {/* --- Légende compacte --- */}
        <p style={{ fontSize: "8px", marginTop: "8px", lineHeight: 1.5, color: INK }}>
          <span style={{ fontWeight: 700 }}>✓</span> Admis (note ≥ seuil) ·{" "}
          <span style={{ fontWeight: 700 }}>✕</span> Non admis · – note absente · abs
          absent. ADMIS = élèves présents atteignant le seuil dans les 3 matières
          ; NON ADMIS = présents n'y parvenant pas ; % Admis = admis / présents
          de la colonne. C = composition mensuelle (notes du module Notes) · EB =
          examen blanc. Seuil de maîtrise : {evaluations[0]?.threshold ?? 50} % du barème
          de chaque évaluation. Matières :{" "}
          {subjects.map((s, i) => (
            <span key={s.key}>
              {i > 0 ? " · " : ""}
              <span style={{ fontWeight: 700 }}>{s.label}</span>{" "}
              {s.matched
                ? `(compositions /${s.max_composition}, blancs /${s.max_blanc})`
                : "(non notée dans les compositions)"}
            </span>
          ))}
          .
        </p>

        {/* --- Signatures + nom de l'inspecteur (patron de la fiche reçue) --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: "12px",
            marginTop: "20px",
          }}
        >
          <span style={{ textDecoration: "underline" }}>Le Directeur</span>
          <div style={{ textAlign: "center" }}>
            <span style={{ textDecoration: "underline", color: CI_GREEN_TEXT }}>L&apos;Inspecteur</span>
            {iep?.inspector_name ? (
              <div
                style={{
                  fontSize: "11px",
                  marginTop: "24px",
                }}
              >
                {iep.inspector_name.toUpperCase()}
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground py-4 print:hidden">
        Le suivi pluriannuel se lit colonne par colonne : le niveau d&apos;étude de
        chaque élève dans les 3 matières désignées, évaluation après évaluation.
        Les lignes ADMIS / NON ADMIS de chaque colonne sont calculées ; à
        l&apos;impression, les lignes ne sont jamais fractionnées entre deux pages.
      </p>
    </div>
  );
}
