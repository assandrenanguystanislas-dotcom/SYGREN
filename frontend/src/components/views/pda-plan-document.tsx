"use client";

// === PDA IEPP — Document réseau « PLAN D'ACTION PLURIANNUEL DE L'IEPP » ===
// Reproduction fidèle de l'architecture des documents officiels reçus de
// l'IEPP (sections A + B) : les écoles y sont GROUPÉES PAR CENTRE
// D'EXAMEN, ligne TOTAL de l'inspection en bas.
//
//   Section A — maîtrise CM2 par discipline (Exploitation de texte,
//   Mathématiques) : Total | Filles | Présents | % Admis | Admis (Filles) |
//   % Admis (Filles) par école.
//   Section B — « Accroître les acquis scolaires… » : difficultés
//   d'apprentissage, cours de mise à niveau, mécanismes de remédiation
//   (Total | Filles) par école.
//
// Toutes les données viennent de /api/pda/plan-action (source unique de
// vérité — le document ne recalcule rien). Impression 100 % navigateur
// A4 paysage (isolement #pda-plan-doc, page nommée pda-plan).
//
// Écart documenté vs modèle papier : les formules Excel de l'original
// divisaient les % par les INSCRITS (ex : « % Admis » = présents/inscrits,
// valeurs > 100 % possibles). SYGREN applique la définition correcte,
// alignée sur le reste du système : % Admis = Admis/Présents,
// % Admis (Filles) = Admises/Filles présentes.

