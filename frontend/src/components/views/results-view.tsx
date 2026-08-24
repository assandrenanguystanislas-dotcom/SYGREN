"use client";

import { useMemo, useState } from "react";
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
  School,
  GraduationCap,
  ShieldOff,
  Search,
  FileSpreadsheet,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

import { sessionsApi, computationApi, reportsApi, schoolsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { monthLabel, SESSION_STATUS_CONFIG } from "@/lib/session-utils";
import { SyntheseDocument } from "./synthese-document";
import { StudentAnnualCard } from "./student-annual-card";
import { StudentDetailDialog } from "./student-detail-dialog";
import {
  MENTION_COLOR_CLASSES,
  type SessionResults,
  type StudentResult,
} from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const user = useAuthStore((s) => s.user);
  // Rôles pour la cascade stricte (même logique que students-view)
  // - admin/inspector : doivent choisir une école → puis une session → résultats
  // - director/teacher : école figée (RBAC backend) → choisissent une session → résultats
  const isAdmin = user?.role === "admin";
  const isInspector = user?.role === "inspector";
  const isDirector = user?.role === "director";
  const isTeacher = user?.role === "teacher";
  // admin et inspector doivent choisir une école (cascade stricte)
  const needsSchoolSelect = isAdmin || isInspector;

  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  // Élève dont le Dialog de détail (œil) est ouvert. StudentResult déjà en
  // mémoire via React Query — 0 fetch supplémentaire à l'ouverture.
  const [detailStudent, setDetailStudent] = useState<StudentResult | null>(null);
  const [showSynthese, setShowSynthese] = useState(false);
  // === Deux documents de synthèse (cahier des charges) ===
  const [syntheseLevelGroup, setSyntheseLevelGroup] = useState<"primary" | "cm2">("primary");

  // === Cascade stricte : École → Session → Classe ===
  // - admin/inspector : schoolFilter démarre à "" (vide) → doit choisir
  // - director/teacher : schoolFilter = user.school_id (figé, RBAC backend)
  const [schoolFilter, setSchoolFilter] = useState<string>(
    needsSchoolSelect ? "" : (user?.school_id ?? ""),
  );
  const [classFilter, setClassFilter] = useState<string>("all");

  // hasSchoolSelected : true si une école est choisie (admin/inspector) ou si
  // director/teacher ont toujours leur école (RBAC implicite)
  const hasSchoolSelected = schoolFilter !== "" && schoolFilter !== "all";

  // Charger les écoles pour le filtre (admin/inspector seulement — director/
  // teacher ont leur école figée, pas besoin de la liste)
  const { data: schoolsData } = useQuery({
    queryKey: ["schools", "results-filter"],
    queryFn: () => schoolsApi.list(),
    enabled: needsSchoolSelect,
  });

  // Charger les sessions : filtrées par école (cascade stricte — ne se charge
  // que si une école est sélectionnée). Pour director/teacher, le backend
  // filtre déjà par school_id (RBAC), donc on peut charger directement.
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["sessions", "results-view", schoolFilter],
    queryFn: () =>
      sessionsApi.list(
        hasSchoolSelected ? { school_id: schoolFilter } : undefined,
      ),
    enabled: hasSchoolSelected,
  });

  const sessions = sessionsData?.sessions ?? [];
  const schools = schoolsData?.schools ?? [];

  // Cascade stricte : PAS d'auto-sélection de session.
  // L'utilisateur doit explicitement choisir une session dans le select.
  const autoSessionId = selectedSessionId;
  const selectedSession = sessions.find((s) => s.id === autoSessionId);

  // Charger les résultats : seulement si une session est explicitement choisie
  const { data: results, isLoading: resultsLoading, error } = useQuery({
    queryKey: ["computation", "session", autoSessionId],
    queryFn: () => computationApi.getSessionResults(autoSessionId!),
    enabled: !!autoSessionId,
  });

  // Filtrer les résultats par classe si classFilter sélectionné.
  const filteredResults = useMemo(() => {
    if (!results) return [];
    if (classFilter === "all") return results.results;
    return results.results.filter((r) => r.class_id === classFilter);
  }, [results, classFilter]);

  // Liste des classes présentes dans les résultats (pour le select classe)
  const classesInResults = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of results?.results ?? []) {
      if (r.class_id && r.class_name && !seen.has(r.class_id)) {
        seen.set(r.class_id, r.class_name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [results]);

  // États de la cascade stricte :
  // - waitingForSchool : admin/inspector n'a pas encore choisi d'école
  // - waitingForSession : école choisie mais pas de session sélectionnée
  const waitingForSchool = needsSchoolSelect && !hasSchoolSelected;
  const waitingForSession = hasSchoolSelected && !autoSessionId;

  const sessionCfg = selectedSession
    ? SESSION_STATUS_CONFIG[selectedSession.status as keyof typeof SESSION_STATUS_CONFIG]
    : null;

  // Afficher le document de synthèse si demandé
  if (showSynthese && autoSessionId) {
    return (
      <SyntheseDocument
        sessionId={autoSessionId}
        levelGroup={syntheseLevelGroup}
        onClose={() => setShowSynthese(false)}
      />
    );
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
                  {waitingForSchool
                    ? "Sélectionnez une école pour commencer"
                    : waitingForSession
                      ? "Sélectionnez une session pour voir les résultats"
                      : "Moyennes pondérées, rangs par classe (ex-aequo inclus) et mentions automatiques"}
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
                    let token = "";
                    try {
                      const raw = localStorage.getItem("sygren-auth");
                      if (raw) token = JSON.parse(raw)?.state?.token ?? "";
                    } catch {}
                    const url = `${window.location.origin}/synthese/batch?session_id=${autoSessionId}&t=${encodeURIComponent(token)}`;
                    window.open(url, "_blank");
                  }}
                >
                  <FileText className="w-4 h-4 mr-1.5" />
                  Synthèses PDF
                </Button>
                {/* === Relevés PDF — Toutes les classes de la session ===
                    Ouvre /releve/batch?session_id=... dans un nouvel onglet.
                    L'utilisateur sélectionne les classes (checkboxes) puis imprime :
                    un PDF par classe (iframes séquentiels + onafterprint).
                    Remplace l'ancien bouton "Relevé PDF" qui exigeait de filtrer
                    une classe précise — la page batch gère le single ET le bulk
                    (sélection d'1 seule classe possible). Visible dès qu'une
                    session est sélectionnée (pas de classe à filtrer d'abord). */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    let token = "";
                    try {
                      const raw = localStorage.getItem("sygren-auth");
                      if (raw) token = JSON.parse(raw)?.state?.token ?? "";
                    } catch {}
                    const url = `${window.location.origin}/releve/batch?session_id=${autoSessionId}&t=${encodeURIComponent(token)}`;
                    window.open(url, "_blank");
                  }}
                >
                  <FileSpreadsheet className="w-4 h-4 mr-1.5" />
                  Relevés PDF
                </Button>
              </div>
            )}
          </div>

          {/* === Cascade stricte : École → Session → Classe ===
              - admin/inspector : École (vide au départ) → Session (désactivé
                tant que pas d'école) → Classe (désactivé tant que pas de session)
              - director/teacher : École figée → Session actif → Classe cascade */}
          <div className="flex flex-wrap items-end gap-3">
            {/* Filtre École */}
            {needsSchoolSelect ? (
              <div className="space-y-1.5 min-w-[180px] flex-1 max-w-[280px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <School className="w-3 h-3" /> École
                </label>
                <Select value={schoolFilter} onValueChange={(v) => {
                  setSchoolFilter(v);
                  setSelectedSessionId(undefined);
                  setClassFilter("all");
                }}>
                  <SelectTrigger className="w-full overflow-hidden">
                    <SelectValue placeholder="Choisir une école…" />
                  </SelectTrigger>
                  <SelectContent>
                    {schools.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5 min-w-[180px] flex-1 max-w-[280px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <School className="w-3 h-3" /> École
                </label>
                <Input
                  value={schools.find((s) => s.id === user?.school_id)?.name ?? "Mon école"}
                  disabled
                  className="bg-muted/50 text-muted-foreground"
                />
              </div>
            )}

            {/* Filtre Session (désactivé tant que pas d'école) */}
            <div className="space-y-1.5 min-w-[220px] flex-1 max-w-[340px] min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Session
              </label>
              <Select
                value={autoSessionId ?? ""}
                onValueChange={(v) => {
                  setSelectedSessionId(v);
                  setClassFilter("all");
                }}
                disabled={!hasSchoolSelected || sessions.length === 0}
              >
                <SelectTrigger className="w-full overflow-hidden">
                  <SelectValue
                    placeholder={
                      !hasSchoolSelected
                        ? "Choisir une école d'abord"
                        : sessions.length === 0
                          ? "Aucune session"
                          : "Choisir une session…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => {
                    const c = SESSION_STATUS_CONFIG[s.status as keyof typeof SESSION_STATUS_CONFIG];
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        {monthLabel(s.month)} {s.year} — {s.school_name ?? "École"} ({c.label})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Filtre Classe (désactivé tant que pas de session / pas de résultats) */}
            <div className="space-y-1.5 min-w-[140px] flex-1 max-w-[180px] min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <GraduationCap className="w-3 h-3" /> Classe
              </label>
              <Select
                value={classFilter}
                onValueChange={setClassFilter}
                disabled={!autoSessionId || classesInResults.length === 0}
              >
                <SelectTrigger className="w-full overflow-hidden">
                  <SelectValue
                    placeholder={
                      !autoSessionId
                        ? "Choisir une session d'abord"
                        : "Toutes les classes"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les classes</SelectItem>
                  {classesInResults.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Indicateur si filtration active */}
          {classFilter !== "all" && results && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <ShieldOff className="w-3 h-3" />
              Filtrage par classe — {filteredResults.length} élève(s) affiché(s).
              Le classement est calculé par classe côté serveur.
            </div>
          )}
        </CardContent>
      </Card>

      {/* === États vides de la cascade stricte === */}
      {waitingForSchool ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-12 text-center">
            <School className="w-8 h-8 mx-auto mb-3 text-primary/50" />
            <p className="text-sm font-medium text-foreground">
              Sélectionnez une école pour afficher les sessions
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Choisissez une école dans le filtre ci-dessus — les sessions et
              résultats associés s&apos;afficheront automatiquement.
            </p>
          </CardContent>
        </Card>
      ) : waitingForSession ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-12 text-center">
            <Calendar className="w-8 h-8 mx-auto mb-3 text-primary/50" />
            <p className="text-sm font-medium text-foreground">
              Sélectionnez une session pour voir les résultats
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {sessions.length > 0
                ? `${sessions.length} session(s) disponible(s) — choisissez-en une dans le filtre ci-dessus.`
                : "Aucune session n'a été créée pour cette école. Créez une session dans le module Évaluations."}
            </p>
          </CardContent>
        </Card>
      ) : resultsLoading || !results ? (
        <LoadingState message="Calcul des moyennes et du classement…" />
      ) : error ? (
        <ErrorState message={(error as Error).message} />
      ) : (
        <>
          {/* Statistiques agrégées (toutes classes confondues — Approche A) */}
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
                  ({results.school_name || "École inconnue"}
                  {classFilter !== "all" && classesInResults.find((c) => c.id === classFilter)
                    ? ` · ${classesInResults.find((c) => c.id === classFilter)?.name}`
                    : " · toutes classes"}
                  )
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
                      <TableHead className="w-[72px] text-center">
                        <span className="sr-only">Détail élève</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredResults.map((r) => (
                      <StudentRow
                        key={r.student_id}
                        result={r}
                        expanded={expandedStudent === r.student_id}
                        averageScale={r.average_scale ?? results.average_scale}
                        onToggle={() =>
                          setExpandedStudent(
                            expandedStudent === r.student_id ? null : r.student_id,
                          )
                        }
                        onEyeClick={() => setDetailStudent(r)}
                      />
                    ))}
                    {filteredResults.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                          Aucun élève pour ce filtre.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Détail des matières pour l'élève expandé */}
          {expandedStudent && (
            <div className="space-y-4">
              <StudentDetailCard
                result={results.results.find(
                  (r) => r.student_id === expandedStudent,
                )}
                averageScale={
                  results.results.find((r) => r.student_id === expandedStudent)?.average_scale
                  ?? results.average_scale
                }
              />
              {/* Bilan annuel de l'élève */}
              {(() => {
                const r = results.results.find((r) => r.student_id === expandedStudent);
                return r ? (
                  <StudentAnnualCard
                    studentId={r.student_id}
                    studentName={`${r.last_name} ${r.first_name}`}
                    classLevel={r.class_level}
                    averageScale={r.average_scale ?? results.average_scale}
                  />
                ) : null;
              })()}
            </div>
          )}
        </>
      )}

      {/* === Dialog détail élève (œil) ===
          Ouvert par l'icône Eye dans la colonne d'action de chaque ligne.
          Affiche : stats (moyenne/rang/mention) + évolution vs session
          précédente + notes par matière + lacunes à combler. */}
      <StudentDetailDialog
        student={detailStudent}
        session={selectedSession}
        open={detailStudent !== null}
        onOpenChange={(v) => {
          if (!v) setDetailStudent(null);
        }}
      />
    </div>
  );
}

// === Ligne d'élève dans le classement ===
function StudentRow({
  result,
  expanded,
  onToggle,
  onEyeClick,
  averageScale = 20,
}: {
  result: StudentResult;
  expanded: boolean;
  onToggle: () => void;
  onEyeClick: () => void;
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
            <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1.5">
              {result.matricule}
              {result.class_name && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted text-[10px]">
                  <GraduationCap className="w-2.5 h-2.5" />
                  {result.class_name}
                </span>
              )}
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
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEyeClick();
              }}
              className="p-1 rounded text-primary hover:bg-primary/10 transition-colors"
              aria-label={`Voir le détail de ${result.last_name} ${result.first_name}`}
              title="Détail de l'élève"
            >
              <Eye className="w-4 h-4" />
            </button>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
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
