// lib/evolution.ts — logique d'évolution vs session précédente (DRY).
//
// Partagé entre :
//   - /bulletins/page.tsx (affichage du delta sur le bulletin A5)
//   - StudentDetailDialog du module Résultats (œil devant chaque élève)
//
// Historique : extrait de bulletins/page.tsx (fetchPreviousAverages, lignes
// 202-242) + logique inline de buildBulletinEleve (calcul du delta normalisé
// /20 puis re-projeté sur l'échelle courante de l'élève). La factorisation
// garantit que les deux modules appliquent STRICTEMENT la même formule.

import { computationApi, sessionsApi } from "./api";
import type { EvaluationSession, StudentResult } from "./types";

// === fetchPreviousAverages ==============================================
//
// Retourne :
//   - averages : Map<matricule_normalisé, { average, scale }> de la session
//     ANTÉRIEURE LA PLUS PROCHE, même école, même eval_type, même année
//     scolaire (ex : Composition N°2 Décembre → Composition N°1 Novembre).
//   - previousSession : l'objet EvaluationSession précédent (pour afficher
//     le label "vs Composition N°1 — Novembre 2025" dans le dialog).
//
// Map vide + previousSession null si : aucune session précédente
// (Composition N°1), session courante introuvable, échec API…  La fonction
// ne lève JAMAIS — l'évolution est non-bloquante.
export type PreviousAveragesResult = {
  averages: Map<string, { average: number; scale: number }>;
  previousSession: EvaluationSession | null;
};

export async function fetchPreviousAverages(
  sessionId: string,
): Promise<PreviousAveragesResult> {
  const empty: PreviousAveragesResult = {
    averages: new Map(),
    previousSession: null,
  };
  try {
    const list = await sessionsApi.list();
    const all = list.sessions ?? [];
    const cur = all.find((s) => s.id === sessionId);
    if (!cur) return empty;
    // Année scolaire : sept-déc → year/year+1 ; jan-juil → year-1/year.
    const schoolYearOf = (m: number, y: number) => (m >= 9 ? y : y - 1);
    const candidates = all.filter(
      (s) =>
        s.school_id === cur.school_id &&
        s.eval_type === cur.eval_type &&
        s.eval_number < cur.eval_number &&
        schoolYearOf(s.month, s.year) === schoolYearOf(cur.month, cur.year) &&
        s.status !== "cancelled",
    );
    if (candidates.length === 0) return empty;
    // La plus proche : plus grand eval_number inférieur au courant.
    candidates.sort((a, b) => b.eval_number - a.eval_number);
    const prev = candidates[0];
    const prevResults = await computationApi.getSessionResults(prev.id);
    const m = new Map<string, { average: number; scale: number }>();
    for (const r of prevResults.results ?? []) {
      if (!r.has_average) continue;
      const key = (r.matricule || "").trim().toUpperCase();
      if (key && key !== "N/A") {
        m.set(key, { average: r.average, scale: r.average_scale ?? 20 });
      }
    }
    return { averages: m, previousSession: prev };
  } catch (e) {
    console.warn("Évolution indisponible (session précédente) :", e);
    return empty;
  }
}

// === computeEvolution ===================================================
//
// Calcule l'évolution d'un élève vs son précédent (issu de
// fetchPreviousAverages). Accepte un type STRUCTUREL — fonctionne pour
// StudentResult (dialog Résultats) ET ReleveData["students"][number]
// (bulletins A5) qui ont tous deux { matricule?, has_average, average,
// average_scale? }.
//
// Formule (identique à l'ancienne logique inline de buildBulletinEleve) :
//   cur20  = (student.average * 20) / curScale   → normalisation /20
//   prev20 = (prev.average  * 20) / prev.scale    → normalisation /20
//   delta  = ((cur20 - prev20) * curScale) / 20   → re-projection sur
//                                                    l'échelle courante
//
// `delta` est donc exprimé dans l'échelle de l'élève (10 CP/CE ou 20 CM) —
// directement affichable à côté de la moyenne courante.
export type EvolutionData = {
  kind: "progression" | "regression" | "stable" | "none";
  delta: number; // dans l'échelle courante de l'élève (10 ou 20)
  previousAvg: number; // moyenne précédente dans SON échelle
  previousScale: number; // échelle de la session précédente (10 ou 20)
  currentAvg20: number; // moyenne courante normalisée /20
  previousAvg20: number; // moyenne précédente normalisée /20
};

const NONE_EVO: EvolutionData = {
  kind: "none",
  delta: 0,
  previousAvg: 0,
  previousScale: 20,
  currentAvg20: 0,
  previousAvg20: 0,
};

export function computeEvolution(
  student: {
    matricule?: string;
    has_average: boolean;
    average: number;
    average_scale?: number;
  },
  prevLookup: Map<string, { average: number; scale: number }>,
): EvolutionData {
  const matKey = (student.matricule || "").trim().toUpperCase();
  if (!matKey || matKey === "N/A" || !student.has_average) return NONE_EVO;
  const prev = prevLookup.get(matKey);
  if (!prev) return NONE_EVO;
  const curScale = student.average_scale || 20;
  const cur20 = (student.average * 20) / curScale;
  const prev20 = (prev.average * 20) / prev.scale;
  const delta = ((cur20 - prev20) * curScale) / 20;
  const kind: EvolutionData["kind"] =
    delta > 0.01 ? "progression" : delta < -0.01 ? "regression" : "stable";
  return {
    kind,
    delta,
    previousAvg: prev.average,
    previousScale: prev.scale,
    currentAvg20: cur20,
    previousAvg20: prev20,
  };
}

// === computeLacunes ====================================================
//
// Lacunes à combler : matières notées (non brouillon) avec note normalisée
// /20 strictement inférieure à 10. Le seuil 10/20 normalisé est fiable quel
// que soit le barème de la matière (10, 20, 30, 50…) car le backend
// normalise systématiquement en /20 via normalized_value.
export function computeLacunes(subject_grades: StudentResult["subject_grades"]) {
  return subject_grades.filter(
    (sg) => sg.has_grade && !sg.is_draft && sg.normalized_value < 10,
  );
}
