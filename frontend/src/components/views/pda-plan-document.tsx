"use client";

// === PDA IEPP — Document réseau « PLAN D'ACTION PLURIANNUEL DE L'IEPP » ===
// Reproduction FIDÈLE de l'architecture du document officiel reçu de
// l'IEPP (SUIVI PLURIANNUEL_1..4, 4 pages A4 paysage) : les écoles y sont
// GROUPÉES PAR CENTRE D'EXAMEN, ligne TOTAL de l'inspection en bas.
//
// Architecture du modèle reçu :
//   - En-tête institutionnel (bloc ministériel + République + armoiries)
//   - Boîte jaune de l'évaluation : « EXAMEN BLANC N°1 DU 13/03/2025 »
//   - Bandeau jaune pleine largeur : « PLAN D'ACTION PLURIANNUEL DE
//     L'IEPP DABOU-1 »
//   - Section A (pages 1-2) : NOMBRE D'ELEVES DU CM2 AYANT ATTEINT LE
//     SEUIL SUFFISANT DE MAÎTRISE EN LECTURE (EXPLOITATION DE TEXTE),
//     MATHEMATIQUES. Colonnes par discipline : Total | Filles |
//     Présents (admis) | % Admis | Admis (Filles) | % Admis (Filles).
//   - Section B (pages 3-4, NOUVELLE PAGE) : ACCROÎTRE LES ACQUIS
//     SCOLAIRES… — 3 indicateurs × (TOTAL | FILLES), bande grise sur la
//     ligne d'entête CENTRE/ECOLES (comme le modèle).
//   - PAS de sous-totaux par centre (le modèle n'en a pas : uniquement
//     les lignes écoles + la ligne TOTAL finale, fond gris, en gras) et
//     PAS de répétition des entêtes sur les pages suivantes (le modèle
//     poursuit les lignes directement).
//   - Bordures « Excel » : cadre épais, séparations de groupes épaisses,
//     filets intérieurs fins. Effectifs zéro-padés (07), « 00 » pour les
//     zéros calculés ou saisis, cases vides sans données (les #DIV/0! du
//     modèle), % à 2 décimales (89,26%), encre noire, Calibri (Carlito).
//   - Aucune signature sur le document reçu (il s'achève sur le TOTAL).
//
// CALCULS (directives IEPP, formules vérifiées sur la ligne TOTAL du
// modèle : 1105/1238 = 89,26% ; 579/622 = 93,09%) :
//   - « Présents (admis) » = les ADMIS de la discipline : élèves présents
//     ayant atteint le seuil de maîtrise (les non admis = présents
//     évalués − admis alimentent les difficultés de la section B).
//   - % Admis          = Admis / Inscrits
//   - % Admis (Filles) = Admises / Filles inscrites
//   Chaque pourcentage imprimé est donc recalculable depuis les colonnes
//   visibles — les admis et les non admis de chaque colonne sont calculés.
//   - Périmètre : seules les écoles rattachées à un CENTRE D'EXAMEN
//     figurent dans le document (directive IEPP) ; les écoles sans centre
//     sont signalées à l'écran uniquement (jamais imprimées).
//
// PAGINATION (directive IEPP : le plan tient sur 4 pages A4 paysage) :
//   - lignes compactes (9px, entêtes non répétées, saut de ligne évité
//     dans les tr) ;
//   - saut de page AVANT la section B (pages 1-2 = section A, pages 3-4
//     = section B, comme le document reçu).
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

/** Effectif avec zéro CALCULÉ affiché « 00 » (zéros saisis du modèle
 *  reçu) — les cases sans donnée restent vides (fmtDocNum). */
function fmtNum0(n: number | undefined | null): string {
  if (n == null) return "";
  return n <= 0 ? "00" : fmtDocNum(n);
}

/** Pourcentage affiché même à zéro (« 0,00% ») dès que la case est
 *  calculée ; case vide seulement si aucune évaluation (#DIV/0!). */
function fmtPct0(n: number | undefined | null): string {
  if (n == null) return "";
  return `${n.toFixed(2).replace(".", ",")}%`;
}

const thBase: CSSProperties = {
  border: THIN,
  padding: "1px 3px",
  fontSize: "9px",
  lineHeight: 1.15,
  fontWeight: 400, // le modèle reçu : entêtes de colonnes en régulier
  textAlign: "center",
  verticalAlign: "middle",
  color: INK,
};

