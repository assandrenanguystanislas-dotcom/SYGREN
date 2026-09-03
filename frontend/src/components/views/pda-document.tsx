"use client";

// === PDA IEPP — Document officiel imprimable (fiche par école) ===
// Reproduction FIDÈLE de la fiche reçue de l'IEPP (PLAN D'ACTION IEPP_1) :
// « SUIVI DU PLAN D'ACTION PLURIANNUEL DE L'IEPP — RESULTAT DE L'EXAMEN
// BLANC N°X » pour chaque évaluation suivie (examen blanc saisie manuelle
// ou composition mensuelle dérivée du module Notes).
//   - En-tête institutionnel : bloc ministériel + République + armoiries
//     + devise en italique (modèle reçu) — police Calibri (Carlito).
//   - Titre encadré fin + titre de l'évaluation souligné en gras.
//   - ECOLE : / CLASSE : en gras à gauche (modèle reçu).
//   - Tableau 1 : Présents / Admis / % Admis × (Total | Filles | Garçons)
//   - Tableau 2 : maîtrise par matière (Exploitation de texte,
//     Mathématiques, Dictée) × (Total | Garçons | Filles)
//   - Tableau 3 : difficultés (calculé) + remédiation (saisissable ici)
//   - Signatures Le Directeur / L'Inspecteur + nom de l'inspecteur en bas
//     à droite (comme « DOSSO LACINE » sur le modèle reçu).
// Tous les agrégats sont calculés côté serveur (/summary) — le document ne
// recalcule rien. Impression 100 % navigateur (isolement #pda-doc).
//
// v3 — EMBELLISSEMENT DRAPEAU CI (inspiré des bulletins individuels) :
// bandeau du titre en VERT DRAPEAU (texte blanc), entêtes de tableaux
// sur fond vert drapeau, bordures vertes, rubans tricolores haut/bas
// et ARMOIRIES en filigrane dans le fond du document.

import { Fragment, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";
import { toast } from "sonner";

import { pdaApi } from "@/lib/api";
import { monthLabel } from "@/lib/session-utils";
import type { PdaCountRow, PdaSummary } from "@/lib/types";

import { INK, OFFICIAL_FONT, OfficialDocHeader, fmtDocNum } from "./official-doc";
import {
  CIArmoiriesWatermark,
  CIFlagRibbon,
  CI_GREEN,
  CI_GREEN_TEXT,
  PRINT_COLOR_STYLE,
} from "@/components/ci-decor";

/** Pourcentages à 2 décimales, virgule française (modèle reçu). */
function fmtPct(n: number): string {
  return `${n.toFixed(2).replace(".", ",")}%`;
}

/** Ordinal français du modèle reçu : 1er, 2e, 3e… */
function ordinal(n: number): string {
  return n === 1 ? "1er" : `${n}e`;
}

// Bordures et entêtes aux COULEURS DU DRAPEAU ivoirien (inspiration
// bulletins individuels) — entêtes sur FOND VERT DRAPEAU, texte blanc.
const thStyle: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "4px 6px",
  fontSize: "12px",
  fontWeight: 400, // entêtes réguliers sur le modèle reçu
  textAlign: "center",
  color: "#ffffff",
  background: CI_GREEN,
  ...PRINT_COLOR_STYLE,
};

const tdStyle: CSSProperties = {
  border: `1px solid ${CI_GREEN}`,
  padding: "3px 6px",
  fontSize: "12px",
  textAlign: "center",
  color: INK,
};

const labelTdStyle: CSSProperties = {
  ...tdStyle,
  textAlign: "left",
  fontWeight: 600,
  color: CI_GREEN_TEXT,
};

/** Cellules d'effectifs dans l'ordre demandé (Total/Filles/Garçons etc.). */
function CountCells({
  row,
  order,
}: {
  row: PdaCountRow;
  order: Array<"total" | "filles" | "garcons">;
}) {
  return (
    <>
      {order.map((k) => (
        <td key={k} style={tdStyle}>
          {fmtDocNum(row[k])}
        </td>
      ))}
    </>
  );
}

