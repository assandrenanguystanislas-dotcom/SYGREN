"use client";

// === PDA IEPP — Document réseau « PLAN D'ACTION PLURIANNUEL DE L'IEPP » ===
// Reproduction FIDÈLE de l'architecture du document officiel reçu de
// l'IEPP (SUIVI PLURIANNUEL_1..4) : les écoles y sont GROUPÉES PAR CENTRE
// D'EXAMEN, ligne TOTAL de l'inspection en bas.
//
// Architecture du modèle reçu :
//   - En-tête institutionnel (bloc ministériel + République + armoiries)
//   - Boîte jaune de l'évaluation : « EXAMEN BLANC N°1 DU 13/03/2025 »
//   - Bandeau jaune pleine largeur : « PLAN D'ACTION PLURIANNUEL DE
//     L'IEPP DABOU-1 »
//   - Section A : NOMBRE D'ELEVES DU CM2 AYANT ATTEINT LE SEUIL SUFFISANT
//     DE MAÎTRISE EN LECTURE (EXPLOITATION DE TEXTE), MATHEMATIQUES.
//     Colonnes par discipline : Total | Filles | Présents (admis) |
//     % Admis | Admis (Filles) | % Admis (Filles).
//   - Section B : ACCROÎTRE LES ACQUIS SCOLAIRES ET LA PERFORMANCE AUX
//     EXAMENS DES ELEVES DE TOUS LES NIVEAUX. — 3 indicateurs ×
//     (TOTAL | FILLES), bande grise sous les sous-entêtes.
//   - PAS de sous-totaux par centre (le modèle n'en a pas : uniquement
//     les lignes écoles + la ligne TOTAL finale, fond gris, en gras).
//   - Bordures « Excel » : cadre épais, séparations de groupes épaisses,
//     filets intérieurs fins. Effectifs zéro-padés (07), % à 2 décimales
//     (89,26%), encre noire, police Calibri (Carlito).
//   - Aucune signature sur le document reçu (il s'achève sur le TOTAL).
//
// Écart documenté vs modèle papier : les formules Excel de l'original
// affichaient #DIV/0! et ######## ; SYGREN laisse les cases vides et
// applique la définition correcte % Admis = Admis/Présents (le modèle
// divisait par les inscrits, valeurs > 100 % possibles).
//
// Toutes les données viennent de /api/pda/plan-action (source unique de
// vérité — le document ne recalcule rien). Impression 100 % navigateur
// A4 paysage (isolement #pda-plan-doc, page nommée pda-plan).

