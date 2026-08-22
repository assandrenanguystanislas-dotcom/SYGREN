"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  Loader2,
  Download,
  FileCheck2,
  FileX2,
  RefreshCw,
  Files,
  Calendar,
  Trophy,
  AlertCircle,
  Printer,
  School as SchoolIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  sessionsApi,
  computationApi,
  reportCardsApi,
  schoolsApi,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { monthLabel, SESSION_STATUS_CONFIG } from "@/lib/session-utils";
import {
  MENTION_COLOR_CLASSES,
  type SessionWithDetails,
  type SessionResults,
  type ReportCardWithStudent,
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
  report_card?: ReportCardWithStudent;
  has_bulletin: boolean;
}

export function BulletinsView() {
  const user = useAuthStore((s) => s.user);
  const canGenerate = user?.role === "admin" || user?.role === "director";
  // Cascade stricte (même logique que students-view et results-view)
  // - admin/inspector : doivent choisir une école → puis une session
  // - director/teacher : école figée (RBAC backend) → choisissent une session
  const isAdmin = user?.role === "admin";
  const isInspector = user?.role === "inspector";
  const needsSchoolSelect = isAdmin || isInspector;
  const queryClient = useQueryClient();

  // === Cascade : École → Session ===
  const [schoolFilter, setSchoolFilter] = useState<string>(
    needsSchoolSelect ? "" : (user?.school_id ?? ""),
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
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

  const { data: reportCardsData } = useQuery({
    queryKey: ["report-cards", autoSessionId],
    queryFn: () => reportCardsApi.list(autoSessionId!),
    enabled: !!autoSessionId,
  });

  // États de la cascade stricte
  const waitingForSchool = needsSchoolSelect && !hasSchoolSelected;
  const waitingForSession = hasSchoolSelected && !autoSessionId;

  // Mutation : générer un bulletin individuel
  const generateMut = useMutation({
    mutationFn: ({ sessionId, studentId }: { sessionId: string; studentId: string }) =>
      reportCardsApi.generate(sessionId, studentId),
    onSuccess: async (_, vars) => {
      toast.success("Bulletin généré avec succès");
      await queryClient.invalidateQueries({
        queryKey: ["report-cards", vars.sessionId],
      });
    },
    onError: (e) => {
      toast.error("Échec de la génération", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      });
    },
  });

  // Mutation : générer en lot
  const generateBatchMut = useMutation({
    mutationFn: (sessionId: string) => reportCardsApi.generateBatch(sessionId),
    onSuccess: async (data, sessionId) => {
      toast.success(
        `${data.generated}/${data.total} bulletins générés`,
        {
          description:
            data.failed > 0
              ? `${data.failed} échec(s) — voir les détails`
              : "Tous les bulletins ont été générés avec succès",
        },
      );
      await queryClient.invalidateQueries({
        queryKey: ["report-cards", sessionId],
      });
    },
    onError: (e) => {
      toast.error("Échec de la génération en lot", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      });
    },
  });

  // Téléchargement PDF
  async function handleDownload(rc: ReportCardWithStudent) {
    try {
      const blob = await reportCardsApi.download(rc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bulletin_${rc.student_matricule}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Bulletin téléchargé");
    } catch (e) {
      toast.error("Échec du téléchargement", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      });
    }
  }

  // Fusionner les données : étudiants (depuis computation) + bulletins (depuis report-cards)
  const reportCardsMap = new Map<string, ReportCardWithStudent>();
  for (const rc of reportCardsData?.report_cards ?? []) {
    reportCardsMap.set(rc.student_id, rc);
  }

  const mergedStudents: MergedStudent[] = (resultsData?.results ?? []).map(
    (r) => ({
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
      report_card: reportCardsMap.get(r.student_id),
      has_bulletin: reportCardsMap.has(r.student_id),
    }),
  );

  const generatedCount = mergedStudents.filter((s) => s.has_bulletin).length;
  const totalCount = mergedStudents.length;
  const completionPercent =
    totalCount > 0 ? (generatedCount / totalCount) * 100 : 0;

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
                <h2 className="font-semibold text-base">Bulletins PDF</h2>
                <p className="text-xs text-muted-foreground">
                  {waitingForSchool
                    ? "Sélectionnez une école pour commencer"
                    : waitingForSession
                      ? "Sélectionnez une session pour générer les bulletins"
                      : "Génération, stockage et impression des bulletins officiels"}
                </p>
              </div>
            </div>
            {canGenerate && selectedSession && (
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => generateBatchMut.mutate(selectedSession.id)}
                  disabled={generateBatchMut.isPending || resultsLoading}
                  className="shadow-sm"
                >
                  {generateBatchMut.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Files className="w-4 h-4 mr-1.5" />
                  )}
                  Générer tous les bulletins
                </Button>
                {/* === Imprimer les bulletins A5 paysage (2 par page A4) ===
                    Ouvre /bulletins?session_id=...&t=token dans un nouvel onglet.
                    La page fetch les releve-data de toutes les classes de la
                    session, mappe les notes SYGREN → slots bulletin CI, et
                    imprime via window.print(). Pas de génération PDF côté
                    backend : c'est le navigateur qui produit le PDF (dialog
                    Imprimer > Enregistrer au format PDF).
                    Pattern repris de results-view.tsx (boutons Relevés PDF /
                    Synthèses PDF) — token lu directement depuis localStorage
                    pour éviter la dépendance à l'hydratation du store. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    let token = "";
                    try {
                      const raw = localStorage.getItem("sygren-auth");
                      if (raw) token = JSON.parse(raw)?.state?.token ?? "";
                    } catch {}
                    const url = `${window.location.origin}/bulletins?session_id=${selectedSession.id}&t=${encodeURIComponent(token)}`;
                    window.open(url, "_blank");
                  }}
                >
                  <Printer className="w-4 h-4 mr-1.5" />
                  Imprimer les bulletins (A5)
                </Button>
              </div>
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
                onValueChange={setSelectedSessionId}
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
              Sélectionnez une session pour générer les bulletins
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {sessions.length > 0
                ? `${sessions.length} session(s) disponible(s) — choisissez-en une dans le filtre ci-dessus.`
                : "Aucune session n'a été créée pour cette école. Créez une session dans le module Évaluations."}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Stats de génération */}
      {selectedSession && (
        <Card className="border-border/60">
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">
                    {generatedCount}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    générés
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
                </div>
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-muted-foreground">
                    Progression de la génération
                  </span>
                  <span className="font-medium">
                    {completionPercent.toFixed(0)}%
                  </span>
                </div>
                <Progress value={completionPercent} className="h-2" />
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
              Certaines notes sont encore en brouillon. Les bulletins générés
              seront provisoires. Validez la session pour des bulletins définitifs.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tableau des bulletins (seulement si session sélectionnée — cascade) */}
      {selectedSession && (
        resultsLoading ? (
          <LoadingState message="Calcul des résultats…" />
        ) : mergedStudents.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <p className="text-sm">Aucun élève dans cette session.</p>
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
                    <TableHead className="text-center">Statut</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                        <TableCell className="text-center">
                          {s.has_bulletin ? (
                            <Badge
                              variant="outline"
                              className="text-xs border-emerald-200 bg-emerald-50 text-emerald-700"
                            >
                              <FileCheck2 className="w-3 h-3 mr-1" />
                              Généré
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-xs border-slate-200 bg-slate-50 text-slate-500"
                            >
                              <FileX2 className="w-3 h-3 mr-1" />
                              Non généré
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canGenerate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1.5"
                                disabled={generateMut.isPending}
                                onClick={() =>
                                  generateMut.mutate({
                                    sessionId: selectedSession!.id,
                                    studentId: s.student_id,
                                  })
                                }
                              >
                                {s.has_bulletin ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    Régénérer
                                  </>
                                ) : (
                                  <>
                                    <FileText className="w-3.5 h-3.5" />
                                    Générer
                                  </>
                                )}
                              </Button>
                            )}
                            {s.has_bulletin && s.report_card && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5"
                                onClick={() => handleDownload(s.report_card!)}
                              >
                                <Download className="w-3.5 h-3.5" />
                                PDF
                              </Button>
                            )}
                          </div>
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

      {/* Légende */}
      <Card className="border-border/60 bg-muted/30">
        <CardContent className="py-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <FileCheck2 className="w-3.5 h-3.5 text-emerald-600" />
            Bulletin généré et stocké
          </span>
          <span className="flex items-center gap-1.5">
            <FileX2 className="w-3.5 h-3.5 text-slate-400" />
            Bulletin non généré
          </span>
          {canGenerate && (
            <span className="flex items-center gap-1.5">
              <Files className="w-3.5 h-3.5 text-primary" />
              Génération par lot disponible
            </span>
          )}
        </CardContent>
      </Card>
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
