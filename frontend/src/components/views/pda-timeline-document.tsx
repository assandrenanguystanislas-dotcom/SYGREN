"use client";

// === PDA IEPP — Document officiel imprimable du SUIVI PLURIANNUEL ===
// Version « document officiel » de la matrice élève × évaluations :
// en-tête ministériel + titre normalisé « SUIVI DU PLAN D'ACTION
// PLURIANNUEL DE L'IEPP » + matrice des niveaux (E/M/D par évaluation)
// + signatures. Toutes les données viennent de /api/pda/timeline
// (source unique de vérité — le document ne recalcule rien).
// Impression A4 paysage 100 % navigateur (isolement #pda-tl-doc,
// page nommée pda-timeline).

import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";

import { pdaApi } from "@/lib/api";
import type { PdaTimelineResponse } from "@/lib/types";

const INK = "#1f2937"; // gris encre — cohérent avec les documents officiels
const BORDER = "1px solid #374151";

const thStyle: CSSProperties = {
  border: BORDER,
  padding: "3px 4px",
  fontSize: "9px",
  fontWeight: 700,
  textAlign: "center",
  color: INK,
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

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Plan d&apos;Action IEPP — Suivi pluriannuel · {tl.class.name} · {tl.year}
        </h3>
        <div className="flex items-center gap-2">
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

      {/* === DOCUMENT OFFICIEL (isolement impression #pda-tl-doc) === */}
      <div
        id="pda-tl-doc"
        className="bg-white mx-auto shadow-lg print:shadow-none"
        style={{
          width: "100%",
          maxWidth: "297mm", // A4 paysage — la matrice est large
          padding: "10mm 8mm",
          fontFamily: "Helvetica, Arial, sans-serif",
          color: INK,
          overflowX: "auto",
        }}
      >
        {/* --- En-tête institutionnel (identique au document officiel par évaluation) --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "10px",
          }}
        >
          <div style={{ fontSize: "9px", fontWeight: 700, lineHeight: 1.5 }}>
            <div>MINISTERE DE L&apos;EDUCATION NATIONALE ET</div>
            <div>DE L&apos;ALPHABETISATION</div>
            <div>
              DIRECTION REGIONALE DE{" "}
              {(iep?.region || iep?.name || "…………").toUpperCase()}
            </div>
            <div>INSPECTION DE L&apos;ENSEIGNEMENT</div>
            <div>PRESCOLAIRE ET PRIMAIRE DE {(iep?.name || "…………").toUpperCase()}</div>
            <div>
              BP {iep?.bp || "……"} · Tel {iep?.inspector_phone || "…………"}
            </div>
            <div>Courriel : {iep?.inspector_email || "…………"}</div>
          </div>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 700,
              textAlign: "right",
              lineHeight: 1.5,
            }}
          >
            <div>REPUBLIQUE DE CÔTE D&apos;IVOIRE</div>
            <div
              style={{
                fontStyle: "italic",
                fontWeight: 400,
                fontSize: "8px",
                marginTop: "18px",
              }}
            >
              Union-Discipline-Travail
            </div>
          </div>
        </div>

        {/* --- Titre encadré --- */}
        <div
          style={{
            border: `2px solid ${INK}`,
            padding: "8px",
            textAlign: "center",
            marginBottom: "8px",
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 800, letterSpacing: "0.3px" }}>
            SUIVI DU PLAN D&apos;ACTION PLURIANNUEL DE L&apos;IEPP
          </div>
          <div
            style={{
              fontSize: "12px",
              fontWeight: 800,
              textDecoration: "underline",
              marginTop: "6px",
            }}
          >
            SUIVI PLURIANNUEL DES NIVEAUX — CLASSE {tl.class.name.toUpperCase()} —
            ANNEE {tl.year}
          </div>
        </div>

        {/* --- École / Classe / Effectif --- */}
        <div style={{ fontSize: "10px", fontWeight: 700, marginBottom: "8px" }}>
          <span>ECOLE : {schoolName}</span>
          <span style={{ marginLeft: "32px" }}>CLASSE : {tl.class.name}</span>
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
        </table>

        {/* --- Légende compacte --- */}
        <p style={{ fontSize: "8px", marginTop: "8px", lineHeight: 1.5, color: INK }}>
          <span style={{ fontWeight: 700 }}>✓</span> Admis (note ≥ seuil) ·{" "}
          <span style={{ fontWeight: 700 }}>✕</span> Non admis · – note absente · abs
          absent. C = composition mensuelle (notes du module Notes) · EB = examen
          blanc. Seuil de maîtrise : {evaluations[0]?.threshold ?? 50} % du barème
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

        {/* --- Signatures --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "10px",
            fontWeight: 700,
            textDecoration: "underline",
            marginTop: "20px",
          }}
        >
          <span>Le Directeur</span>
          <span>L&apos;Inspecteur</span>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground py-4 print:hidden">
        Le suivi pluriannuel se lit colonne par colonne : le niveau d&apos;étude de
        chaque élève dans les 3 matières désignées, évaluation après évaluation.
      </p>
    </div>
  );
}