export function PdaDocument({
  examId,
  classId,
  onClose,
}: {
  examId: string;
  classId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["pda-summary", examId, classId],
    queryFn: () => pdaApi.getSummary(examId, classId),
  });

  // === Remédiation (lignes 2-3 du tableau 3) — dérivation + override ===
  // Valeurs serveur dérivées de la synthèse ; override = saisie locale en
  // cours (remis à null après sauvegarde — le serveur redevient la source).
  interface RemState {
    mise_a_niveau_total: number;
    mise_a_niveau_garcons: number;
    mise_a_niveau_filles: number;
    remediation_total: number;
    remediation_garcons: number;
    remediation_filles: number;
  }
  const serverRem: RemState = {
    mise_a_niveau_total: data?.table3.mise_a_niveau.total ?? 0,
    mise_a_niveau_garcons: data?.table3.mise_a_niveau.garcons ?? 0,
    mise_a_niveau_filles: data?.table3.mise_a_niveau.filles ?? 0,
    remediation_total: data?.table3.remediation.total ?? 0,
    remediation_garcons: data?.table3.remediation.garcons ?? 0,
    remediation_filles: data?.table3.remediation.filles ?? 0,
  };
  const [remOverride, setRemOverride] = useState<RemState | null>(null);
  const rem = remOverride ?? serverRem;
  const remDirty = remOverride !== null;

  const remMutation = useMutation({
    mutationFn: () => pdaApi.saveRemediation(examId, { class_id: classId, ...rem }),
    onSuccess: () => {
      setRemOverride(null); // le serveur redevient la source de vérité
      queryClient.invalidateQueries({ queryKey: ["pda-summary", examId, classId] });
      toast.success("Remédiation enregistrée");
    },
    onError: (e) =>
      toast.error("Erreur", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      }),
  });

  const updateRem = (key: keyof RemState, value: string) => {
    const n = value.replace(/[^0-9]/g, "").slice(0, 3);
    setRemOverride({ ...rem, [key]: n === "" ? 0 : Number(n) });
  };

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

  const s: PdaSummary = data;
  const t2 = s.table2;
  const isComposition = s.exam.kind === "composition";
  // Libellés officiels selon le type d'évaluation suivie par le plan
  // (modèle reçu : « RESULTAT DE L'EXAMEN BLANC N° 2 »).
  const evalTitle = isComposition
    ? `RESULTAT DE LA COMPOSITION N° ${s.exam.number} — ${
        s.exam.session_month && s.exam.session_month >= 1 && s.exam.session_month <= 12
          ? `${monthLabel(s.exam.session_month).toUpperCase()} `
          : ""
      }${s.exam.year}`
    : `RESULTAT DE L'EXAMEN BLANC N° ${s.exam.number}`;
  const evalColHeader = isComposition
    ? `${ordinal(s.exam.number)} COMPOSITION`
    : `${ordinal(s.exam.number)} EXAMEN BLANC`;
  const toolbarTitle = isComposition
    ? `Composition N°${s.exam.number}${
        s.exam.session_month ? ` — ${monthLabel(s.exam.session_month)} ${s.exam.year}` : ""
      }`
    : `Examen Blanc N°${s.exam.number}`;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Plan d&apos;Action IEPP — {toolbarTitle} · {s.class.name}
        </h3>
        <div className="flex items-center gap-2">
          {remDirty && (
            <button
              onClick={() => remMutation.mutate()}
              disabled={remMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-600 disabled:opacity-60"
            >
              {remMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : null}
              Enregistrer la remédiation
            </button>
          )}
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

      {/* === DOCUMENT OFFICIEL (isolement impression #pda-doc) === */}
      <div
        id="pda-doc"
        className="bg-white mx-auto shadow-lg print:shadow-none"
        style={{
          width: "100%",
          maxWidth: "210mm",
          minHeight: "275mm", // zone imprimable A4 (marges 8mm) — jamais 297 (2e page blanche)
          padding: "12mm 14mm",
          fontFamily: OFFICIAL_FONT,
          color: INK,
          overflowX: "auto",
          position: "relative", // filigrane armoiries DANS LE FOND
        }}
      >
        {/* --- Ruban tricolore ivoirien (haut du document) --- */}
        <CIFlagRibbon />
        {/* --- ARMOIRIES DE LA CÔTE D'IVOIRE en filigrane (fond) --- */}
        <CIArmoiriesWatermark />
        <div style={{ position: "relative", zIndex: 1 }}>
        {/* --- En-tête institutionnel (modèle reçu : armoiries + devise) --- */}
        <OfficialDocHeader iep={s.iep} variant="fiche" size="lg" />

        {/* --- Bandeau du titre VERT DRAPEAU (texte blanc — inspiration
            bulletins individuels) + titre de l'évaluation souligné --- */}
        <div style={{ textAlign: "center", margin: "4px 0 10px" }}>
          <div
            style={{
              display: "inline-block",
              background: CI_GREEN,
              color: "#ffffff",
              padding: "8px 26px",
              fontSize: "15px",
              fontWeight: 700,
              lineHeight: 1.45,
              maxWidth: "150mm",
              ...PRINT_COLOR_STYLE,
            }}
          >
            SUIVI DU PLAN D&apos;ACTION PLURIANNUEL DE L&apos;IEPP
          </div>
          <div
            style={{
              fontSize: "14.5px",
              fontWeight: 700,
              textDecoration: "underline",
              marginTop: "10px",
              color: CI_GREEN_TEXT,
            }}
          >
            {evalTitle}
          </div>
        </div>

        {/* --- ECOLE / CLASSE en gras à gauche (modèle reçu) --- */}
        <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "8px", lineHeight: 1.7 }}>
          <div>ECOLE : {s.school.name}</div>
          <div>CLASSE : {s.class.name}</div>
        </div>

        {/* --- TABLEAU 1 : vue d'ensemble de l'évaluation --- */}
        <table style={{ width: "70%", borderCollapse: "collapse", marginBottom: "6px" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "26%" }} />
              <th style={{ ...thStyle, border: "none" }} colSpan={3}>
                {evalColHeader}
              </th>
            </tr>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "26%" }} />
              <th style={thStyle}>TOTAL</th>
              <th style={thStyle}>FILLES</th>
              <th style={thStyle}>GARÇONS</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...tdStyle, border: "none" }}>PRESENTS</td>
              <CountCells row={s.table1.presents} order={["total", "filles", "garcons"]} />
            </tr>
            <tr>
              <td style={{ ...tdStyle, border: "none" }}>ADMIS</td>
              <CountCells row={s.table1.admis} order={["total", "filles", "garcons"]} />
            </tr>
            <tr>
              <td style={{ ...tdStyle, border: "none" }}>% ADMIS</td>
              <td style={tdStyle} colSpan={3}>
                {fmtPct(s.table1.pct_admis)}
              </td>
            </tr>
          </tbody>
        </table>

        <p style={{ fontSize: "12px", margin: "6px 0", lineHeight: 1.5 }}>
          Le nombre d&apos;élèves du {s.class.name} ayant atteint le seuil suffisant de
          maîtrise en lecture (Exploitation de texte, Mathématiques, Dictée ).
        </p>

        {/* --- TABLEAU 2 : maîtrise par matière --- */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "17%" }} />
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <th key={k} style={{ ...thStyle, border: "none" }} colSpan={3}>
                  {k === "exploitation" ? "EXPLOITATION DE TEXTE" : k === "math" ? "MATHÉMATIQUES" : "DICTÉE"}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "17%" }} />
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <Fragment key={k}>
                  <th style={thStyle}>TOTAL</th>
                  <th style={thStyle}>GARÇONS</th>
                  <th style={thStyle}>FILLES</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={labelTdStyle}>Présents</td>
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <CountCells key={`p-${k}`} row={t2[k].presents} order={["total", "garcons", "filles"]} />
              ))}
            </tr>
            <tr>
              <td style={labelTdStyle}>Admis</td>
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <CountCells key={`a-${k}`} row={t2[k].admis} order={["total", "garcons", "filles"]} />
              ))}
            </tr>
            <tr>
              <td style={labelTdStyle}>% Admis</td>
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <td key={`pa-${k}`} style={tdStyle} colSpan={3}>
                  {t2[k].presents.total > 0 ? fmtPct(t2[k].pct_admis) : ""}
                </td>
              ))}
            </tr>
            <tr>
              <td style={labelTdStyle}>Non Admis</td>
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <CountCells key={`na-${k}`} row={t2[k].non_admis} order={["total", "garcons", "filles"]} />
              ))}
            </tr>
            <tr>
              <td style={labelTdStyle}>% non admis</td>
              {(["exploitation", "math", "dictee"] as const).map((k) => (
                <td key={`pna-${k}`} style={tdStyle} colSpan={3}>
                  {t2[k].presents.total > 0 ? fmtPct(t2[k].pct_non_admis) : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <p style={{ fontSize: "12px", margin: "6px 0" }}>
          Accroître les acquis scolaires et la performance aux examens des élèves de
          tous les niveaux :
        </p>

        {/* --- TABLEAU 3 : difficultés + remédiation --- */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "14px" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "55%" }} />
              <th style={thStyle}>TOTAL</th>
              <th style={thStyle}>GARÇONS</th>
              <th style={thStyle}>FILLES</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={labelTdStyle}>
                Le nombre d&apos;élèves en difficultés d&apos;apprentissage
              </td>
              <CountCells row={s.table3.difficultes} order={["total", "garcons", "filles"]} />
            </tr>
            <tr>
              <td style={{ ...labelTdStyle, fontSize: "11px" }}>
                Le nombre d&apos;élèves ayant bénéficié des cours de mise à niveau
                (voir liste des élèves et les notes avant et après)
              </td>
              {(
                [
                  "mise_a_niveau_total",
                  "mise_a_niveau_garcons",
                  "mise_a_niveau_filles",
                ] as const
              ).map((k) => (
                <td key={k} style={{ ...tdStyle, padding: 0 }}>
                  <input
                    value={rem[k] ? fmtDocNum(rem[k]) : ""}
                    onChange={(e) => updateRem(k, e.target.value)}
                    inputMode="numeric"
                    aria-label={k}
                    className="w-full h-7 text-center text-[12px] bg-transparent outline-none focus:bg-amber-50 print:bg-white"
                  />
                </td>
              ))}
            </tr>
            <tr>
              <td style={{ ...labelTdStyle, fontSize: "11px" }}>
                Le nombre d&apos;élèves ayant bénéficié des mécanismes de remédiation
                par niveau et par matière.
              </td>
              {(
                [
                  "remediation_total",
                  "remediation_garcons",
                  "remediation_filles",
                ] as const
              ).map((k) => (
                <td key={k} style={{ ...tdStyle, padding: 0 }}>
                  <input
                    value={rem[k] ? fmtDocNum(rem[k]) : ""}
                    onChange={(e) => updateRem(k, e.target.value)}
                    inputMode="numeric"
                    aria-label={k}
                    className="w-full h-7 text-center text-[12px] bg-transparent outline-none focus:bg-amber-50 print:bg-white"
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {/* --- Signatures + nom de l'inspecteur (modèle reçu) --- */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            fontSize: "13px",
            marginTop: "24px",
          }}
        >
          <span style={{ textDecoration: "underline" }}>Le Directeur</span>
          <div style={{ textAlign: "center" }}>
            <span style={{ textDecoration: "underline", color: CI_GREEN_TEXT }}>L&apos;Inspecteur</span>
            {s.iep?.inspector_name ? (
              <div
                style={{
                  fontSize: "12px",
                  marginTop: "28px",
                }}
              >
                {s.iep.inspector_name.toUpperCase()}
              </div>
            ) : null}
          </div>
        </div>
        </div>

        {/* --- Ruban tricolore ivoirien (bas du document) --- */}
        <CIFlagRibbon />
      </div>

      <p className="text-center text-[11px] text-muted-foreground py-4 print:hidden">
        Architecture, en-tête et police (Calibri) du document officiel de
        l&apos;IEPP. Les lignes « mise à niveau » et « remédiation » sont
        saisissables directement dans le document — pensez à enregistrer avant
        impression.
        {!isComposition && s.exam.exam_date
          ? ` Passage : ${new Date(s.exam.exam_date).toLocaleDateString("fr-FR")}.`
          : ""}
        {isComposition
          ? ` Seuils de maîtrise (${s.exam.threshold} %) : ${s.subjects
              .map((sub) => `${sub.label} ${sub.seuil}/${sub.max_score || "—"}`)
              .join(" · ")}.`
          : ` Seuil de maîtrise : ${s.class.seuil}/${s.class.max_score} (${s.exam.threshold} %).`}
      </p>
    </div>
  );
}
