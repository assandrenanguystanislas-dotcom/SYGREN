"use client";

// === PDA IEPP — Document officiel imprimable ===
// Reproduction fidèle de la fiche « SUIVI DU PLAN D'ACTION PLURIANNUEL DE
// L'IEPP — RÉSULTAT DE L'EXAMEN BLANC N°X » (niveaux CE/CM).
//   - Tableau 1 : Présents / Admis / % Admis (Total | Filles | Garçons)
//   - Tableau 2 : maîtrise par matière (3 matières désignées)
//   - Tableau 3 : difficultés (calculé) + remédiation (saisissable ici)
// Tous les agrégats sont calculés côté serveur (/summary) — le document ne
// recalcule rien. Impression 100 % navigateur (isolement #pda-doc).

import { Fragment, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Printer, X } from "lucide-react";
import { toast } from "sonner";

import { pdaApi } from "@/lib/api";
import type { PdaCountRow, PdaSummary } from "@/lib/types";

const INK = "#1f2937"; // gris encre — cohérent avec les documents officiels
const BORDER = "1px solid #374151";

/** Pourcentages formatés à la française (66.7 → « 66,7 », 50 → « 50 »). */
function fmtPct(n: number): string {
  const s = n.toFixed(1).replace(".", ",");
  return s.endsWith(",0") ? s.slice(0, -2) : s;
}

const thStyle: CSSProperties = {
  border: BORDER,
  padding: "4px 6px",
  fontSize: "10px",
  fontWeight: 700,
  textAlign: "center",
  color: INK,
};

const tdStyle: CSSProperties = {
  border: BORDER,
  padding: "3px 6px",
  fontSize: "10px",
  textAlign: "center",
  color: INK,
};

const labelTdStyle: CSSProperties = {
  ...tdStyle,
  textAlign: "left",
  fontWeight: 600,
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
          {row[k]}
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
  const examDate = s.exam.exam_date
    ? new Date(s.exam.exam_date).toLocaleDateString("fr-FR")
    : "";

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barre d'outils (masquée à l'impression) */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2 print:hidden">
        <h3 className="font-semibold text-sm">
          Plan d&apos;Action IEPP — Examen Blanc N°{s.exam.number} · {s.class.name}
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
          minHeight: "297mm",
          padding: "14mm 12mm",
          fontFamily: "Helvetica, Arial, sans-serif",
          color: INK,
          overflowX: "auto",
        }}
      >
        {/* --- En-tête institutionnel --- */}
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
            <div>DIRECTION REGIONALE DE {(s.iep?.region || s.iep?.name || "…………").toUpperCase()}</div>
            <div>INSPECTION DE L&apos;ENSEIGNEMENT</div>
            <div>PRESCOLAIRE ET PRIMAIRE DE {(s.iep?.name || "…………").toUpperCase()}</div>
            <div>
              BP {s.iep?.bp || "……"} · Tel {s.iep?.inspector_phone || "…………"}
            </div>
            <div>Courriel : {s.iep?.inspector_email || "…………"}</div>
          </div>
          <div style={{ fontSize: "10px", fontWeight: 700, textAlign: "right", lineHeight: 1.5 }}>
            <div>REPUBLIQUE DE CÔTE D&apos;IVOIRE</div>
            <div style={{ fontStyle: "italic", fontWeight: 400, fontSize: "8px", marginTop: "18px" }}>
              Union-Discipline-Travail
            </div>
          </div>
        </div>

        {/* --- Titre encadré --- */}
        <div style={{ border: `2px solid ${INK}`, padding: "8px", textAlign: "center", marginBottom: "10px" }}>
          <div style={{ fontSize: "13px", fontWeight: 800, letterSpacing: "0.3px" }}>
            SUIVI DU PLAN D&apos;ACTION PLURIANNUEL DE L&apos;IEPP
          </div>
          <div style={{ fontSize: "12px", fontWeight: 800, textDecoration: "underline", marginTop: "6px" }}>
            RESULTAT DE L&apos;EXAMEN BLANC N° {s.exam.number} — ANNEE {s.exam.year}
          </div>
        </div>

        {/* --- École / Classe / Date --- */}
        <div style={{ fontSize: "10px", fontWeight: 700, marginBottom: "8px", lineHeight: 1.6 }}>
          <span>ECOLE : {s.school.name}</span>
          <span style={{ marginLeft: "32px" }}>
            CLASSE : {s.class.name}
            {examDate ? ` — PASSAGE : ${examDate}` : ""}
          </span>
          <span style={{ marginLeft: "32px", fontWeight: 400 }}>
            Seuil de maîtrise : {s.class.seuil}/{s.class.max_score} ({s.exam.threshold} %)
          </span>
        </div>

        {/* --- TABLEAU 1 : vue d'ensemble de l'examen blanc --- */}
        <table style={{ width: "70%", borderCollapse: "collapse", marginBottom: "6px" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, border: "none", width: "26%" }} />
              <th style={{ ...thStyle, border: "none" }} colSpan={3}>
                {s.exam.number}° EXAMEN BLANC
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
              <td style={labelTdStyle}>PRESENTS</td>
              <CountCells row={s.table1.presents} order={["total", "filles", "garcons"]} />
            </tr>
            <tr>
              <td style={labelTdStyle}>ADMIS</td>
              <CountCells row={s.table1.admis} order={["total", "filles", "garcons"]} />
            </tr>
            <tr>
              <td style={labelTdStyle}>% ADMIS</td>
              <td style={tdStyle} colSpan={3}>
                {fmtPct(s.table1.pct_admis)}
              </td>
            </tr>
          </tbody>
        </table>

        <p style={{ fontSize: "10px", margin: "6px 0", lineHeight: 1.5 }}>
          Le nombre d&apos;élèves du {s.class.name} ayant atteint le seuil suffisant de
          maîtrise en lecture (Exploitation de texte, Mathématiques, Dictée).
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
                  {fmtPct(t2[k].pct_admis)}
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
                  {fmtPct(t2[k].pct_non_admis)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <p style={{ fontSize: "10px", margin: "6px 0" }}>
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
              <td style={{ ...labelTdStyle, fontWeight: 400, fontSize: "9px" }}>
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
                    value={rem[k]}
                    onChange={(e) => updateRem(k, e.target.value)}
                    inputMode="numeric"
                    aria-label={k}
                    className="w-full h-7 text-center text-[10px] bg-transparent outline-none focus:bg-amber-50 print:bg-white"
                  />
                </td>
              ))}
            </tr>
            <tr>
              <td style={{ ...labelTdStyle, fontWeight: 400, fontSize: "9px" }}>
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
                    value={rem[k]}
                    onChange={(e) => updateRem(k, e.target.value)}
                    inputMode="numeric"
                    aria-label={k}
                    className="w-full h-7 text-center text-[10px] bg-transparent outline-none focus:bg-amber-50 print:bg-white"
                  />
                </td>
              ))}
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
            marginTop: "24px",
          }}
        >
          <span>Le Directeur</span>
          <span>L&apos;Inspecteur</span>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground py-4 print:hidden">
        Les lignes « mise à niveau » et « remédiation » sont saisissables directement
        dans le document — pensez à enregistrer avant impression.
      </p>
    </div>
  );
}