import { Fragment, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";

import { pdaApi } from "@/lib/api";
import { monthLabel } from "@/lib/session-utils";
import type {
  PdaPlanCenterGroup,
  PdaPlanDisciplineStats,
  PdaPlanSchoolRow,
} from "@/lib/types";

import {
  INK,
  OFFICIAL_FONT,
  OfficialDocHeader,
  THICK,
  THIN,
  TOTAL_BG,
  fmtDocNum,
  fmtDocPct,
} from "./official-doc";

const thBase: CSSProperties = {
  border: THIN,
  padding: "3px 4px",
  fontSize: "9.5px",
  fontWeight: 400, // le modèle reçu : entêtes de colonnes en régulier
  textAlign: "center",
  verticalAlign: "middle",
  color: INK,
};

const tdBase: CSSProperties = {
  border: THIN,
  padding: "2px 4px",
  fontSize: "9.5px",
  textAlign: "center",
  color: INK,
};

const centreTd: CSSProperties = {
  ...tdBase,
  fontWeight: 700,
  verticalAlign: "middle",
  borderRight: THICK,
};

const schoolTd: CSSProperties = {
  ...tdBase,
  textAlign: "left",
  fontWeight: 700,
  whiteSpace: "nowrap",
  borderRight: THICK,
};

/** Cellules des 6 colonnes d'une discipline (section A), dans l'ordre du
 *  modèle : Total | Filles (inscrits) | Présents | % Admis |
 *  Admis (Filles) | % Admis (Filles). Première colonne des MATHÉMATIQUES
 *  = séparation épaisse entre les 2 disciplines (modèle Excel). */
function DisciplineCells({
  row,
  discipline,
}: {
  row: PdaPlanSchoolRow;
  discipline: "exploitation" | "math";
}) {
  const d: PdaPlanDisciplineStats | undefined = row.disciplines?.[discipline];
  const first = discipline === "math";
  const td = first ? { ...tdBase, borderLeft: THICK } : tdBase;
  return (
    <>
      <td style={td}>{fmtDocNum(row.inscrits?.total)}</td>
      <td style={td}>{fmtDocNum(row.inscrits?.filles)}</td>
      <td style={td}>{fmtDocNum(d?.presents?.total)}</td>
      <td style={td}>
        {d && (d.presents?.total ?? 0) > 0 ? fmtDocPct(d.pct_admis) : ""}
      </td>
      <td style={td}>{fmtDocNum(d?.admis?.filles)}</td>
      <td style={td}>
        {d && (d.presents?.total ?? 0) > 0 ? fmtDocPct(d.pct_admis_filles) : ""}
      </td>
    </>
  );
}

/** Les 12 cellules de données de la section A pour une ligne TOTAL
 *  (fond gris, gras — modèle reçu). */
function TotalRowCells({ row }: { row: PdaPlanSchoolRow }) {
  const t = (n: number | undefined) => fmtDocNum(n);
  const p = (v: number | undefined, ref: number | undefined) =>
    (ref ?? 0) > 0 ? fmtDocPct(v) : "";
  const bold: CSSProperties = { ...tdBase, fontWeight: 700, background: TOTAL_BG };
  const boldMath: CSSProperties = { ...bold, borderLeft: THICK };
  return (
    <>
      <td style={bold}>{t(row.inscrits?.total)}</td>
      <td style={bold}>{t(row.inscrits?.filles)}</td>
      <td style={bold}>{t(row.disciplines?.exploitation?.presents?.total)}</td>
      <td style={bold}>
        {p(row.disciplines?.exploitation?.pct_admis, row.disciplines?.exploitation?.presents?.total)}
      </td>
      <td style={bold}>{t(row.disciplines?.exploitation?.admis?.filles)}</td>
      <td style={bold}>
        {p(
          row.disciplines?.exploitation?.pct_admis_filles,
          row.disciplines?.exploitation?.presents?.total,
        )}
      </td>
      <td style={boldMath}>{t(row.inscrits?.total)}</td>
      <td style={bold}>{t(row.inscrits?.filles)}</td>
      <td style={bold}>{t(row.disciplines?.math?.presents?.total)}</td>
      <td style={bold}>
        {p(row.disciplines?.math?.pct_admis, row.disciplines?.math?.presents?.total)}
      </td>
      <td style={bold}>{t(row.disciplines?.math?.admis?.filles)}</td>
      <td style={bold}>
        {p(row.disciplines?.math?.pct_admis_filles, row.disciplines?.math?.presents?.total)}
      </td>
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

  // Boîte jaune de l'évaluation — format du modèle reçu :
  // « EXAMEN BLANC N°1 DU 13/03/2025 ».
  const evalTitle = isComposition
    ? `COMPOSITION N°${plan.number} — ${
        plan.session_month && plan.session_month >= 1 && plan.session_month <= 12
          ? `${monthLabel(plan.session_month)} `
          : ""
      }${plan.year}`
    : `EXAMEN BLANC N°${plan.number}${
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
          fontFamily: OFFICIAL_FONT,
          color: INK,
          overflowX: "auto",
        }}
      >
        {/* --- En-tête institutionnel (modèle reçu) --- */}
        <OfficialDocHeader iep={iep} variant="plan" size="sm" />

        {/* --- Boîte jaune de l'évaluation --- */}
        <div style={{ textAlign: "center", margin: "2px 0 8px" }}>
          <span
            style={{
              display: "inline-block",
              background: "#ffff00",
              padding: "5px 26px",
              fontSize: "14px",
              fontWeight: 700,
              color: INK,
            }}
          >
            {evalTitle}
          </span>
        </div>

        {/* --- Bandeau jaune du titre (modèle reçu) --- */}
        <div
          style={{
            background: "#ffff00",
            textAlign: "center",
            padding: "7px 8px",
            marginBottom: "10px",
            fontSize: "17px",
            color: INK,
            width: "82%",
            margin: "0 auto 10px",
          }}
        >
          PLAN D&apos;ACTION PLURIANNUEL DE L&apos;IEPP{" "}
          {(iep?.name || "…………").toUpperCase()}
        </div>

        {/* ================= SECTION A ================= */}
        <p style={{ fontSize: "10.5px", margin: "6px 0 4px" }}>
          A) NOMBRE D&apos;ELEVES DU CM2 AYANT ATTEINT LE SEUIL SUFFISANT DE
          MAÎTRISE EN LECTURE (EXPLOITATION DE TEXTE), MATHEMATIQUES.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", border: THICK }}>
          <thead>
            {/* Ligne 1 : CENTRES | ECOLES | DISCIPLINES (2 × 6 colonnes).
                rowSpan=3 : l'en-tête comporte 3 lignes. */}
            <tr>
              <th style={{ ...thBase, fontWeight: 700, borderRight: THICK }} rowSpan={3}>
                CENTRES
                <br />
                D&apos;EXAMENS
              </th>
              <th style={{ ...thBase, fontWeight: 700, borderRight: THICK, width: "110px" }} rowSpan={3}>
                ECOLES
              </th>
              <th colSpan={12} style={{ ...thBase, borderBottom: THICK }}>
                DISCIPLINES
              </th>
            </tr>
            <tr>
              <th colSpan={6} style={{ ...thBase, borderBottom: THIN }}>
                EXPLOITATION DE TEXTE
              </th>
              <th colSpan={6} style={{ ...thBase, borderBottom: THIN, borderLeft: THICK }}>
                MATHEMATIQUES
              </th>
            </tr>
            {/* Ligne 3 : sous-entêtes — Total | Filles | Présents (admis) |
                % Admis | Admis (Filles) | % Admis (Filles), par discipline
                (Total/Filles = effectifs INSCRITS, comme le modèle reçu). */}
            <tr>
              {["exploitation", "math"].map((d, di) => (
                <Fragment key={d}>
                  <th style={di === 1 ? { ...thBase, borderLeft: THICK } : thBase}>Total</th>
                  <th style={thBase}>Filles</th>
                  <th style={thBase}>
                    Présents
                    <br />
                    (admis)
                  </th>
                  <th style={thBase}>% Admis</th>
                  <th style={thBase}>
                    Admis
                    <br />
                    (Filles)
                  </th>
                  <th style={thBase}>% Admis (Filles)</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {centers.map((c) => (
              <Fragment key={c.id || "unassigned-a"}>
                {/* PAS de sous-totaux par centre — le modèle reçu n'en a
                    pas : uniquement les lignes écoles. */}
                {c.schools.map((s) => (
                  <tr key={s.school_id}>
                    {s === c.schools[0] && (
                      <td style={centreTd} rowSpan={c.schools.length} title={c.name}>
                        {c.name}
                      </td>
                    )}
                    <td style={schoolTd}>{s.school_name}</td>
                    <DisciplineCells row={s} discipline="exploitation" />
                    <DisciplineCells row={s} discipline="math" />
                  </tr>
                ))}
              </Fragment>
            ))}
            {/* TOTAL général de l'IEPP (fond gris, gras — modèle reçu) */}
            <tr>
              <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700, textAlign: "center" }} colSpan={2}>
                TOTAL
              </td>
              <TotalRowCells row={plan.grand_total} />
            </tr>
          </tbody>
        </table>

        {/* ================= SECTION B ================= */}
        <p style={{ fontSize: "10.5px", margin: "12px 0 4px" }}>
          B) ACCROÎTRE LES ACQUIS SCOLAIRES ET LA PERFORMANCE AUX EXAMENS DES
          ELEVES DE TOUS LES NIVEAUX.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", border: THICK }}>
          <thead>
            {/* En-tête 3 lignes du modèle reçu : les 3 indicateurs sur 2
                lignes (titres + TOTAL/FILLES), bande grise dessous,
                CENTRE/ECOLES sur toute la hauteur. */}
            <tr>
              <th style={{ ...thBase, fontWeight: 700, borderRight: THICK, width: "70px" }} rowSpan={3}>
                CENTRE
              </th>
              <th style={{ ...thBase, fontWeight: 700, borderRight: THICK, width: "110px" }} rowSpan={3}>
                ECOLES
              </th>
              <th colSpan={2} style={thBase}>
                LE NOMBRE D&apos;ELEVES EN DIFFICULTES D&apos;APPRENTISSAGE
              </th>
              <th colSpan={2} style={{ ...thBase, borderLeft: THICK }}>
                LE NOMBRE D&apos;ELEVES AYANT BENEFICIE DES COURS DE MISE A
                NIVEAU (voir liste des élèves et les notes avant et après)
              </th>
              <th colSpan={2} style={{ ...thBase, borderLeft: THICK }}>
                LE NOMBRE D&apos;ELEVES AYANT BENEFICIE DES MECANISMES DE
                REMEDIATION PAR MATIERE
              </th>
            </tr>
            <tr>
              {[
                "difficultes",
                "mise_a_niveau",
                "remediation",
              ].map((k, ki) => (
                <Fragment key={k}>
                  <th style={ki > 0 ? { ...thBase, borderLeft: THICK } : thBase}>TOTAL</th>
                  <th style={thBase}>FILLES</th>
                </Fragment>
              ))}
            </tr>
            {/* Bande grise sous les sous-entêtes (modèle reçu) */}
            <tr>
              <th colSpan={6} style={{ ...thBase, background: TOTAL_BG, height: "14px", padding: 0, borderLeft: THIN, borderRight: THIN }} />
            </tr>
          </thead>
          <tbody>
            {centers.map((c) => (
              <Fragment key={c.id || "unassigned-b"}>
                {c.schools.map((s) => (
                  <tr key={s.school_id}>
                    {s === c.schools[0] && (
                      <td style={centreTd} rowSpan={c.schools.length} title={c.name}>
                        {c.name}
                      </td>
                    )}
                    <td style={schoolTd}>{s.school_name}</td>
                    <td style={tdBase}>{fmtDocNum(s.difficultes?.total)}</td>
                    <td style={tdBase}>{fmtDocNum(s.difficultes?.filles)}</td>
                    <td style={{ ...tdBase, borderLeft: THICK }}>
                      {fmtDocNum(s.mise_a_niveau?.total)}
                    </td>
                    <td style={tdBase}>{fmtDocNum(s.mise_a_niveau?.filles)}</td>
                    <td style={{ ...tdBase, borderLeft: THICK }}>
                      {fmtDocNum(s.remediation?.total)}
                    </td>
                    <td style={tdBase}>{fmtDocNum(s.remediation?.filles)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr>
              <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>TOTAL</td>
              <td style={{ ...tdBase, background: TOTAL_BG }} />
              <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                {fmtDocNum(plan.grand_total?.difficultes?.total)}
              </td>
              <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                {fmtDocNum(plan.grand_total?.difficultes?.filles)}
              </td>
              <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700, borderLeft: THICK }}>
                {fmtDocNum(plan.grand_total?.mise_a_niveau?.total)}
              </td>
              <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                {fmtDocNum(plan.grand_total?.mise_a_niveau?.filles)}
              </td>
              <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700, borderLeft: THICK }}>
                {fmtDocNum(plan.grand_total?.remediation?.total)}
              </td>
              <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                {fmtDocNum(plan.grand_total?.remediation?.filles)}
              </td>
            </tr>
          </tbody>
        </table>
        {/* Le document reçu s'achève sur la ligne TOTAL — aucune signature. */}
      </div>

      <p className="text-center text-[11px] text-muted-foreground py-4 print:hidden">
        Sections A et B du plan groupées par centre d&apos;examen — même
        architecture, en-tête et police (Calibri) que les documents officiels
        de l&apos;IEPP. % Admis = Admis / Présents ; % Admis (Filles) =
        Admises / Filles présentes.
      </p>
    </div>
  );
}
