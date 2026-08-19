"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Trophy,
  Loader2,
  TrendingUp,
  Users,
  Target,
  Award,
  ChevronDown,
  ChevronUp,
  Calendar,
  Medal,
  AlertCircle,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

import { sessionsApi, computationApi, reportsApi } from "@/lib/api";
import { monthLabel, SESSION_STATUS_CONFIG } from "@/lib/session-utils";
import { SyntheseDocument } from "./synthese-document";
import {
  MENTION_COLOR_CLASSES,
  type SessionResults,
  type StudentResult,
} from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function ResultsView() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [showSynthese, setShowSynthese] = useState(false);

  // Charger les sessions
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["sessions", "results-view"],
    queryFn: () => sessionsApi.list(),
  });

  const sessions = sessionsData?.sessions ?? [];

  // Auto-sélection : la session la plus récente
  const autoSessionId = selectedSessionId ?? sessions[0]?.id;
  const selectedSession = sessions.find((s) => s.id === autoSessionId);

  // Charger les résultats calculés
  const { data: results, isLoading: resultsLoading, error } = useQuery({
    queryKey: ["computation", "session", autoSessionId],
    queryFn: () => computationApi.getSessionResults(autoSessionId!),
    enabled: !!autoSessionId,
  });

  if (sessionsLoading) return <LoadingState message="Chargement des sessions…" />;

  if (sessions.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <Trophy className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm font-medium">Aucune session disponible</p>
          <p className="text-xs text-muted-foreground mt-1">
            Les résultats apparaîtront ici une fois qu'une session de saisie
            aura été créée.
          </p>
        </CardContent>
      </Card>
    );
  }

  const sessionCfg = selectedSession
    ? SESSION_STATUS_CONFIG[selectedSession.status as keyof typeof SESSION_STATUS_CONFIG]
    : null;

  // Afficher le document de synthèse si demandé
  if (showSynthese && autoSessionId) {
    return <SyntheseDocument sessionId={autoSessionId} onClose={() => setShowSynthese(false)} />;
  }

  // Si pas de session sélectionnée, ne pas afficher le bouton
  const canShowSynthese = !!autoSessionId;

  return (
    <div className="space-y-4">
      {/* En-tête + sélecteur */}
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Trophy className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Résultats & Classement</h2>
                <p className="text-xs text-muted-foreground">
                  Moyennes pondérées, rangs (ex-aequo inclus) et mentions
                  automatiques
                </p>
              </div>
            </div>
            {sessionCfg && selectedSession && canShowSynthese && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn("text-xs", sessionCfg.color)}>
                  {sessionCfg.label}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    console.log("Synthèse clicked, sessionId:", autoSessionId);
                    setShowSynthese(true);
                  }}
                >
                  <FileText className="w-4 h-4 mr-1.5" />
                  Synthèse PDF
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Session
            </label>
            <Select
              value={autoSessionId ?? ""}
              onValueChange={setSelectedSessionId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choisir une session…" />
              </SelectTrigger>
              <SelectContent>
                {sessions.map((s) => {
                  const c = SESSION_STATUS_CONFIG[s.status as keyof typeof SESSION_STATUS_CONFIG];
                  return (
                    <SelectItem key={s.id} value={s.id}>
                      {monthLabel(s.month)} {s.year} — {s.class_name} ({c.label})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {resultsLoading || !results ? (
        <LoadingState message="Calcul des moyennes et du classement…" />
      ) : error ? (
        <ErrorState message={(error as Error).message} />
      ) : (
        <>
          {/* Statistiques de classe */}
          <StatisticsGrid stats={results.statistics} averageScale={results.average_scale} />

          {/* Avertissement si notes en brouillon */}
          {results.results.some((r) => r.has_drafts) && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="py-3 flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <p className="text-sm text-amber-800">
                  Certaines notes sont encore en brouillon. Les résultats affichés
                  sont provisoires et seront définitifs après validation de la session.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Tableau de classement */}
          <Card className="border-border/60 overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Medal className="w-4 h-4 text-primary" />
                Classement — {monthLabel(results.month)} {results.year}
                <span className="text-xs font-normal text-muted-foreground">
                  ({results.class_name})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto scroll-sygren">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px]">Rang</TableHead>
                      <TableHead>Élève</TableHead>
                      <TableHead className="text-center">Moyenne</TableHead>
                      <TableHead>Mention</TableHead>
                      <TableHead className="text-center">Notes</TableHead>
                      <TableHead className="w-[40px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.results.map((r) => (
                      <StudentRow
                        key={r.student_id}
                        result={r}
                        expanded={expandedStudent === r.student_id}
                        averageScale={results.average_scale}
                        onToggle={() =>
                          setExpandedStudent(
                            expandedStudent === r.student_id ? null : r.student_id,
                          )
                        }
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Détail des matières pour l'élève expandé */}
          {expandedStudent && (
            <StudentDetailCard
              result={results.results.find(
                (r) => r.student_id === expandedStudent,
              )}
              averageScale={results.average_scale}
            />
          )}
        </>
      )}
    </div>
  );
}

// === Ligne d'élève dans le classement ===
function StudentRow({
  result,
  expanded,
  onToggle,
  averageScale = 20,
}: {
  result: StudentResult;
  expanded: boolean;
  onToggle: () => void;
  averageScale?: number;
}) {
  const mentionClass = MENTION_COLOR_CLASSES[result.mention_color] ?? "";
  const isTop = result.rank === 1 && result.has_average;
  const passThreshold = averageScale / 2; // 5 pour /10, 10 pour /20
  return (
    <>
      <TableRow
        className={cn(
          "cursor-pointer hover:bg-muted/40 transition-colors",
          expanded && "bg-muted/30",
          isTop && "bg-primary/[0.03]",
        )}
        onClick={onToggle}
      >
        <TableCell>
          <div className="flex items-center gap-1.5">
            {isTop ? (
              <Trophy className="w-4 h-4 text-primary" />
            ) : result.rank <= 3 && result.has_average ? (
              <Medal className="w-4 h-4 text-amber-500" />
            ) : null}
            <span className="font-semibold text-sm">{result.rank_label}</span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col">
            <span className="font-medium">
              {result.last_name} {result.first_name}
            </span>
            <span className="text-[11px] text-muted-foreground font-mono">
              {result.matricule}
            </span>
          </div>
        </TableCell>
        <TableCell className="text-center">
          {result.has_average ? (
            <span
              className={cn(
                "font-bold text-base",
                result.average >= passThreshold ? "text-emerald-600" : "text-amber-600",
              )}
            >
              {result.average.toFixed(2)}/{averageScale}
            </span>
          ) : (
            <span className="text-muted-foreground text-sm">—</span>
          )}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={cn("text-xs", mentionClass)}>
            {result.mention}
          </Badge>
        </TableCell>
        <TableCell className="text-center text-xs text-muted-foreground">
          {result.graded_count}/{result.total_subjects}
        </TableCell>
        <TableCell>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </TableCell>
      </TableRow>
    </>
  );
}

// === Carte de détail des matières d'un élève ===
function StudentDetailCard({
  result,
  averageScale = 20,
}: {
  result?: StudentResult;
  averageScale?: number;
}) {
  if (!result) return null;
  return (
    <Card className="border-border/60 animate-in-up">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Détail des notes — {result.last_name} {result.first_name}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {result.subject_grades.map((sg) => (
            <div
              key={sg.subject_id}
              className={cn(
                "flex items-center justify-between rounded-lg border p-2.5",
                sg.has_grade
                  ? sg.is_draft
                    ? "bg-amber-50/50 border-amber-200"
                    : "bg-card border-border"
                  : "bg-muted/30 border-dashed",
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{sg.subject_name}</p>
                <p className="text-[11px] text-muted-foreground">
                  coef. {sg.coefficient}
                  {sg.is_draft && " · brouillon"}
                </p>
              </div>
              <div className="text-right">
                {sg.has_grade ? (
                  <span
                    className={cn(
                      "font-bold text-sm",
                      sg.normalized_value >= (averageScale / 2)
                        ? "text-emerald-600"
                        : "text-amber-600",
                    )}
                  >
                    {sg.grade.toFixed(2)}/{sg.max_score}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-sm">—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// === Grille de statistiques de classe ===
function StatisticsGrid({
  stats,
  averageScale = 20,
}: {
  stats: SessionResults["statistics"];
  averageScale?: number;
}) {
  const passThreshold = averageScale / 2; // 5 pour /10, 10 pour /20
  const distinctionThreshold = (averageScale * 14) / 20; // 7 pour /10, 14 pour /20
  const items = [
    {
      label: "Moyenne de classe",
      value: stats.class_average > 0 ? `${stats.class_average.toFixed(2)}/${averageScale}` : "—",
      hint: "moyenne des moyennes",
      icon: <TrendingUp className="w-4 h-4" />,
      tone: "primary",
    },
    {
      label: "Meilleure moyenne",
      value: stats.max_average > 0 ? `${stats.max_average.toFixed(2)}/${averageScale}` : "—",
      hint: "max de la classe",
      icon: <Trophy className="w-4 h-4" />,
      tone: "emerald",
    },
    {
      label: "Moyenne la plus basse",
      value: stats.min_average > 0 ? `${stats.min_average.toFixed(2)}/${averageScale}` : "—",
      hint: "min de la classe",
      icon: <TrendingUp className="w-4 h-4 rotate-180" />,
      tone: "amber",
    },
    {
      label: "Médiane",
      value: stats.median_average > 0 ? `${stats.median_average.toFixed(2)}/${averageScale}` : "—",
      hint: "valeur centrale",
      icon: <Target className="w-4 h-4" />,
      tone: "slate",
    },
    {
      label: "Taux de réussite",
      value: `${stats.pass_rate.toFixed(0)}%`,
      hint: `élèves ≥ ${passThreshold}/${averageScale}`,
      icon: <Award className="w-4 h-4" />,
      tone: "emerald",
    },
    {
      label: "Taux de distinction",
      value: `${stats.distinction_rate.toFixed(0)}%`,
      hint: `élèves ≥ ${distinctionThreshold}/${averageScale}`,
      icon: <Medal className="w-4 h-4" />,
      tone: "primary",
    },
  ];
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((s) => (
        <Card key={s.label} className="border-border/60">
          <CardContent className="py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                {s.label}
              </span>
              <span
                className={cn(
                  s.tone === "primary" && "text-primary",
                  s.tone === "emerald" && "text-emerald-600",
                  s.tone === "amber" && "text-amber-600",
                  s.tone === "slate" && "text-muted-foreground",
                )}
              >
                {s.icon}
              </span>
            </div>
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.hint}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-10 text-center">
        <p className="text-sm text-destructive font-medium">
          Impossible de calculer les résultats
        </p>
        <p className="text-xs text-muted-foreground mt-1">{message}</p>
      </CardContent>
    </Card>
  );
}