import { Fragment, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";

import { pdaApi } from "@/lib/api";
import { monthLabel } from "@/lib/session-utils";
import type {
  PdaPlanCenterGroup,
  PdaPlanSchoolRow,
} from "@/lib/types";

const INK = "#1f2937"; // gris encre — cohérent avec les documents officiels
const BORDER = "1px solid #374151";
const TOTAL_BG = "#e5e7eb"; // fond gris de la ligne TOTAL (modèle reçu)

const thStyle: CSSProperties = {
  border: BORDER,
  padding: "2px 3px",
  fontSize: "8.5px",
  fontWeight: 700,
  textAlign: "center",
  color: INK,
};

const tdStyle: CSSProperties = {
  border: BORDER,
  padding: "2px 3px",
  fontSize: "8.5px",
  textAlign: "center",
  color: INK,
};

const schoolTdStyle: CSSProperties = {
  ...tdStyle,
  textAlign: "left",
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const centerTdStyle: CSSProperties = {
  ...tdStyle,
  fontWeight: 800,
  fontSize: "9px",
  whiteSpace: "nowrap",
};

/** Pourcentages à la française (89.3 → « 89,3 », 100 → « 100 »). */
function fmtPct(n: number): string {
  const s = n.toFixed(1).replace(".", ",");
  return s.endsWith(",0") ? s.slice(0, -2) : s;
}

/** Cellule d'effectif — vide si aucune donnée (modèle reçu : cases vides). */
function NumCell({ n }: { n: number | undefined }) {
  return <td style={tdStyle}>{n ? n : ""}</td>;
}

/** Cellule de pourcentage — vide si aucune donnée. */
function PctCell({ n }: { n: number | undefined }) {
  return <td style={tdStyle}>{n ? `${fmtPct(n)}%` : ""}</td>;
}

/** Les 6 colonnes d'une discipline (section A), dans l'ordre du modèle :
 *  Total (inscrits) | Filles (inscrites) | Présents | % Admis |
 *  Admis (Filles) | % Admis (Filles) — comme le document reçu. */
function DisciplineCells({
  row,
  discipline,
}: {
  row: PdaPlanSchoolRow;
  discipline: "exploitation" | "math";
}) {
  const d = row.disciplines?.[discipline];
  return (
    <>
      <NumCell n={row.inscrits?.total} />
      <NumCell n={row.inscrits?.filles} />
      <NumCell n={d?.presents?.total} />
      <PctCell n={d?.pct_admis} />
      <NumCell n={d?.admis?.filles} />
      <PctCell n={d?.pct_admis_filles} />
    </>
  );
}

export function PdaPlanDocument({
  year,
  number,
  kind,
  onClose,
}: {
  year: number;
  number: number;
  kind: "blanc" | "composition";
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pda-plan-action", year, number, kind],
    queryFn: () => pdaApi.getPlanAction({ year, number, kind }),
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

  const plan = data;
  const centers: PdaPlanCenterGroup[] = plan.centers ?? [];
  const iep = plan.iep;
  const isComposition = plan.kind === "composition";

  // Titre de l'évaluation (même convention que le document par école).
  const evalTitle = isComposition
    ? `COMPOSITION N°${plan.number} — ${
        plan.session_month && plan.session_month >= 1 && plan.session_month <= 12
          ? `${monthLabel(plan.session_month).toUpperCase()} `
          : ""
      }${plan.year}`
    : `RESULTAT DE L'EXAMEN BLANC N°${plan.number}${
        plan.exam_date
          ? ` DU ${new Date(plan.exam_date).toLocaleDateString("fr-FR")}`
          : ` — ANNEE ${plan.year}`
      }`;

  const toolbarTitle = isComposition
    ? `Composition N°${plan.number} — ${plan.year}`
    : `Examen Blanc N°${plan.number}`;

  const totalSchoolCount = centers.reduce((acc, c) => acc + c.schools.length, 0);

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Plan d&apos;Action IEPP — {toolbarTitle} · {totalSchoolCount} école(s)
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

      {/* Avertissements (écran uniquement) : écoles sans évaluation suivie,
          sans classe CM2, matières non notées… */}
      {(plan.warnings ?? []).length > 0 && (
        <div className="mx-auto max-w-[297mm] mt-3 px-2 print:hidden">
          <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs p-3 space-y-1">
            <p className="font-semibold">Données incomplètes (lignes laissées vides) :</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {plan.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* === DOCUMENT OFFICIEL (isolement impression #pda-plan-doc) === */}
      <div
        id="pda-plan-doc"
        className="bg-white mx-auto shadow-lg print:shadow-none mt-3"
        style={{
          width: "100%",
          maxWidth: "297mm", // A4 paysage — le tableau réseau est large
          padding: "8mm 8mm",
          fontFamily: "Helvetica, Arial, sans-serif",
          color: INK,
          overflowX: "auto",
        }}
      >
        {/* --- En-tête institutionnel (identique aux autres documents) --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "8px",
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
            <div>
              PRESCOLAIRE ET PRIMAIRE DE {(iep?.name || "…………").toUpperCase()}
            </div>
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

        {/* --- Titre de l'évaluation + titre encadré du plan --- */}
        <div
          style={{
            border: `1.5px solid ${INK}`,
            padding: "3px 8px",
            textAlign: "center",
            display: "inline-block",
            marginBottom: "6px",
            fontSize: "11px",
            fontWeight: 700,
          }}
        >
          {evalTitle}
        </div>
        <div
          style={{
            border: `2px solid ${INK}`,
            background: "#fde047", // bandeau jaune du modèle reçu
            padding: "6px 8px",
            textAlign: "center",
            marginBottom: "6px",
          }}
        >
          <div style={{ fontSize: "14px", fontWeight: 800, letterSpacing: "0.3px" }}>
            PLAN D&apos;ACTION PLURIANNUEL DE L&apos;IEPP{" "}
            {(iep?.name || "…………").toUpperCase()}
          </div>
        </div>

        {/* ================= SECTION A ================= */}
        <p style={{ fontSize: "9px", fontWeight: 600, margin: "6px 0 4px" }}>
          A) NOMBRE D&apos;ÉLÈVES DU CM2 AYANT ATTEINT LE SEUIL SUFFISANT DE
          MAÎTRISE EN LECTURE (EXPLOITATION DE TEXTE), MATHÉMATIQUES.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            {/* Ligne 1 : CENTRES | ECOLES | DISCIPLINES (2 × 6 colonnes).
                rowSpan=3 : l'en-tête comporte 3 lignes (titre + disciplines
                + sous-entêtes). */}
            <tr>
              <th style={{ ...thStyle, width: "70px" }} rowSpan={3}>
                CENTRES
                <br />
                D&apos;EXAMENS
              </th>
              <th style={{ ...thStyle, width: "110px" }} rowSpan={3}>
                ECOLES
              </th>
              <th colSpan={12} style={thStyle}>
                DISCIPLINES
              </th>
            </tr>
            <tr>
              <th colSpan={6} style={thStyle}>EXPLOITATION DE TEXTE</th>
              <th colSpan={6} style={thStyle}>MATHÉMATIQUES</th>
            </tr>
            {/* Ligne 3 : sous-entêtes — Total | Filles | Présents | % Admis |
                Admis (Filles) | % Admis (Filles), par discipline. NB : dans le
                modèle reçu Total/Filles = effectifs INSCRITS (répétés par
                discipline). */}
            <tr>
              {["exploitation", "math"].map((d) => (
                <Fragment key={d}>
                  <th style={thStyle}>Total</th>
                  <th style={thStyle}>Filles</th>
                  <th style={thStyle}>Présents</th>
                  <th style={thStyle}>% Admis</th>
                  <th style={thStyle}>Admis (Filles)</th>
                  <th style={thStyle}>% Admis (Filles)</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {centers.map((c) => (
              <Fragment key={c.id || "unassigned-a"}>
                {c.schools.map((s) => (
                  <tr key={s.school_id}>
                    {s === c.schools[0] && (
                      <td
                        style={centerTdStyle}
                        rowSpan={c.schools.length + 1}
                        title={c.name}
                      >
                        {c.name}
                      </td>
                    )}
                    <td style={schoolTdStyle}>{s.school_name}</td>
                    <DisciplineCells row={s} discipline="exploitation" />
                    <DisciplineCells row={s} discipline="math" />
                  </tr>
                ))}
                {/* Sous-total du centre — lisibilité de l'inspection (la
                    cellule centre couvre aussi cette ligne : rowSpan+1) */}
                <tr>
                  <td style={{ ...schoolTdStyle, fontStyle: "italic" }}>
                    Total {c.name}
                  </td>
                  <PlanRowCells row={c.totals} />
                </tr>
              </Fragment>
            ))}
            {/* TOTAL général de l'IEPP (fond gris — modèle reçu) */}
            <tr style={{ background: TOTAL_BG }}>
              <td style={{ ...schoolTdStyle, textAlign: "center" }} colSpan={2}>
                TOTAL
              </td>
              <PlanRowCells row={plan.grand_total} strong />
            </tr>
          </tbody>
        </table>

        {/* ================= SECTION B ================= */}
        <p style={{ fontSize: "9px", fontWeight: 600, margin: "10px 0 4px" }}>
          B) ACCROÎTRE LES ACQUIS SCOLAIRES ET LA PERFORMANCE AUX EXAMENS DES
          ÉLÈVES DE TOUS LES NIVEAUX.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: "70px" }} rowSpan={2}>
                CENTRE
              </th>
              <th style={{ ...thStyle, width: "110px" }} rowSpan={2}>
                ECOLES
              </th>
              <th colSpan={2} style={thStyle}>
                LE NOMBRE D&apos;ÉLÈVES EN DIFFICULTÉS D&apos;APPRENTISSAGE
              </th>
              <th colSpan={2} style={thStyle}>
                LE NOMBRE D&apos;ÉLÈVES AYANT BÉNÉFICIÉ DES COURS DE MISE À
                NIVEAU
              </th>
              <th colSpan={2} style={thStyle}>
                LE NOMBRE D&apos;ÉLÈVES AYANT BÉNÉFICIÉ DES MÉCANISMES DE
                REMÉDIATION PAR MATIÈRE
              </th>
            </tr>
            <tr>
              <th style={thStyle}>TOTAL</th>
              <th style={thStyle}>FILLES</th>
              <th style={thStyle}>TOTAL</th>
              <th style={thStyle}>FILLES</th>
              <th style={thStyle}>TOTAL</th>
              <th style={thStyle}>FILLES</th>
            </tr>
          </thead>
          <tbody>
            {centers.map((c) => (
              <Fragment key={c.id || "unassigned-b"}>
                {c.schools.map((s) => (
                  <tr key={s.school_id}>
                    {s === c.schools[0] && (
                      <td
                        style={centerTdStyle}
                        rowSpan={c.schools.length + 1}
                        title={c.name}
                      >
                        {c.name}
                      </td>
                    )}
                    <td style={schoolTdStyle}>{s.school_name}</td>
                    <NumCell n={s.difficultes?.total} />
                    <NumCell n={s.difficultes?.filles} />
                    <NumCell n={s.mise_a_niveau?.total} />
                    <NumCell n={s.mise_a_niveau?.filles} />
                    <NumCell n={s.remediation?.total} />
                    <NumCell n={s.remediation?.filles} />
                  </tr>
                ))}
                <tr>
                  <td style={{ ...schoolTdStyle, fontStyle: "italic" }}>
                    Total {c.name}
                  </td>
                  <PlanRowBCells row={c.totals} />
                </tr>
              </Fragment>
            ))}
            <tr style={{ background: TOTAL_BG }}>
              <td style={{ ...schoolTdStyle, textAlign: "center" }} colSpan={2}>
                TOTAL
              </td>
              <PlanRowBCells row={plan.grand_total} strong />
            </tr>
          </tbody>
        </table>

        {/* --- Signatures --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "10px",
            fontWeight: 700,
            textDecoration: "underline",
            marginTop: "16px",
          }}
        >
          <span>L&apos;Inspecteur</span>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground py-4 print:hidden">
        Sections A et B du plan groupées par centre d&apos;examen — même
        architecture que les documents officiels de l&apos;IEPP. % Admis =
        Admis / Présents ; % Admis (Filles) = Admises / Filles présentes.
      </p>
    </div>
  );
}

/** Les 12 cellules de données de la section A pour une ligne d'agrégat
 *  (6 par discipline : Total | Filles inscrits + Présents | % Admis |
 *  Admis (Filles) | % Admis (Filles)). */
function PlanRowCells({ row, strong }: { row: PdaPlanSchoolRow; strong?: boolean }) {
  const agg = strong ? tdStyle : { ...tdStyle, fontWeight: 600 };
  const aggPct = (n: number) => (n ? `${fmtPct(n)}%` : "");
  return (
    <>
      <td style={agg}>{row.inscrits?.total || ""}</td>
      <td style={agg}>{row.inscrits?.filles || ""}</td>
      <td style={agg}>{row.disciplines?.exploitation?.presents?.total || ""}</td>
      <td style={agg}>{aggPct(row.disciplines?.exploitation?.pct_admis ?? 0)}</td>
      <td style={agg}>{row.disciplines?.exploitation?.admis?.filles || ""}</td>
      <td style={agg}>{aggPct(row.disciplines?.exploitation?.pct_admis_filles ?? 0)}</td>
      <td style={agg}>{row.inscrits?.total || ""}</td>
      <td style={agg}>{row.inscrits?.filles || ""}</td>
      <td style={agg}>{row.disciplines?.math?.presents?.total || ""}</td>
      <td style={agg}>{aggPct(row.disciplines?.math?.pct_admis ?? 0)}</td>
      <td style={agg}>{row.disciplines?.math?.admis?.filles || ""}</td>
      <td style={agg}>{aggPct(row.disciplines?.math?.pct_admis_filles ?? 0)}</td>
    </>
  );
}

/** Les 6 cellules de données de la section B pour une ligne d'agrégat. */
function PlanRowBCells({ row, strong }: { row: PdaPlanSchoolRow; strong?: boolean }) {
  const agg = strong ? tdStyle : { ...tdStyle, fontWeight: 600 };
  return (
    <>
      <td style={agg}>{row.difficultes?.total || ""}</td>
      <td style={agg}>{row.difficultes?.filles || ""}</td>
      <td style={agg}>{row.mise_a_niveau?.total || ""}</td>
      <td style={agg}>{row.mise_a_niveau?.filles || ""}</td>
      <td style={agg}>{row.remediation?.total || ""}</td>
      <td style={agg}>{row.remediation?.filles || ""}</td>
    </>
  );
}
