"use client";

import { useMemo, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList,
  Loader2,
  Save,
  Check,
  AlertCircle,
  Lock,
  CloudUpload,
  Calendar,
  School,
  GraduationCap,
  ShieldOff,
} from "lucide-react";
import { toast } from "sonner";

import {
  sessionsApi,
  studentsApi,
  subjectsApi,
  gradesApi,
  schoolsApi,
  classesApi,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useAutoSave, buildGradesMap, type SaveStatus } from "@/lib/use-autosave";
import { monthLabel, SESSION_STATUS_CONFIG } from "@/lib/session-utils";
import type {
  StudentWithClass,
  Subject,
  SessionWithDetails,
  ClassWithDetails,
  SchoolWithStats,
} from "@/lib/types";
import { parseLevels } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface GradesGridProps {
  // Session sélectionnée (passée par la vue parent pour le mode "saisie enseignant")
  initialSessionId?: string;
}

export function GradesGrid({ initialSessionId }: GradesGridProps) {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  // Approche A — la session couvre toute l'école. On a donc besoin de
  // filtrer par école (pour admin/inspector qui voient plusieurs écoles) et
  // par classe (l'enseignant ne saisit que pour SA classe, même si la
  // session est school-wide).
  const userSchoolId = user?.school_id ?? undefined;
  const isAdmin = user?.role === "admin";
  const isInspector = user?.role === "inspector";
  const isTeacher = user?.role === "teacher";
  // Cascade stricte (même logique que students/results/bulletins)
  // - admin/inspector : doivent choisir une école → puis une classe → puis une session
  // - director/teacher : école figée (RBAC backend) → choisissent une classe → session
  const needsSchoolSelect = isAdmin || isInspector;

  // === Cascade : École → Classe → Session ===
  // schoolFilter démarre à "" (vide) pour admin/inspector → doit choisir
  const [schoolFilter, setSchoolFilter] = useState<string>(
    needsSchoolSelect ? "" : (userSchoolId ?? ""),
  );
  const [explicitClassFilter, setExplicitClassFilter] = useState<string | undefined>(
    undefined,
  );
  const [explicitSessionId, setExplicitSessionId] = useState<string | undefined>(
    initialSessionId,
  );

  // hasSchoolSelected : true si une école est choisie
  const hasSchoolSelected = schoolFilter !== "" && schoolFilter !== "all";

  // Écoles (admin/inspector : pour le filtre ; director/teacher : la leur)
  const { data: schoolsData } = useQuery({
    queryKey: ["schools", "grades-view"],
    queryFn: () => schoolsApi.list(),
    enabled: needsSchoolSelect,
  });
  const schools: SchoolWithStats[] = schoolsData?.schools ?? [];

  // Détermine l'école active pour le filtre des sessions/classes :
  // - director/teacher : leur école (user.school_id)
  // - admin/inspector : l'école choisie dans le filtre
  const activeSchoolId = hasSchoolSelected ? schoolFilter : undefined;

  // Charger les classes : seulement si une école est sélectionnée (cascade)
  const { data: classesData } = useQuery({
    queryKey: ["classes", "grades-view", activeSchoolId],
    queryFn: () => classesApi.list(activeSchoolId ? { schoolId: activeSchoolId } : undefined),
    enabled: !!activeSchoolId,
  });
  const classes: ClassWithDetails[] = classesData?.classes ?? [];

  // Auto-sélection de la classe de l'enseignant (1 seule classe enseignée).
  // Dérivé : on prend la classe choisie explicitement, sinon la classe
  // enseignée si l'utilisateur est teacher, sinon "all".
  const teacherClassId = useMemo(
    () => (isTeacher ? classes.find((c) => c.teacher_id === user?.id)?.id : undefined),
    [classes, isTeacher, user?.id],
  );
  const classFilter: string = explicitClassFilter ?? teacherClassId ?? "all";
  const hasClassSelected = classFilter !== "all" && classFilter !== undefined;

  // Charger les sessions : seulement si une école est sélectionnée (cascade)
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["sessions", "grades-view", activeSchoolId],
    queryFn: () => sessionsApi.list(activeSchoolId ? { school_id: activeSchoolId } : undefined),
    enabled: hasSchoolSelected,
  });

  // Cascade stricte : PAS d'auto-sélection de session.
  // L'utilisateur doit explicitement choisir une session dans le select.
  const sessions = sessionsData?.sessions ?? [];
  const selectedSessionId = explicitSessionId;

  // Charger les détails de la session sélectionnée
  const selectedSession = sessionsData?.sessions?.find(
    (s) => s.id === selectedSessionId,
  );

  // Charger les exemptions de la session (pour skip les élèves exemptés)
  const { data: exemptionsData } = useQuery({
    queryKey: ["session-exemptions", selectedSessionId],
    queryFn: () => sessionsApi.listExemptions(selectedSessionId!),
    enabled: !!selectedSessionId,
  });
  const exemptions = exemptionsData?.exemptions ?? [];

  // Construire un set des class_id exemptés + un set des levels exemptés
  const exemptedClassIds = useMemo(
    () =>
      new Set(
        exemptions
          .map((e) => e.class_id ?? null)
          .filter((v): v is string => !!v),
      ),
    [exemptions],
  );
  const exemptedLevels = useMemo(
    () =>
      new Set(
        exemptions
          .map((e) => e.level ?? null)
          .filter((v): v is string => !!v),
      ),
    [exemptions],
  );

  // Charger les élèves :
  // - Si classFilter sélectionné : studentsApi.list(classFilter)
  // - Sinon : tous les élèves visibles (RBAC backend), filtrés côté client
  //   par les classes de l'école active
  const { data: studentsData } = useQuery({
    queryKey: ["students", "grades-view", classFilter, activeSchoolId],
    queryFn: () => studentsApi.list(classFilter !== "all" ? classFilter : undefined),
    enabled: !!selectedSessionId,
  });

  const { data: subjectsData } = useQuery({
    queryKey: ["subjects"],
    queryFn: () => subjectsApi.list(),
    enabled: !!selectedSessionId,
  });
  const { data: gradesData, isLoading: gradesLoading } = useQuery({
    queryKey: ["grades", selectedSessionId],
    queryFn: () => gradesApi.list(selectedSessionId!),
    enabled: !!selectedSessionId,
  });

  // Hook d'auto-save (brouillon automatique)
  const autoSave = useAutoSave({
    sessionId: selectedSessionId ?? "",
    debounceMs: 800,
  });

  // Map des notes existantes + valeurs en attente
  const gradesMap = useMemo(
    () => buildGradesMap(gradesData?.grades ?? []),
    [gradesData],
  );

  // Filtrage des élèves :
  // - 1. Si pas de classFilter : ne garder que les élèves dont la classe
  //   appartient à l'école active (parmi les classes chargées).
  // - 2. Skip les élèves dont la classe est exemptée (par class_id ou par
  //   niveau — on lookup le niveau via la liste des classes).
  const allStudents = studentsData?.students ?? [];
  const classById = useMemo(() => {
    const m = new Map<string, ClassWithDetails>();
    for (const c of classes) m.set(c.id, c);
    return m;
  }, [classes]);
  const visibleStudents = useMemo(() => {
    return allStudents.filter((st) => {
      // 1. Filtre par école (via classes de l'école active)
      if (activeSchoolId) {
        const cls = classById.get(st.class_id);
        if (!cls) return false; // classe inconnue / hors école
      }
      // 2. Skip exemptés
      const cls = classById.get(st.class_id);
      const classLevel = cls?.level;
      if (st.class_id && exemptedClassIds.has(st.class_id)) return false;
      if (classLevel && exemptedLevels.has(classLevel)) return false;
      return true;
    });
  }, [allStudents, activeSchoolId, classById, exemptedClassIds, exemptedLevels]);

  // Filtrer les matières par niveau de la classe sélectionnée
  // (ex: CP1 → matières contenant "CP1" dans levels).
  // Approche A : on prend la classe sélectionnée dans le filtre, sinon la
  // 1ère classe de l'école active (pour admin qui veut tout voir).
  const selectedClass = useMemo(() => {
    if (classFilter !== "all") return classById.get(classFilter);
    return classes[0];
  }, [classFilter, classById, classes]);
  const className = selectedClass?.name ?? "";
  const allSubjects = subjectsData?.subjects ?? [];
  const subjects = className
    ? allSubjects.filter((s) => parseLevels(s.levels).includes(className as never))
    : allSubjects;

  const sessionStatus = selectedSession?.status;
  const canEdit = sessionStatus === "open" || user?.role === "admin";
  const cfg = sessionStatus
    ? SESSION_STATUS_CONFIG[sessionStatus as keyof typeof SESSION_STATUS_CONFIG]
    : null;

  // Handler de saisie dans une cellule
  const handleCellChange = useCallback(
    (studentId: string, subjectId: string, rawValue: string) => {
      if (!canEdit || !selectedSessionId) return;
      // Valider : nombre entre 0 et 20, ou vide
      if (rawValue === "") {
        // Note vide : on ne sauvegarde pas, on laisse la cellule vide
        return;
      }
      const num = parseFloat(rawValue.replace(",", "."));
      if (isNaN(num) || num < 0 || num > 20) {
        toast.error("Note invalide", {
          description: "La note doit être comprise entre 0 et 20",
        });
        return;
      }
      autoSave.updateCell(studentId, subjectId, num);
    },
    [autoSave, canEdit, selectedSessionId],
  );

  // Handler pour naviguer au clavier (Tab et Entrée)
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    rowIdx: number,
    colIdx: number,
    totalRows: number,
    totalCols: number,
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Descendre d'une ligne
      const nextRow = Math.min(rowIdx + 1, totalRows - 1);
      const next = document.querySelector<HTMLInputElement>(
        `input[data-cell="${nextRow}-${colIdx}"]`,
      );
      next?.focus();
      next?.select();
    } else if (e.key === "Tab" && e.shiftKey) {
      // Tab arrière géré nativement
    }
  };

  // Flush avant changement de session
  const handleSessionChange = async (id: string) => {
    if (autoSave.pendingCount > 0) {
      await autoSave.flush();
    }
    setExplicitSessionId(id);
    await queryClient.invalidateQueries({ queryKey: ["grades"] });
  };

  // Handler changement école (admin/inspector) → reset session + class
  const handleSchoolChange = async (id: string) => {
    if (autoSave.pendingCount > 0) {
      await autoSave.flush();
    }
    setSchoolFilter(id);
    setExplicitSessionId(undefined);
    setExplicitClassFilter(undefined);
  };

  // Handler changement classe
  const handleClassChange = async (id: string) => {
    if (autoSave.pendingCount > 0) {
      await autoSave.flush();
    }
    setExplicitClassFilter(id);
    await queryClient.invalidateQueries({ queryKey: ["students", "grades-view"] });
  };

  // === États de la cascade stricte ===
  const waitingForSchool = needsSchoolSelect && !hasSchoolSelected;
  const waitingForSession = hasSchoolSelected && !selectedSessionId;

  if (sessionsLoading && hasSchoolSelected) {
    return (
      <Card>
        <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm">Chargement des sessions…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sélecteur de session + indicateur de sauvegarde */}
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <ClipboardList className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Saisie des notes</h2>
                <p className="text-xs text-muted-foreground">
                  {waitingForSchool
                    ? "Sélectionnez une école pour commencer"
                    : waitingForSession
                      ? "Sélectionnez une session pour saisir les notes"
                      : `${visibleStudents.length} élève(s) × ${subjects.length} matière(s) = ${visibleStudents.length * subjects.length} notes attendues`}
                </p>
              </div>
            </div>
            <SaveIndicator status={autoSave.status} pendingCount={autoSave.pendingCount} />
          </div>

          {/* === Cascade stricte : École → Classe → Session === */}
          <div className="flex flex-wrap items-end gap-3">
            {/* Filtre École (admin/inspector: actif, director/teacher: figé) */}
            {needsSchoolSelect ? (
              <div className="space-y-1.5 min-w-[180px] flex-1 max-w-[280px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <School className="w-3 h-3" /> École
                </label>
                <Select value={schoolFilter} onValueChange={handleSchoolChange}>
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

            {/* Filtre Classe (désactivé tant que pas d'école) */}
            <div className="space-y-1.5 min-w-[160px] flex-1 max-w-[220px] min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <GraduationCap className="w-3 h-3" /> Classe
              </label>
              <Select
                value={classFilter}
                onValueChange={handleClassChange}
                disabled={!hasSchoolSelected || classes.length === 0}
              >
                <SelectTrigger className="w-full overflow-hidden">
                  <SelectValue
                    placeholder={
                      !hasSchoolSelected
                        ? "Choisir une école d'abord"
                        : "Choisir une classe…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {isTeacher ? null : (
                    <SelectItem value="all">Toutes les classes</SelectItem>
                  )}
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} {c.level && `(${c.level})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filtre Session (désactivé tant que pas d'école) */}
            <div className="space-y-1.5 min-w-[220px] flex-1 max-w-[340px] min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Session
              </label>
              <Select
                value={selectedSessionId ?? ""}
                onValueChange={handleSessionChange}
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
            {cfg && (
              <Badge variant="outline" className={cn("text-xs", cfg.color)}>
                {cfg.label}
              </Badge>
            )}
            {exemptions.length > 0 && (
              <Badge
                variant="outline"
                className="text-xs bg-amber-50 text-amber-700 border-amber-200"
              >
                <ShieldOff className="w-3 h-3 mr-1" />
                {exemptions.length} exemption(s)
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* === États vides de la cascade stricte === */}
      {waitingForSchool ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-12 text-center">
            <School className="w-8 h-8 mx-auto mb-3 text-primary/50" />
            <p className="text-sm font-medium text-foreground">
              Sélectionnez une école pour afficher les classes et sessions
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Choisissez une école dans le filtre ci-dessus — les classes et
              sessions associées s&apos;afficheront automatiquement.
            </p>
          </CardContent>
        </Card>
      ) : waitingForSession ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-12 text-center">
            <Calendar className="w-8 h-8 mx-auto mb-3 text-primary/50" />
            <p className="text-sm font-medium text-foreground">
              Sélectionnez une session pour saisir les notes
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {sessions.length > 0
                ? `${sessions.length} session(s) disponible(s) — choisissez-en une dans le filtre ci-dessus.`
                : "Aucune session n'a été créée pour cette école. Le directeur doit ouvrir une session dans le module Évaluations."}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Bandeau d'avertissement si saisie fermée */}
      {selectedSession && sessionStatus !== "open" && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800">
              {sessionStatus === "closed" &&
                "La saisie est fermée. Les modifications sont bloquées en attente de validation."}
              {sessionStatus === "validated" &&
                "Session validée — les notes sont verrouillées définitivement."}
              {sessionStatus === "draft" &&
                "Session en brouillon — la saisie n'est pas encore ouverte."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Grille de saisie (seulement si session sélectionnée — cascade) */}
      {selectedSessionId && (
        (gradesLoading || !studentsData || !subjectsData) ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm">Chargement de la grille…</p>
          </CardContent>
        </Card>
      ) : visibleStudents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-sm">Aucun élève à afficher.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Vérifiez le filtre classe ou les exemptions de la session.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60 overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-auto scroll-sygren max-h-[70vh]">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b">
                    <th className="text-left p-3 font-medium text-muted-foreground min-w-[180px] sticky left-0 bg-card z-20 border-r">
                      Élève
                    </th>
                    {subjects.map((subj: Subject) => (
                      <th
                        key={subj.id}
                        className="text-center p-2 font-medium text-muted-foreground min-w-[90px] border-r last:border-r-0"
                        title={`${subj.name} (coef. ${subj.coefficient})`}
                      >
                        <div className="space-y-0.5">
                          <p className="text-xs truncate max-w-[80px]">
                            {subj.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground/70">
                            coef. {subj.coefficient}
                          </p>
                        </div>
                      </th>
                    ))}
                    <th className="text-center p-2 font-medium min-w-[90px] bg-muted/30">
                      Moyenne
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStudents.map((student: StudentWithClass, rowIdx: number) => {
                    // Calculer la moyenne de l'élève sur les notes saisies
                    const studentGrades = subjects
                      .map((subj) => {
                        const key = `${student.id}:${subj.id}`;
                        const pending = autoSave.status !== "idle" ? undefined : null;
                        void pending; // les valeurs en attente sont lues via autoSave
                        const grade = gradesMap[key];
                        // Lire aussi les valeurs en attente non encore flushées
                        return grade?.value;
                      })
                      .filter((v): v is number => typeof v === "number");
                    const avg =
                      studentGrades.length > 0
                        ? studentGrades.reduce((a, b) => a + b, 0) /
                          studentGrades.length
                        : null;

                    return (
                      <tr
                        key={student.id}
                        className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="p-3 sticky left-0 bg-card z-10 border-r">
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {student.last_name} {student.first_name}
                            </span>
                            <span className="text-[11px] text-muted-foreground font-mono">
                              {student.matricule}
                            </span>
                          </div>
                        </td>
                        {subjects.map((subj: Subject, colIdx: number) => {
                          const key = `${student.id}:${subj.id}`;
                          const grade = gradesMap[key];
                          // Valeur affichée : priorité à la valeur en attente (plus récente)
                          const displayValue = grade?.value ?? "";
                          return (
                            <td
                              key={subj.id}
                              className="p-1 border-r last:border-r-0 text-center"
                            >
                              <GradeInput
                                dataCell={`${rowIdx}-${colIdx}`}
                                value={displayValue}
                                onChange={(v) =>
                                  handleCellChange(student.id, subj.id, v)
                                }
                                onKeyDown={(e) =>
                                  handleKeyDown(
                                    e,
                                    rowIdx,
                                    colIdx,
                                    visibleStudents.length,
                                    subjects.length,
                                  )
                                }
                                disabled={!canEdit}
                                isDraft={grade?.is_draft}
                              />
                            </td>
                          );
                        })}
                        <td className="p-2 text-center bg-muted/30">
                          {avg !== null ? (
                            <span
                              className={cn(
                                "font-semibold text-sm",
                                avg >= 10 ? "text-emerald-600" : "text-amber-600",
                              )}
                            >
                              {avg.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Légende */}
      <Card className="border-border/60 bg-muted/30">
        <CardContent className="py-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CloudUpload className="w-3.5 h-3.5 text-primary" />
            Sauvegarde automatique toutes les 800ms
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-card border rounded text-[10px]">Tab</kbd>
            <span>navigation horizontale</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-card border rounded text-[10px]">Entrée</kbd>
            <span>ligne suivante</span>
          </span>
        </CardContent>
      </Card>
    </div>
  );
}

// === Composant: input de note individuel ===
interface GradeInputProps {
  value: number | "";
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  isDraft?: boolean;
  dataCell: string;
}

function GradeInput({
  value,
  onChange,
  onKeyDown,
  disabled,
  isDraft,
  dataCell,
}: GradeInputProps) {
  // État local non contrôlé initialement, pour permettre la frappe sans
  // re-render à chaque caractère. On synchronise via la prop `key` quand
  // la valeur externe change (re-mount du composant).
  // L'utilisateur peut voir la valeur initiale, puis taper librement.

  return (
    <input
      type="text"
      inputMode="decimal"
      data-cell={dataCell}
      defaultValue={value === "" ? "" : String(value)}
      key={value} // remount quand la valeur externe change (re-sync)
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.target.select()}
      placeholder="—"
      className={cn(
        "w-full h-9 text-center text-sm rounded border outline-none transition-colors",
        "focus:border-primary focus:ring-2 focus:ring-primary/20",
        disabled
          ? "bg-muted/40 text-muted-foreground cursor-not-allowed"
          : "bg-card hover:border-primary/40",
        isDraft && !disabled && "bg-amber-50/50 border-amber-200",
      )}
    />
  );
}

// === Indicateur de sauvegarde ===
function SaveIndicator({
  status,
  pendingCount,
}: {
  status: SaveStatus;
  pendingCount: number;
}) {
  const config = {
    idle: {
      icon: Check,
      text: "À jour",
      className: "text-emerald-600 bg-emerald-50 border-emerald-200",
    },
    pending: {
      icon: CloudUpload,
      text: pendingCount > 0 ? `${pendingCount} modification(s)…` : "En attente",
      className: "text-amber-600 bg-amber-50 border-amber-200",
    },
    saving: {
      icon: Loader2,
      text: "Sauvegarde…",
      className: "text-primary bg-primary/5 border-primary/20",
    },
    saved: {
      icon: Check,
      text: "Enregistré ✓",
      className: "text-emerald-600 bg-emerald-50 border-emerald-200",
    },
    error: {
      icon: AlertCircle,
      text: "Échec — réessai…",
      className: "text-destructive bg-destructive/5 border-destructive/20",
    },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium",
        c.className,
      )}
    >
      <Icon className={cn("w-3.5 h-3.5", status === "saving" && "animate-spin")} />
      {c.text}
    </div>
  );
}
