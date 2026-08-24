"use client";

// StudentDetailDialog — fenêtre modale riche de détail d'un élève pour le
// module Résultats. Ouverte par l'icône œil (Eye) devant chaque ligne du
// tableau results-view.
//
// Affiche, pour la session sélectionnée :
//   1. En-tête : nom, classe, matricule, label session (eval_type N°X — mois année)
//   2. Stats principales : Moyenne (colorée vs seuil), Rang, Mention, Notes saisies
//   3. Évolution vs session précédente : ▲/▼/= "ÉLÈVE EN PROGRESSION/RÉGRESSION/STABLE"
//      (mêmes libellés que le bulletin A5 — cohérence visuelle)
//   4. Notes par matière (table) : Matière, Note brute, /20 normalisé, Appréciation
//   5. Lacunes à combler : matières notées < 10/20 normalisé (seuil fiable quel
//      que soit le barème 10/20/30/50 — le backend normalise tout en /20)
//
// Données :
//   - student (StudentResult) : déjà en mémoire (React Query results-view) — 0 fetch
//   - évolution : fetchPreviousAverages (lib/evolution.ts) au 1er open, cached 5 min
//     par sessionId (la session précédente ne change pas en cours de session).
//   - Aucune requête supplémentaire à l'ouverture si l'élève est déjà filtré.

import { useQuery } from "@tanstack/react-query";
import {
  Eye,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  GraduationCap,
  Info,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/session-utils";
import {
  fetchPreviousAverages,
  computeEvolution,
  computeLacunes,
  normalizeTo20,
  type EvolutionData,
} from "@/lib/evolution";
import {
  MENTION_COLOR_CLASSES,
  type EvaluationSession,
  type StudentResult,
} from "@/lib/types";

// === Appréciation par matière (seuils FR/CI standard sur /20) ===
// Reçoit une valeur DÉJÀ convertie en /20 via normalizeTo20() — sinon les
// élèves CP/CE (échelle /10) verraient toutes leurs matières en "Insuffisant"
// car leurs notes /10 sont toutes < 10.
function subjectAppreciation(
  norm20: number,
  hasGrade: boolean,
): { text: string; tone: string } {
  if (!hasGrade) return { text: "Non évalué", tone: "text-muted-foreground" };
  if (norm20 >= 16) return { text: "Excellent", tone: "text-emerald-600" };
  if (norm20 >= 14) return { text: "Très Bien", tone: "text-emerald-600" };
  if (norm20 >= 12) return { text: "Bien", tone: "text-emerald-600" };
  if (norm20 >= 10) return { text: "Passable", tone: "text-amber-600" };
  return { text: "Insuffisant", tone: "text-rose-600" };
}

function sessionLabel(s: EvaluationSession | undefined | null): string {
  if (!s) return "Session";
  return `${s.eval_type} N°${s.eval_number} — ${monthLabel(s.month)} ${s.year}`;
}

// === Bandeau d'évolution (▲/▼/=) — mêmes libellés que le bulletin A5 ===
function EvolutionBanner({
  evo,
  previousSession,
  loading,
}: {
  evo: EvolutionData;
  previousSession: EvaluationSession | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Info className="w-4 h-4 animate-pulse" />
        Calcul de l&apos;évolution vs session précédente…
      </div>
    );
  }
  if (evo.kind === "none") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Info className="w-4 h-4" />
        Évolution indisponible — 1re session du type, ou aucune session
        précédente comparable (même école, même année scolaire).
      </div>
    );
  }
  const prevLabel = sessionLabel(previousSession);
  const sign = evo.delta > 0 ? "+" : "";
  // Couleurs et icônes selon le kind
  const cfg = {
    progression: {
      icon: TrendingUp,
      color: "text-emerald-600",
      bg: "bg-emerald-50 border-emerald-200",
      label: "ÉLÈVE EN PROGRESSION",
    },
    regression: {
      icon: TrendingDown,
      color: "text-rose-600",
      bg: "bg-rose-50 border-rose-200",
      label: "ÉLÈVE EN RÉGRESSION",
    },
    stable: {
      icon: Minus,
      color: "text-zinc-600",
      bg: "bg-zinc-50 border-zinc-200",
      label: "ÉLÈVE STABLE",
    },
  }[evo.kind];
  const Icon = cfg.icon;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2", cfg.bg)}>
      <Icon className={cn("w-4 h-4", cfg.color)} />
      <span className={cn("font-semibold text-sm", cfg.color)}>{cfg.label}</span>
      <span className="text-sm text-muted-foreground">
        {sign}
        {evo.delta.toFixed(2)} pts
      </span>
      <span className="text-xs text-muted-foreground">
        vs {prevLabel} : {evo.previousAvg.toFixed(2)}/{evo.previousScale}
      </span>
    </div>
  );
}

// === Carte statistique compacte ===
function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn("text-base font-bold mt-0.5", valueClass)}>{value}</p>
    </div>
  );
}

