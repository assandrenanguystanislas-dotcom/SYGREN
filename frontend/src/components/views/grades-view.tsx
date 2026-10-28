"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
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
  Eraser,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  sessionsApi,
  studentsApi,
  subjectsApi,
  gradesApi,
  gradeScalesApi,
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
  Grade,
} from "@/lib/types";
import { parseLevels, subjectCoefficient } from "@/lib/types";
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
import { SchoolCombobox } from "@/components/school-combobox";
import { ClassCombobox } from "@/components/class-combobox";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";

interface GradesGridProps {
  // Session sélectionnée (passée par la vue parent pour le mode "saisie enseignant")
  initialSessionId?: string;
}

// === Moyenne « au fur et à mesure » — miroir exact de computeSessionResults ===
// FORMULE ÉCOLE : les notes ne se divisent PAS selon le coefficient.
//   CP       : Σ notes brutes / Σ coefficients          → /10
//   CE et CM : Σ notes brutes / (Σ coefficients / 2)    → /20
//     (« diviser par la MOITIÉ de la somme des coefficients » — ex CM :
//     45+37+25+15 = 122, coefs 5+5+5+2 = 17 → 122 / 8,5 = 14,35/20)
// Seules les matières DÉJÀ NOTÉES entrent dans les sommes — la moyenne se
// recalcule à chaque frappe et converge vers la moyenne finale de la session.
function liveAverage(
  studentId: string,
  level: string,
  subjects: Subject[],
  getVal: (studentId: string, subjectId: string) => number | null,
): { avg: number | null; graded: number; scale: number } {
  let totalNotes = 0;
  let totalCoef = 0;
  let graded = 0;
  for (const subj of subjects) {
    const v = getVal(studentId, subj.id);
    if (v === null) continue;
    totalNotes += v;
    totalCoef += subjectCoefficient(subj, level);
    graded++;
  }
  const isCeCm = level === "CE" || level === "CM";
  const scale = isCeCm ? 20 : 10;
  if (graded === 0 || totalCoef <= 0) return { avg: null, graded, scale };
  const avg = isCeCm ? totalNotes / (totalCoef / 2) : totalNotes / totalCoef;
  return { avg, graded, scale };
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

  // Auto-sélection de la classe de l'enseignant (adjoint(e) au directeur).
  // v26 — le backend renvoie SES classes uniquement : affectation explicite
  // (teacher_id) OU repli sur le cours tenu du dossier (users.cours — ex :
  // cours=CP1 → classe CP1 de son école). Priorité à la classe explicitement
  // affectée, sinon la première de ses classes ; il peut basculer entre SES
  // classes dans la liste déroulante ci-dessous (jamais les autres).
  const teacherClassId = useMemo(
    () =>
      isTeacher
        ? (classes.find((c) => c.teacher_id === user?.id) ?? classes[0])?.id
        : undefined,
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
    queryFn: () => studentsApi.list({
      classId: classFilter !== "all" ? classFilter : undefined,
      schoolId: activeSchoolId,
    }),
    enabled: !!selectedSessionId,
  });

  const { data: subjectsData } = useQuery({
    queryKey: ["subjects"],
    queryFn: () => subjectsApi.list(),
    enabled: !!selectedSessionId,
  });
  // Barèmes de notation (par niveau + exception par matière) — validation
  // dynamique de la saisie côté client, alignée sur le contrôle serveur.
  const { data: scalesData } = useQuery({
    queryKey: ["grade-scales"],
    queryFn: () => gradeScalesApi.list(),
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

  // === Effacement complet des notes (demande utilisateur) ===
  //  - { type: "student" } : toutes les matières d'un élève (icône sur sa ligne)
  //  - { type: "all" } : toute la saisie (classe sélectionnée, ou toute
  //    la session si « Toutes les classes ») — bouton « Tout effacer »
  const [confirmWipe, setConfirmWipe] = useState<
    | null
    | { type: "all" }
    | { type: "student"; student: StudentWithClass }
  >(null);
  const [wiping, setWiping] = useState(false);

  // Valeur EFFECTIVE d'une cellule : modification en attente (frappe en cours,
  // non encore sauvegardée) sinon note en base — la moyenne se met à jour AU
  // FUR ET À MESURE que les notes sont saisies, sans attendre l'auto-save.
  const effectiveValue = useCallback(
    (studentId: string, subjectId: string): number | null => {
      const key = `${studentId}:${subjectId}`;
      const p = autoSave.pending[key];
      if (p) return p.value;
      const g = gradesMap[key];
      return g ? g.value : null;
    },
    [autoSave.pending, gradesMap],
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

  // === Compteur de saisie EN DIRECT (demande utilisateur : « la moyenne au
  // fur et à mesure que les notes sont saisies ») — notes effectives (en
  // base + frappe en cours) / notes attendues. ===
  const expectedCount = visibleStudents.length * subjects.length;
  const enteredCount = useMemo(() => {
    let n = 0;
    for (const st of visibleStudents) {
      for (const subj of subjects) {
        if (effectiveValue(st.id, subj.id) !== null) n++;
      }
    }
    return n;
  }, [visibleStudents, subjects, effectiveValue]);

  // === Barème du niveau de la classe sélectionnée ===
  // Lookup identique au backend (getGradeScale) : exception (niveau+matière)
  // d'abord, sinon barème par défaut du niveau, sinon 0–20 (sécurité).
  const levelScales = useMemo(() => {
    const level = selectedClass?.level ?? "";
    const all = scalesData?.grade_scales ?? [];
    const def = all.find((s) => s.level === level && !s.subject_id) ?? null;
    const exceptions = new Map<string, { min: number; max: number }>();
    for (const s of all) {
      if (s.level === level && s.subject_id) {
        exceptions.set(s.subject_id, { min: s.min_score ?? 0, max: s.max_score });
      }
    }
    return { def, exceptions };
  }, [scalesData, selectedClass?.level]);

  const scaleFor = useCallback(
    (subjectId: string): { min: number; max: number } => {
      const exc = levelScales.exceptions.get(subjectId);
      if (exc) return exc;
      if (levelScales.def) {
        return { min: levelScales.def.min_score ?? 0, max: levelScales.def.max_score };
      }
      return { min: 0, max: 20 };
    },
    [levelScales],
  );

  const sessionStatus = selectedSession?.status;
  // canEdit : la saisie est possible si la session est "open" ou si l'admin
  // force l'édition (sauf si la session est "validated" — verrouillage définitif).
  // isLocked : quand la session est "validated", les notes sont verrouillées
  // définitivement — aucun utilisateur (même admin) ne peut les modifier.
  const isLocked = sessionStatus === "validated";
  const canEdit = !isLocked && (sessionStatus === "open" || user?.role === "admin");
  const cfg = sessionStatus
    ? SESSION_STATUS_CONFIG[sessionStatus as keyof typeof SESSION_STATUS_CONFIG]
    : null;

  // Effacement d'une cellule : note en attente → abandon ; note en base →
  // suppression serveur (DeleteGrade, moyennes recalculées) + retrait du
  // cache local (la moyenne live retombe immédiatement).
  const handleCellClear = useCallback(
    async (studentId: string, subjectId: string) => {
      const key = `${studentId}:${subjectId}`;
      const existing = gradesMap[key];
      autoSave.discardCell(studentId, subjectId);
      if (!existing) return; // rien en base — abandon de la pending suffit
      try {
        await gradesApi.delete(existing.id);
        // Retrait du cache local (setQueryData — pas de refetch nécessaire)
        queryClient.setQueryData<{ grades: Grade[]; count: number }>(
          ["grades", selectedSessionId],
          (old) =>
            old
              ? {
                  grades: old.grades.filter((g) => g.id !== existing.id),
                  count: Math.max(0, old.count - 1),
                }
              : old,
        );
        toast.success("Note effacée");
      } catch (e) {
        toast.error("Échec de l'effacement", {
          description: e instanceof Error ? e.message : "Réessayez…",
        });
      }
    },
    [autoSave, gradesMap, queryClient, selectedSessionId],
  );

  // Handler de saisie dans une cellule
  // Validation dynamique selon le barème du niveau + matière (ex : CP 1–10,
  // CE 1–30 avec Dictée 1–10, CM 2–50 avec Dictée 2–20 et EPS 5–20).
  // - à la frappe : on contrôle NaN et le PLAFOND (un préfixe de frappe reste
  //   toujours ≤ à la valeur finale — ex : « 2 » puis « 25 » en CM) ;
  // - au blur (onBlur) : on contrôle aussi le PLANCHER (un préfixe peut être
  //   provisoirement sous le minimum — ex : « 1 » en début de « 12 » en CM) ;
  // - cellule VIDÉE : la note est effacée complètement (suppression serveur).
  const handleCellChange = useCallback(
    (studentId: string, subjectId: string, rawValue: string) => {
      if (!canEdit || !selectedSessionId) return;
      // Valider : nombre ≤ plafond du barème, ou vide
      if (rawValue === "") {
        // Cellule vidée : « effacer complètement la note quand la saisie est
        // erronée » — abandon de la valeur en attente + suppression en base.
        void handleCellClear(studentId, subjectId);
        return;
      }
      const num = parseFloat(rawValue.replace(",", "."));
      const scale = scaleFor(subjectId);
      if (isNaN(num) || num > scale.max) {
        toast.error("Note invalide", {
          description:
            scale.min > 0
              ? `La note doit être comprise entre ${scale.min} et ${scale.max} (barème ${selectedClass?.level ?? ""})`
              : `La note doit être comprise entre 0 et ${scale.max}`,
        });
        return;
      }
      autoSave.updateCell(studentId, subjectId, num);
    },
    [autoSave, canEdit, selectedSessionId, scaleFor, selectedClass?.level, handleCellClear],
  );

  // Exécution de l'effacement en masse confirmé (ligne élève ou saisie entière)
  const executeWipe = async () => {
    if (!confirmWipe || !selectedSessionId) return;
    setWiping(true);
    try {
      const filters =
        confirmWipe.type === "student"
          ? { student_id: confirmWipe.student.id }
          : classFilter !== "all"
            ? { class_id: classFilter }
            : undefined; // toute la session (toutes les classes de l'école)
      const res = await gradesApi.bulkDelete(selectedSessionId, filters);
      // Purge locale : valeurs en attente + cache (refetch — l'utilisateur
      // ne saisit pas à cet instant, le rechargement est sans risque)
      autoSave.clearPending();
      await queryClient.invalidateQueries({ queryKey: ["grades"] });
      toast.success(
        res.deleted > 0
          ? `${res.deleted} note(s) effacée(s)`
          : "Aucune note à effacer",
      );
      setConfirmWipe(null);
    } catch (e) {
      toast.error("Échec de l'effacement", {
        description: e instanceof Error ? e.message : "Réessayez…",
      });
    } finally {
      setWiping(false);
    }
  };

  // Contrôle du PLANCHER au blur (valeur complète — plus de préfixe de frappe)
  const handleCellBlur = useCallback(
    (subjectId: string, rawValue: string) => {
      if (!canEdit) return;
      const raw = rawValue.trim();
      if (raw === "") return;
      const num = parseFloat(raw.replace(",", "."));
      if (isNaN(num)) return;
      const scale = scaleFor(subjectId);
      if (num < scale.min || num > scale.max) {
        toast.error("Note invalide", {
          description:
            scale.min > 0
              ? `La note doit être comprise entre ${scale.min} et ${scale.max} (barème ${selectedClass?.level ?? ""})`
              : `La note doit être comprise entre 0 et ${scale.max}`,
        });
      }
    },
    [canEdit, scaleFor, selectedClass?.level],
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
            <div className="flex items-center gap-2">
              {/* Compteur de saisie EN DIRECT — se met à jour à chaque frappe */}
              {selectedSessionId && expectedCount > 0 && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs font-medium",
                    enteredCount >= expectedCount
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-primary/5 text-primary border-primary/20",
                  )}
                >
                  {enteredCount} / {expectedCount} saisies
                </Badge>
              )}
              {/* Effacement complet de la saisie erronée (demande utilisateur) */}
              {canEdit && selectedSessionId && enteredCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmWipe({ type: "all" })}
                  disabled={wiping}
                  className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                >
                  <Eraser className="w-3.5 h-3.5 mr-1" />
                  Tout effacer
                </Button>
              )}
              <SaveIndicator status={autoSave.status} pendingCount={autoSave.pendingCount} />
            </div>
          </div>

          {/* === Cascade stricte : École → Classe → Session === */}
          <div className="flex flex-wrap items-end gap-3">
            {/* Filtre École (admin/inspector: actif, director/teacher: figé) */}
            {needsSchoolSelect ? (
              <div className="space-y-1.5 min-w-[180px] flex-1 max-w-[280px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <School className="w-3 h-3" /> École
                </label>
                {/* v11 — bande déroulante scrollable + recherche
                    (lettres du nom ou code ministériel) */}
                <SchoolCombobox
                  schools={schools}
                  value={schoolFilter}
                  onChange={handleSchoolChange}
                  placeholder="Choisir une école…"
                />
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
              {/* v11 — bande déroulante + recherche (même traitement) ;
                  l'enseignant n'a pas l'option « Toutes les classes » */}
              <ClassCombobox
                classes={classes}
                value={classFilter}
                onChange={handleClassChange}
                disabled={!hasSchoolSelected || classes.length === 0}
                allowEmpty={!isTeacher}
                emptyValue="all"
                emptyLabel="Toutes les classes"
                placeholder={
                  !hasSchoolSelected
                    ? "Choisir une école d'abord"
                    : "Choisir une classe…"
                }
                emptyText="Aucune classe dans cette école."
                groupLabel="Classes de l'école"
              />
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

      {/* Bandeau d'avertissement selon le statut de la session ===
          - validated : rouge (verrouillage définitif, même admin ne peut plus modifier)
          - closed : ambre (saisie fermée, admin peut encore forcer)
          - draft : ambre (saisie pas encore ouverte) */}
      {selectedSession && sessionStatus !== "open" && (
        <Card className={isLocked ? "border-rose-300 bg-rose-50" : "border-amber-200 bg-amber-50"}>
          <CardContent className="py-3 flex items-center gap-2.5">
            <Lock className={cn("w-4 h-4 shrink-0", isLocked ? "text-rose-600" : "text-amber-600")} />
            <p className={cn("text-sm", isLocked ? "text-rose-800" : "text-amber-800")}>
              {sessionStatus === "closed" &&
                "La saisie est fermée. Les modifications sont bloquées en attente de validation."}
              {sessionStatus === "validated" &&
                "Session validée — les notes sont verrouillées définitivement. Aucune modification n'est possible (y compris pour l'administrateur)."}
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
              {isTeacher && classes.length === 0
                ? "Aucune classe ne correspond à votre cours tenu — demandez au directeur de vérifier le champ COURS de votre dossier (ex. CP1) ou de vous affecter une classe."
                : "Vérifiez le filtre classe ou les exemptions de la session."}
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
                    {subjects.map((subj: Subject) => {
                      const scale = scaleFor(subj.id);
                      const scaleLabel =
                        scale.min > 0 ? `${scale.min}–${scale.max}` : `/${scale.max}`;
                      // Coefficient EFFECTIF du niveau de la classe sélectionnée
                      // (Mathématiques CP 1 · CE 3 · CM 5 — miroir du backend)
                      const coef = subjectCoefficient(subj, selectedClass?.level);
                      return (
                        <th
                          key={subj.id}
                          className="text-center p-2 font-medium text-muted-foreground min-w-[90px] border-r last:border-r-0"
                          title={`${subj.name} (coef. ${coef} — barème ${scaleLabel})`}
                        >
                          <div className="space-y-0.5">
                            <p className="text-xs truncate max-w-[80px]">
                              {subj.name}
                            </p>
                            <p className="text-[10px] text-muted-foreground/70">
                              coef. {coef} · {scaleLabel}
                            </p>
                          </div>
                        </th>
                      );
                    })}
                    <th className="text-center p-2 font-medium min-w-[100px] bg-muted/30">
                      <div className="space-y-0.5">
                        <p className="text-xs">Moyenne</p>
                        {/* Échelle de la formule école : CP → /10, CE/CM → /20
                            (Σ notes / Σ coefs — Σ notes / (Σ coefs / 2)) */}
                        <p className="text-[10px] text-muted-foreground/70">
                          {selectedClass?.level === "CE" || selectedClass?.level === "CM"
                            ? "/20 en direct"
                            : selectedClass?.level === "CP"
                              ? "/10 en direct"
                              : "en direct"}
                        </p>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStudents.map((student: StudentWithClass, rowIdx: number) => {
                    // Niveau de la classe de l'élève (formule école : CP → /10,
                    // CE et CM → /20) — chaque ligne utilise SON niveau.
                    const studentLevel =
                      classById.get(student.class_id)?.level ?? selectedClass?.level ?? "";
                    // Moyenne « au fur et à mesure » : notes en base + frappe
                    // en cours (pending), formule officielle par niveau.
                    const { avg, graded, scale } = liveAverage(
                      student.id,
                      studentLevel,
                      subjects,
                      effectiveValue,
                    );
                    // La ligne contient au moins une note → effacement possible
                    const rowHasGrades = graded > 0;

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
                                onBlur={(e) =>
                                  handleCellBlur(subj.id, e.target.value)
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
                                isLocked={isLocked}
                                isDraft={grade?.is_draft}
                              />
                            </td>
                          );
                        })}
                        <td className="p-2 text-center bg-muted/30 group/avg">
                          <div className="flex items-center justify-center gap-1">
                            {avg !== null ? (
                              <span
                                className={cn(
                                  "font-semibold text-sm whitespace-nowrap",
                                  // Seuil de réussite = moitié de l'échelle
                                  // (5/10 au CP, 10/20 au CE/CM)
                                  avg >= scale / 2
                                    ? "text-emerald-600"
                                    : "text-amber-600",
                                )}
                                title={`Moyenne provisoire — ${graded} note(s) saisie(s), formule école ${studentLevel === "CE" || studentLevel === "CM" ? "Σ notes / (Σ coef / 2)" : "Σ notes / Σ coef"}`}
                              >
                                {avg.toFixed(2)}
                                <span className="text-[10px] text-muted-foreground font-normal">
                                  /{scale}
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                            {/* Effacer TOUTES les notes de cet élève (demande
                                utilisateur : saisie erronée) — visible au survol */}
                            {rowHasGrades && canEdit && (
                              <button
                                type="button"
                                title={`Effacer toutes les notes de ${student.last_name} ${student.first_name}`}
                                onClick={() =>
                                  setConfirmWipe({ type: "student", student })
                                }
                                disabled={wiping}
                                className="opacity-0 group-hover/avg:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
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
          <span className="flex items-center gap-1.5">
            <Eraser className="w-3.5 h-3.5 text-primary" />
            Effacer une note : vider la cellule — survoler la moyenne pour
            effacer toute la ligne
          </span>
        </CardContent>
      </Card>

      {/* Confirmation d'effacement en masse (ligne élève / saisie entière) */}
      <ConfirmDialog
        open={confirmWipe !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmWipe(null);
        }}
        title={
          confirmWipe?.type === "student"
            ? `Effacer les notes de ${confirmWipe.student.last_name} ${confirmWipe.student.first_name} ?`
            : classFilter === "all"
              ? "Effacer TOUTES les notes de la session ?"
              : "Effacer toutes les notes de cette classe ?"
        }
        description={
          confirmWipe?.type === "student"
            ? "Toutes les notes saisies pour cet élève dans cette session seront définitivement supprimées. Cette action est irréversible."
            : classFilter === "all"
              ? "Toutes les notes de toutes les classes de l'école pour cette session seront définitivement supprimées. Cette action est irréversible."
              : "Toutes les notes saisies pour cette classe dans cette session seront définitivement supprimées. Cette action est irréversible."
        }
        confirmLabel="Effacer"
        destructive
        icon={Eraser}
        loading={wiping}
        onConfirm={executeWipe}
      />
    </div>
  );
}

// === Composant: input de note individuel ===
interface GradeInputProps {
  value: number | "";
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  isDraft?: boolean;
  isLocked?: boolean; // session validée → verrouillage définitif (gris foncé)
  dataCell: string;
}

function GradeInput({
  value,
  onChange,
  onKeyDown,
  onBlur,
  disabled,
  isDraft,
  isLocked,
  dataCell,
}: GradeInputProps) {
  // Valeur locale CONTRÔLÉE : la frappe reste fluide (pas de re-mount), et les
  // mises à jour EXTERNES (fusion du cache après auto-save, suppression d'une
  // note effacée) ne s'appliquent que lorsque la cellule n'est PAS en cours
  // d'édition — l'utilisateur ne perd jamais son curseur ni sa saisie, même
  // s'il efface puis retape pendant l'aller-retour réseau.
  const [localValue, setLocalValue] = useState(value === "" ? "" : String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setLocalValue(value === "" ? "" : String(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      data-cell={dataCell}
      value={localValue}
      disabled={disabled || isLocked}
      onChange={(e) => {
        setLocalValue(e.target.value);
        onChange(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        focusedRef.current = false;
        onBlur?.(e);
      }}
      onFocus={(e) => {
        focusedRef.current = true;
        e.target.select();
      }}
      placeholder="—"
      className={cn(
        "w-full h-9 text-center text-sm rounded border outline-none transition-colors",
        "focus:border-primary focus:ring-2 focus:ring-primary/20",
        // Session validée → verrouillage définitif : gris foncé, read-only,
        // pas de hover ni focus visible. Les notes restent lisibles mais
        // clairement "gelées".
        isLocked
          ? "bg-zinc-100 text-zinc-500 border-zinc-200 cursor-not-allowed"
          : disabled
            ? "bg-muted/40 text-muted-foreground cursor-not-allowed"
            : "bg-card hover:border-primary/40",
        isDraft && !disabled && !isLocked && "bg-amber-50/50 border-amber-200",
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
