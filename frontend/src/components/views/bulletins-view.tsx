"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Loader2,
  Printer,
  Calendar,
  Trophy,
  AlertCircle,
  Users,
  School as SchoolIcon,
} from "lucide-react";

import { sessionsApi, computationApi, schoolsApi, reportsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { monthLabel, SESSION_STATUS_CONFIG } from "@/lib/session-utils";
import {
  MENTION_COLOR_CLASSES,
  type SessionWithDetails,
} from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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

// === Module Bulletins — impression A5 (modèle officiel CI) ===
//
// Depuis la refonte du module, l'impression se fait exclusivement via le
// bulletin A5 paysage (2 bulletins/page A4) rendu par le navigateur —
// l'ancienne génération PDF fpdf (Générer / Régénérer / Générer tous,
// archivage backend + téléchargement) a été retirée sur demande
// utilisateur. Les endpoints backend /api/report-cards restent
// disponibles mais ne sont plus utilisés par le frontend.

interface MergedStudent {
  student_id: string;
  student_name: string;
  student_matricule: string;
  average: number;
  has_average: boolean;
  rank: number;
  rank_label: string;
  mention: string;
  mention_color: string;
  has_drafts: boolean;
}

export function BulletinsView() {
  const user = useAuthStore((s) => s.user);
  const canPrint = user?.role === "admin" || user?.role === "director";
  // Cascade stricte (même logique que students-view et results-view)
  // - admin/inspector : doivent choisir une école → puis une session
  // - director/teacher : école figée (RBAC backend) → choisissent une session
  const isAdmin = user?.role === "admin";
  const isInspector = user?.role === "inspector";
  const needsSchoolSelect = isAdmin || isInspector;

  // === Cascade : École → Session ===
  const [schoolFilter, setSchoolFilter] = useState<string>(
    needsSchoolSelect ? "" : (user?.school_id ?? ""),
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  // Classe cible pour l'impression : "all" = TOUTES les classes (défaut,
  // comportement historique), sinon l'ID d'une classe précise.
  const [classFilter, setClassFilter] = useState<string>("all");
  const hasSchoolSelected = schoolFilter !== "" && schoolFilter !== "all";

  // Charger les écoles (admin/inspector seulement)
  const { data: schoolsData } = useQuery({
    queryKey: ["schools", "bulletins-filter"],
    queryFn: () => schoolsApi.list(),
    enabled: needsSchoolSelect,
  });

  // Charger les sessions : filtrées par école (cascade stricte)
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["sessions", "bulletins-view", schoolFilter],
    queryFn: () =>
      sessionsApi.list(
        hasSchoolSelected ? { school_id: schoolFilter } : undefined,
      ),
    enabled: hasSchoolSelected,
  });

  const sessions = sessionsData?.sessions ?? [];
  const schools = schoolsData?.schools ?? [];
  // Cascade stricte : PAS d'auto-sélection. L'utilisateur doit choisir.
  const autoSessionId = selectedSessionId;
  const selectedSession = sessions.find((s) => s.id === autoSessionId);

  const { data: resultsData, isLoading: resultsLoading } = useQuery({
    queryKey: ["computation", "session", autoSessionId],
    queryFn: () => computationApi.getSessionResults(autoSessionId!),
    enabled: !!autoSessionId,
  });

  // Classes de la session (pour le sélecteur d'impression par classe +
  // le statut exempté). "" = TOUTES.
  const { data: releveClassesData } = useQuery({
    queryKey: ["releve-classes", autoSessionId],
    queryFn: () => reportsApi.listReleveClasses(autoSessionId!),
    enabled: !!autoSessionId,
  });
  const releveClasses = releveClassesData?.classes ?? [];

  // États de la cascade stricte
  const waitingForSchool = needsSchoolSelect && !hasSchoolSelected;
  const waitingForSession = hasSchoolSelected && !autoSessionId;

  // Aperçu des élèves avant impression (résultats de la session).
  // Le filtre Classe s'applique AUSSI à l'aperçu et à la carte « prêts » :
  // « Toutes » = tous les élèves, sinon uniquement ceux de la classe
  // choisie (chaque StudentResult porte son class_id).
  const mergedStudents: MergedStudent[] = (resultsData?.results ?? [])
    .filter((r) => classFilter === "all" || r.class_id === classFilter)
    .map((r) => ({
      student_id: r.student_id,
      student_name: `${r.last_name} ${r.first_name}`,
      student_matricule: r.matricule,
      average: r.average,
      has_average: r.has_average,
      rank: r.rank,
      rank_label: r.rank_label,
      mention: r.mention,
      mention_color: r.mention_color,
      has_drafts: r.has_drafts,
    }));

  const readyCount = mergedStudents.filter((s) => s.has_average).length;
  const totalCount = mergedStudents.length;
  const readyPercent =
    totalCount > 0 ? (readyCount / totalCount) * 100 : 0;

  if (sessionsLoading && hasSchoolSelected) {
    return <LoadingState message="Chargement des sessions…" />;
  }

  const sessionCfg = selectedSession
    ? SESSION_STATUS_CONFIG[
        selectedSession.status as keyof typeof SESSION_STATUS_CONFIG
      ]
    : null;

  return (
    <div className="space-y-4">
      {/* En-tête + sélecteur */}
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Bulletins</h2>
                <p className="text-xs text-muted-foreground">
                  {waitingForSchool
                    ? "Sélectionnez une école pour commencer"
                    : waitingForSession
                      ? "Sélectionnez une session pour imprimer les bulletins"
                      : "Impression A5 — modèle officiel, 2 bulletins par page A4 paysage"}
                </p>
              </div>
            </div>
            {canPrint && selectedSession && (
              <Button
                className="shadow-sm"
                onClick={() => {
                  let token = "";
                  try {
                    const raw = localStorage.getItem("sygren-auth");
                    if (raw) token = JSON.parse(raw)?.state?.token ?? "";
                  } catch {}
                  const classParam = classFilter !== "all" ? `&class_id=${classFilter}` : "";
                  const url = `${window.location.origin}/bulletins?session_id=${selectedSession.id}${classParam}&t=${encodeURIComponent(token)}`;
                  window.open(url, "_blank");
                }}
              >
                <Printer className="w-4 h-4 mr-1.5" />
                {classFilter !== "all"
                  ? `Imprimer — ${releveClasses.find((c) => c.id === classFilter)?.name ?? "classe"}`
                  : "Imprimer les bulletins (A5)"}
              </Button>
            )}
          </div>

          {/* === Cascade stricte : École → Session === */}
          <div className="flex flex-wrap items-end gap-3">
            {/* Filtre École */}
            {needsSchoolSelect ? (
              <div className="space-y-1.5 min-w-[180px] flex-1 max-w-[300px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <SchoolIcon className="w-3 h-3" /> École
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
              <div className="space-y-1.5 min-w-[180px] flex-1 max-w-[300px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <SchoolIcon className="w-3 h-3" /> École
                </label>
                <Input
                  value={schools.find((s) => s.id === user?.school_id)?.name ?? "Mon école"}
                  disabled
                  className="bg-muted/50 text-muted-foreground"
                />
              </div>
            )}

            {/* Filtre Session (désactivé tant que pas d'école) */}
            <div className="space-y-1.5 min-w-[220px] flex-1 max-w-[360px] min-w-0">
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
                  {sessions.map((s: SessionWithDetails) => {
                    const c =
                      SESSION_STATUS_CONFIG[
                        s.status as keyof typeof SESSION_STATUS_CONFIG
                      ];
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        {monthLabel(s.month)} {s.year} — {s.school_name ?? s.class_name ?? "École"} ({c.label})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Filtre Classe (impression ciblée) — apparaît une fois la
                session choisie. "" = TOUTES les classes (défaut).
                Les classes exemptées sont visibles mais non
                sélectionnables (disabled + libellé). */}
            {selectedSession && (
              <div className="space-y-1.5 min-w-[200px] flex-1 max-w-[300px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Users className="w-3 h-3" /> Classe
                </label>
                <Select value={classFilter} onValueChange={setClassFilter}>
                  <SelectTrigger className="w-full overflow-hidden">
                    <SelectValue placeholder="Toutes les classes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les classes</SelectItem>
                    {releveClasses.map((c) => (
                      <SelectItem
                        key={c.id}
                        value={c.id}
                        disabled={c.exempted}
                      >
                        {c.name} ({c.student_count} élève{c.student_count > 1 ? "s" : ""})
                        {c.exempted ? " — Exemptée" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* === États vides de la cascade stricte === */}
      {waitingForSchool ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-12 text-center">
            <SchoolIcon className="w-8 h-8 mx-auto mb-3 text-primary/50" />
            <p className="text-sm font-medium text-foreground">
              Sélectionnez une école pour afficher les sessions
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Choisissez une école dans le filtre ci-dessus — les sessions
              disponibles s&apos;afficheront automatiquement.
            </p>
          </CardContent>
        </Card>
      ) : waitingForSession ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-12 text-center">
            <Calendar className="w-8 h-8 mx-auto mb-3 text-primary/50" />
            <p className="text-sm font-medium text-foreground">
              Sélectionnez une session pour imprimer les bulletins
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {sessions.length > 0
                ? `${sessions.length} session(s) disponible(s) — choisissez-en une dans le filtre ci-dessus.`
                : "Aucune session n'a été créée pour cette école. Créez une session dans le module Évaluations."}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Préparation d'impression */}
      {selectedSession && (
        <Card className="border-border/60">
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">
                    {readyCount}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    prêts (moyenne calculée)
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-muted-foreground">
                    {totalCount}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    élèves
                  </p>
                </div>
                {sessionCfg && (
                  <Badge variant="outline" className="text-xs">
                    {sessionCfg.label}
                  </Badge>
                )}
              </div>
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-muted-foreground">
                    Préparation de l&apos;impression
                  </span>
                  <span className="font-medium">
                    {readyPercent.toFixed(0)}%
                  </span>
                </div>
                <Progress value={readyPercent} className="h-2" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Avertissement si notes en brouillon */}
      {resultsData?.results.some((r) => r.has_drafts) && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800">
              Certaines notes sont encore en brouillon. Les bulletins
              imprimés seront provisoires. Validez la session pour des
              bulletins définitifs.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Aperçu des élèves (seulement si session sélectionnée — cascade) */}
      {selectedSession && (
        resultsLoading ? (
          <LoadingState message="Calcul des résultats…" />
        ) : mergedStudents.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <p className="text-sm">
                {classFilter !== "all"
                  ? "Aucun élève dans cette classe pour cette session."
                  : "Aucun élève dans cette session."}
              </p>
            </CardContent>
          </Card>
        ) : (
        <Card className="border-border/60 overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto scroll-sygren">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rang</TableHead>
                    <TableHead>Élève</TableHead>
                    <TableHead className="text-center">Moyenne</TableHead>
                    <TableHead>Mention</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mergedStudents.map((s) => {
                    const mentionClass =
                      MENTION_COLOR_CLASSES[s.mention_color] ?? "";
                    return (
                      <TableRow key={s.student_id} className="hover:bg-muted/40">
                        <TableCell>
                          {s.rank > 0 ? (
                            <span className="flex items-center gap-1">
                              {s.rank === 1 && (
                                <Trophy className="w-3.5 h-3.5 text-primary" />
                              )}
                              <span className="font-medium text-sm">
                                {s.rank_label}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {s.student_name}
                            </span>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {s.student_matricule}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {s.has_average ? (
                            <span
                              className={cn(
                                "font-bold text-base",
                                s.average >= 10
                                  ? "text-emerald-600"
                                  : "text-amber-600",
                              )}
                            >
                              {s.average.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn("text-xs", mentionClass)}
                          >
                            {s.mention}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
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