export function StudentDetailDialog({
  student,
  session,
  open,
  onOpenChange,
}: {
  student: StudentResult | null;
  session: EvaluationSession | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const sessionId = session?.id;

  // Fetch paresseux de la session précédente (uniquement quand le dialog
  // s'ouvre). Cached 5 min par sessionId — la session précédente ne change
  // pas pendant qu'on consulte les résultats de la session courante.
  const { data: prev, isLoading: prevLoading } = useQuery({
    queryKey: ["evolution", sessionId],
    queryFn: () =>
      sessionId ? fetchPreviousAverages(sessionId) : Promise.resolve(null),
    enabled: !!sessionId && open,
    staleTime: 5 * 60 * 1000,
  });

  // Évolution calculée côté client (formule dans lib/evolution.ts).
  const evo: EvolutionData =
    prev && student ? computeEvolution(student, prev.averages) : (null as unknown as EvolutionData);

  // Si pas d'élève, on ne rend rien (le Dialog reste fermé côté parent).
  if (!student) return null;

  const scale = student.average_scale ?? 20;
  const passThreshold = scale / 2; // 5 pour /10, 10 pour /20
  const mentionClass =
    MENTION_COLOR_CLASSES[student.mention_color] ?? "";
  const lacunes = computeLacunes(student.subject_grades, scale);
  const hasLacunes = lacunes.length > 0;

  // Étiquette pour "previousSession" (peut être null si Map vide)
  const previousSession = prev?.previousSession ?? null;
  // evo peut être null si prev n'est pas encore chargé — on gère le cas
  const evoResolved: EvolutionData = evo ?? {
    kind: "none",
    delta: 0,
    previousAvg: 0,
    previousScale: 20,
    currentAvg20: 0,
    previousAvg20: 0,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            Détail de l&apos;élève
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            <span className="font-medium text-foreground">
              {student.last_name} {student.first_name}
            </span>
            {student.class_name && (
              <>
                {" · "}
                <span className="inline-flex items-center gap-0.5">
                  <GraduationCap className="w-3 h-3" />
                  {student.class_name}
                </span>
              </>
            )}
            {" · "}
            <span className="font-mono">Matricule {student.matricule || "—"}</span>
            {" · "}
            <span>{sessionLabel(session)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* === Stats principales === */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatCard
              label="Moyenne"
              value={
                student.has_average
                  ? `${student.average.toFixed(2)}/${scale}`
                  : "—"
              }
              valueClass={
                student.has_average
                  ? student.average >= passThreshold
                    ? "text-emerald-600"
                    : "text-amber-600"
                  : "text-muted-foreground"
              }
            />
            <StatCard label="Rang" value={student.rank_label || "—"} />
            <StatCard
              label="Mention"
              value={student.mention || "—"}
              valueClass={mentionClass || undefined}
            />
            <StatCard
              label="Notes saisies"
              value={`${student.graded_count}/${student.total_subjects}`}
            />
          </div>

          {/* === Évolution vs session précédente === */}
          <EvolutionBanner
            evo={evoResolved}
            previousSession={previousSession}
            loading={prevLoading}
          />

          {/* === Notes par matière === */}
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-muted-foreground" />
              Notes par matière
            </h3>
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Matière</TableHead>
                    <TableHead className="text-center w-[80px]">Note</TableHead>
                    <TableHead className="text-center w-[80px]">/20 norm.</TableHead>
                    <TableHead className="text-center w-[110px]">Appréciation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {student.subject_grades.map((sg) => {
                    // Conversion en /20 pour seuils d'appréciation + couleur
                    // (normalized_value est sur l'échelle de l'élève, pas /20).
                    const norm20 = normalizeTo20(sg.normalized_value, scale);
                    const appr = subjectAppreciation(norm20, sg.has_grade);
                    return (
                      <TableRow key={sg.subject_id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {sg.subject_name}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              coef. {sg.coefficient}
                              {sg.is_draft && " · brouillon"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center text-sm">
                          {sg.has_grade ? (
                            <span
                              className={cn(
                                "font-semibold",
                                norm20 >= 10
                                  ? "text-emerald-600"
                                  : "text-rose-600",
                              )}
                            >
                              {sg.grade.toFixed(2)}/{sg.max_score}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-sm font-mono">
                          {sg.has_grade ? (
                            norm20.toFixed(2)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={cn("text-xs font-medium", appr.tone)}>
                            {appr.text}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* === Lacunes à combler === */}
          <Card
            className={cn(
              "border",
              hasLacunes
                ? "border-amber-200 bg-amber-50/40"
                : "border-emerald-200 bg-emerald-50/40",
            )}
          >
            <CardContent className="py-3 space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <AlertTriangle
                  className={cn(
                    "w-3.5 h-3.5",
                    hasLacunes ? "text-amber-600" : "text-emerald-600",
                  )}
                />
                Lacunes à combler
                <span className="text-xs text-muted-foreground font-normal">
                  (matières &lt; {scale / 2}/{scale})
                </span>
              </h3>
              {hasLacunes ? (
                <ul className="space-y-1">
                  {lacunes.map((sg) => (
                    <li
                      key={sg.subject_id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="font-medium">
                        {sg.subject_name}
                        <span className="text-muted-foreground font-normal ml-1">
                          (coef. {sg.coefficient})
                        </span>
                      </span>
                      <span className="text-rose-600 font-mono font-semibold">
                        {sg.normalized_value.toFixed(2)}/20
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Aucune lacune — toutes les matières notées sont ≥ {scale / 2}/{scale}.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