const tdBase: CSSProperties = {
  border: THIN,
  padding: "0.5px 3px",
  fontSize: "9px",
  lineHeight: 1.15,
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

/** Les 12 cellules de données de la section A pour une ligne école.
 *  Ordre du modèle par discipline : Total | Filles (inscrits) |
 *  Présents (admis) | % Admis | Admis (Filles) | % Admis (Filles).
 *  « Présents (admis) » porte les ADMIS (présents ayant atteint le seuil)
 *  et les % suivent les formules du modèle (Admis/Inscrits) : tout est
 *  recalculable depuis les colonnes imprimées. Une discipline non
 *  évaluée (aucune note) laisse ses 4 cases vides (#DIV/0! du modèle).
 *  Première colonne des MATHÉMATIQUES = séparation épaisse (modèle). */
function DisciplineCells({
  row,
  discipline,
}: {
  row: PdaPlanSchoolRow;
  discipline: "exploitation" | "math";
}) {
  const d: PdaPlanDisciplineStats | undefined = row.disciplines?.[discipline];
  const first = discipline === "math";
  // Trait épais UNIQUEMENT sur la 1re colonne du groupe MATHÉMATIQUES
  // (séparation entre disciplines) — filets fins à l'intérieur (modèle).
  const tdFirst = first ? { ...tdBase, borderLeft: THICK } : tdBase;
  const assessed = (d?.presents?.total ?? 0) > 0; // au moins une note saisie
  const inscrits = row.inscrits?.total ?? 0;
  const filles = row.inscrits?.filles ?? 0;
  return (
    <>
      <td style={tdFirst}>{fmtDocNum(inscrits)}</td>
      <td style={tdBase}>{fmtDocNum(filles)}</td>
      <td style={tdBase}>{assessed ? fmtNum0(d?.admis?.total) : ""}</td>
      <td style={tdBase}>{assessed && inscrits > 0 ? fmtPct0(d?.pct_admis) : ""}</td>
      <td style={tdBase}>{assessed ? fmtNum0(d?.admis?.filles) : ""}</td>
      <td style={tdBase}>
        {assessed && filles > 0 ? fmtPct0(d?.pct_admis_filles) : ""}
      </td>
    </>
  );
}

/** Les 12 cellules de données de la section A pour la ligne TOTAL
 *  (fond gris, gras — modèle reçu). Mêmes règles que les lignes écoles :
 *  « Présents (admis) » = admis calculés, % = formules du modèle,
 *  cases vides si la discipline n'a été évaluée nulle part. */
function TotalRowCells({ row }: { row: PdaPlanSchoolRow }) {
  const bold: CSSProperties = { ...tdBase, fontWeight: 700, background: TOTAL_BG };
  const boldMath: CSSProperties = { ...bold, borderLeft: THICK };
  const pct = (disc: "exploitation" | "math", byFilles: boolean) => {
    const d = row.disciplines?.[disc];
    const assessed = (d?.presents?.total ?? 0) > 0;
    const denom = byFilles
      ? (row.inscrits?.filles ?? 0)
      : (row.inscrits?.total ?? 0);
    return assessed && denom > 0
      ? fmtPct0(byFilles ? d?.pct_admis_filles : d?.pct_admis)
      : "";
  };
  const admis = (disc: "exploitation" | "math", byFilles: boolean) => {
    const d = row.disciplines?.[disc];
    const assessed = (d?.presents?.total ?? 0) > 0;
    return assessed ? fmtNum0(byFilles ? d?.admis?.filles : d?.admis?.total) : "";
  };
  return (
    <>
      <td style={bold}>{fmtDocNum(row.inscrits?.total)}</td>
      <td style={bold}>{fmtDocNum(row.inscrits?.filles)}</td>
      <td style={bold}>{admis("exploitation", false)}</td>
      <td style={bold}>{pct("exploitation", false)}</td>
      <td style={bold}>{admis("exploitation", true)}</td>
      <td style={bold}>{pct("exploitation", true)}</td>
      <td style={boldMath}>{fmtDocNum(row.inscrits?.total)}</td>
      <td style={bold}>{fmtDocNum(row.inscrits?.filles)}</td>
      <td style={boldMath}>{admis("math", false)}</td>
      <td style={bold}>{pct("math", false)}</td>
      <td style={bold}>{admis("math", true)}</td>
      <td style={bold}>{pct("math", true)}</td>
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
    <div className="min-h-screen bg-gray-100 print:bg-white print:min-h-0">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Plan d&apos;Action IEPP — {toolbarTitle} · {totalSchoolCount} école(s)
          avec centre d&apos;examen
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

      {/* Avertissements (écran uniquement) : écoles exclues (sans centre
          d'examen), sans évaluation suivie, sans classe CM2, notes
          manquantes… */}
      {(plan.warnings ?? []).length > 0 && (
        <div className="mx-auto max-w-[297mm] mt-3 px-2 print:hidden">
          <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs p-3 space-y-1 max-h-48 overflow-y-auto">
            <p className="font-semibold">Données incomplètes ou écoles exclues :</p>
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
          padding: "6mm 8mm",
          fontFamily: OFFICIAL_FONT,
          color: INK,
          overflowX: "auto",
        }}
      >
        {/* --- En-tête institutionnel compact (modèle reçu) --- */}
        <OfficialDocHeader iep={iep} variant="plan" size="xs" />

        {/* --- Boîte jaune de l'évaluation --- */}
        <div style={{ textAlign: "center", margin: "1px 0 5px" }}>
          <span
            style={{
              display: "inline-block",
              background: "#ffff00",
              padding: "3px 22px",
              fontSize: "12.5px",
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
            padding: "4px 8px",
            fontSize: "15px",
            color: INK,
            width: "82%",
            margin: "0 auto 6px",
          }}
        >
          PLAN D&apos;ACTION PLURIANNUEL DE L&apos;IEPP{" "}
          {(iep?.name || "…………").toUpperCase()}
        </div>

        {/* ================= SECTION A (pages 1-2) ================= */}
        <p style={{ fontSize: "9.5px", margin: "4px 0 3px" }}>
          A) NOMBRE D&apos;ELEVES DU CM2 AYANT ATTEINT LE SEUIL SUFFISANT DE
          MAÎTRISE EN LECTURE (EXPLOITATION DE TEXTE), MATHEMATIQUES.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", border: THICK }}>
          <thead>
            {/* Ligne 1 : CENTRES | ECOLES | DISCIPLINES (2 × 6 colonnes).
                rowSpan=3 : l'en-tête comporte 3 lignes. À l'impression la
                thead n'est PAS répétée (le modèle poursuit les lignes). */}
            <tr>
              <th style={{ ...thBase, fontWeight: 700, borderRight: THICK }} rowSpan={3}>
                CENTRES
                <br />
                D&apos;EXAMENS
              </th>
              <th style={{ ...thBase, fontWeight: 700, borderRight: THICK, width: "120px" }} rowSpan={3}>
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
              <Fragment key={c.id || "sans-centre-a"}>
                {/* PAS de sous-totaux par centre — le modèle reçu n'en a
                    pas : uniquement les lignes écoles. Les écoles sans
                    centre d'examen n'arrivent pas ici (exclues côté API). */}
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

        {/* ============ SECTION B (pages 3-4 — NOUVELLE PAGE) ============ */}
        <div style={{ breakBefore: "page", pageBreakBefore: "always" }}>
          <p style={{ fontSize: "9.5px", margin: "4px 0 3px" }}>
            B) ACCROÎTRE LES ACQUIS SCOLAIRES ET LA PERFORMANCE AUX EXAMENS
            DES ELEVES DE TOUS LES NIVEAUX.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", border: THICK }}>
            <thead>
              {/* Entête du modèle reçu : les 3 indicateurs sur 2 lignes,
                  puis la ligne CENTRE/ECOLES alignée sur la bande grise. */}
              <tr>
                <th style={{ ...thBase, borderRight: THIN }} colSpan={2} rowSpan={2} />
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
                {["difficultes", "mise_a_niveau", "remediation"].map((k, ki) => (
                  <Fragment key={k}>
                    <th style={ki > 0 ? { ...thBase, borderLeft: THICK } : thBase}>TOTAL</th>
                    <th style={thBase}>FILLES</th>
                  </Fragment>
                ))}
              </tr>
              {/* Ligne CENTRE/ECOLES + bande grise (modèle reçu) */}
              <tr>
                <th style={{ ...thBase, fontWeight: 700, borderRight: THICK, width: "80px" }}>
                  CENTRE
                </th>
                <th style={{ ...thBase, fontWeight: 700, borderRight: THICK, width: "120px" }}>
                  ECOLES
                </th>
                <th colSpan={6} style={{ ...thBase, background: TOTAL_BG, height: "12px", padding: 0, borderLeft: THIN, borderRight: THIN }} />
              </tr>
            </thead>
            <tbody>
              {centers.map((c) => (
                <Fragment key={c.id || "sans-centre-b"}>
                  {c.schools.map((s) => (
                    <tr key={s.school_id}>
                      {s === c.schools[0] && (
                        <td style={centreTd} rowSpan={c.schools.length} title={c.name}>
                          {c.name}
                        </td>
                      )}
                      <td style={schoolTd}>{s.school_name}</td>
                      {/* Difficultés d'apprentissage : CALCULÉES (présents
                          non admis aux 3 matières) — « 00 » dès que
                          l'évaluation a eu lieu, vide sinon (modèle). */}
                      <td style={tdBase}>
                        {s.has_data ? fmtNum0(s.difficultes?.total) : ""}
                      </td>
                      <td style={tdBase}>
                        {s.has_data ? fmtNum0(s.difficultes?.filles) : ""}
                      </td>
                      {/* Mise à niveau / remédiation : saisies — « 00 »
                          uniquement si l'école a réellement enregistré
                          (has_remediation), case vide sinon (modèle :
                          PETIT-BADIEN 00 vs BONN vide). */}
                      <td style={{ ...tdBase, borderLeft: THICK }}>
                        {s.has_remediation
                          ? fmtNum0(s.mise_a_niveau?.total)
                          : fmtDocNum(s.mise_a_niveau?.total)}
                      </td>
                      <td style={tdBase}>
                        {s.has_remediation
                          ? fmtNum0(s.mise_a_niveau?.filles)
                          : fmtDocNum(s.mise_a_niveau?.filles)}
                      </td>
                      <td style={{ ...tdBase, borderLeft: THICK }}>
                        {s.has_remediation
                          ? fmtNum0(s.remediation?.total)
                          : fmtDocNum(s.remediation?.total)}
                      </td>
                      <td style={tdBase}>
                        {s.has_remediation
                          ? fmtNum0(s.remediation?.filles)
                          : fmtDocNum(s.remediation?.filles)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }} colSpan={2}>
                  TOTAL
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                  {plan.grand_total?.has_data
                    ? fmtNum0(plan.grand_total?.difficultes?.total)
                    : ""}
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                  {plan.grand_total?.has_data
                    ? fmtNum0(plan.grand_total?.difficultes?.filles)
                    : ""}
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700, borderLeft: THICK }}>
                  {plan.grand_total?.has_remediation
                    ? fmtNum0(plan.grand_total?.mise_a_niveau?.total)
                    : fmtDocNum(plan.grand_total?.mise_a_niveau?.total)}
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                  {plan.grand_total?.has_remediation
                    ? fmtNum0(plan.grand_total?.mise_a_niveau?.filles)
                    : fmtDocNum(plan.grand_total?.mise_a_niveau?.filles)}
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700, borderLeft: THICK }}>
                  {plan.grand_total?.has_remediation
                    ? fmtNum0(plan.grand_total?.remediation?.total)
                    : fmtDocNum(plan.grand_total?.remediation?.total)}
                </td>
                <td style={{ ...tdBase, background: TOTAL_BG, fontWeight: 700 }}>
                  {plan.grand_total?.has_remediation
                    ? fmtNum0(plan.grand_total?.remediation?.filles)
                    : fmtDocNum(plan.grand_total?.remediation?.filles)}
                </td>
              </tr>
            </tbody>
          </table>
          {/* Le document reçu s'achève sur la ligne TOTAL — aucune signature. */}
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground py-4 print:hidden">
        Sections A (pages 1-2) et B (pages 3-4) du plan groupées par centre
        d&apos;examen — architecture, en-tête et police (Calibri) du document
        officiel reçu. Calculs : « Présents (admis) » = élèves ayant atteint le
        seuil ; % Admis = Admis / Inscrits ; % Admis (Filles) = Admises /
        Filles inscrites (formules du modèle) ; difficultés = présents non
        admis aux 3 matières. Les écoles sans centre d&apos;examen sont
        exclues (rattachement dans le module Écoles).
      </p>
    </div>
  );
}
