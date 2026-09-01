"use client";

// === PDA IEPP — Plan d'Action Pluriannuel (compositions + examens blancs) ===
// Onglet du module Résultats. Reproduit le document officiel
// « SUIVI DU PLAN D'ACTION PLURIANNUEL DE L'IEPP » pour TOUTES les
// évaluations de l'année (niveaux CE/CM) :
//   1. Cascade stricte École → Évaluation (composition mensuelle OU examen
//      blanc) → Classe (CE1/CE2/CM1/CM2)
//   2. Examen blanc : grille de saisie (Présent + 3 notes, maîtrise en direct)
//      Composition mensuelle : grille LECTURE SEULE dérivée des notes du
//      module Notes (aucune double saisie — barèmes réels GradeScale)
//   3. Document officiel imprimable (page dédiée /pda-doc — pattern
//      /synthese : l'isolement print est tronqué dans le shell)
// Maîtrise : Admis = présent ET note >= barème × seuil % (par matière).

import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  ClipboardCheck,
  FileText,
  Landmark,
  ListPlus,
  Loader2,
  Save,
  ScrollText,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { classesApi, pdaApi, schoolsApi, sessionsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { monthLabel, SESSION_STATUS_CONFIG } from "@/lib/session-utils";
import type {
  PdaExam,
  PdaExamKind,
  PdaStudentRow,
  PdaSubjectInfo,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ConfirmDialog } from "@/components/confirm-dialog";

// === Helpers de maîtrise (miroir de la logique serveur) ===

/** État local de saisie d'une ligne élève (notes en string pour l'input). */
interface GridRow {
  present: boolean;
  ex: string;
  math: string;
  dic: string;
}

/** Parse une note saisie : "" → null, sinon nombre (ou NaN → invalide). */
function parseNote(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Nettoie la saisie : chiffres + un séparateur décimal, max 5 caractères. */
function sanitizeNote(value: string): string {
  let v = value.replace(/[^0-9.,]/g, "").replace(",", ".");
  const parts = v.split(".");
  if (parts.length > 2) v = parts[0] + "." + parts.slice(1).join("");
  return v.slice(0, 5);
}

/** Badge de maîtrise d'une matière (présent + note saisie requis). */
function MasteryBadge({
  present,
  note,
  seuil,
}: {
  present: boolean;
  note: string;
  seuil: number;
}) {
  const n = parseNote(note);
  if (!present || n === null || Number.isNaN(n)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return n >= seuil ? (
    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200">
      Admis
    </Badge>
  ) : (
    <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200">
      Non admis
    </Badge>
  );
}

/** Badge de maîtrise en lecture seule (données serveur déjà calculées). */
function MasteryBadgeReadonly({
  present,
  note,
  admis,
}: {
  present: boolean;
  note: number | null | undefined;
  admis: boolean;
}) {
  if (!present || note == null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return admis ? (
    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200">
      Admis
    </Badge>
  ) : (
    <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200">
      Non admis
    </Badge>
  );
}

/** Libellé d'une évaluation du plan selon son type. */
export function pdaExamLabel(e: PdaExam): string {
  if (e.kind === "composition") {
    const mois =
      e.session_month && e.session_month >= 1 && e.session_month <= 12
        ? monthLabel(e.session_month)
        : "";
    return `Composition N°${e.number}${mois ? ` — ${mois} ${e.year}` : ` — ${e.year}`}`;
  }
  return `Examen blanc N°${e.number} — ${e.year}`;
}

export function PdaView() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  // === Cascade stricte (même logique que le reste du module Résultats) ===
  const needsSchoolSelect = user?.role === "admin" || user?.role === "inspector";
  const [schoolFilter, setSchoolFilter] = useState<string>(
    needsSchoolSelect ? "" : (user?.school_id ?? ""),
  );
  const [examId, setExamId] = useState<string>("");
  const [classId, setClassId] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const hasSchool = schoolFilter !== "" && schoolFilter !== "all";

  // Écoles (admin/inspector seulement — cascade stricte)
  const { data: schoolsData } = useQuery({
    queryKey: ["schools", "pda-filter"],
    queryFn: () => schoolsApi.list(),
    enabled: needsSchoolSelect,
  });

  // Évaluations du plan : compositions mensuelles + examens blancs
  // (scope serveur : director/teacher = leur école)
  const { data: examsData, isLoading: examsLoading } = useQuery({
    queryKey: ["pda-exams", schoolFilter],
    queryFn: () =>
      pdaApi.listExams(hasSchool ? { school_id: schoolFilter } : undefined),
    enabled: hasSchool,
  });
  const exams: PdaExam[] = examsData?.exams ?? [];
  const selectedExam = exams.find((e) => e.id === examId);

  // Classes CE/CM de l'école (le plan d'action exclut le CP)
  const { data: classesData } = useQuery({
    queryKey: ["classes", "pda", schoolFilter],
    queryFn: () => classesApi.list(hasSchool ? { schoolId: schoolFilter } : undefined),
    enabled: hasSchool,
  });
  const ceCmClasses = useMemo(
    () =>
      (classesData?.classes ?? []).filter(
        (c) => c.active && (c.level === "CE" || c.level === "CM"),
      ),
    [classesData],
  );

  // Roster + résultats de la classe sélectionnée
  const { data: resultsData, isLoading: resultsLoading } = useQuery({
    queryKey: ["pda-results", examId, classId],
    queryFn: () => pdaApi.getResults(examId, classId),
    enabled: !!examId && !!classId,
  });

  const readOnly = resultsData?.read_only ?? false;
  const subjects: PdaSubjectInfo[] = resultsData?.subjects ?? [];

  // Rattrapage : abonner au plan les compositions actives non suivies
  // (sessions créées avant l'auto-abonnement). Idempotent.
  const backfillMutation = useMutation({
    mutationFn: () => pdaApi.backfillExams(schoolFilter),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["pda-exams", schoolFilter] });
      if (res.created > 0) {
        toast.success(
          `${res.created} composition(s) ajoutée(s) au plan d'action`,
          { description: `${res.skipped} déjà suivie(s) sur ${res.eligible} éligible(s).` },
        );
      } else {
        toast.info("Aucune composition à ajouter", {
          description:
            "Toutes les compositions actives de l'école sont déjà suivies par le plan.",
        });
      }
    },
    onError: (e) =>
      toast.error("Erreur", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      }),
  });

  // === État local de la grille (dérivation + override — zéro effet) ===
  // serverRows : dérivé de la réponse serveur. override : saisie locale en
  // cours (remis à null au changement de classe/examen et après sauvegarde).
  // En lecture seule (composition), override reste toujours null.
  const serverRows = useMemo(() => {
    const next: Record<string, GridRow> = {};
    for (const s of resultsData?.students ?? []) {
      next[s.student_id] = {
        present: s.present,
        ex: s.note_exploitation == null ? "" : String(s.note_exploitation),
        math: s.note_math == null ? "" : String(s.note_math),
        dic: s.note_dictee == null ? "" : String(s.note_dictee),
      };
    }
    return next;
  }, [resultsData]);
  const [override, setOverride] = useState<Record<string, GridRow> | null>(null);
  const rows = override ?? serverRows;
  const dirty = override !== null;

  const classInfo = resultsData?.class;
  const students: PdaStudentRow[] = resultsData?.students ?? [];
  const seuil = classInfo?.seuil ?? 0;

  const updateRow = (studentId: string, patch: Partial<GridRow>) => {
    if (readOnly) return; // composition : grille dérivée, non éditable
    const base = { ...rows };
    const cur = base[studentId];
    if (!cur) return;
    const next = { ...cur, ...patch };
    // Renseigner une note ⇒ l'élève est présumé présent (pratique de saisie)
    if (patch.ex !== undefined || patch.math !== undefined || patch.dic !== undefined) {
      const anyNote =
        parseNote(next.ex) !== null ||
        parseNote(next.math) !== null ||
        parseNote(next.dic) !== null;
      if (anyNote) next.present = true;
    }
    setOverride({ ...base, [studentId]: next });
  };

  // === Mutations ===
  const saveMutation = useMutation({
    mutationFn: () =>
      pdaApi.saveResults(examId, {
        class_id: classId,
        results: Object.entries(rows).map(([student_id, r]) => ({
          student_id,
          present: r.present,
          note_exploitation: parseNote(r.ex),
          note_math: parseNote(r.math),
          note_dictee: parseNote(r.dic),
        })),
      }),
    onSuccess: () => {
      toast.success("Résultats enregistrés");
      setOverride(null); // le serveur redevient la source de vérité
      queryClient.invalidateQueries({ queryKey: ["pda-results", examId, classId] });
      queryClient.invalidateQueries({ queryKey: ["pda-summary", examId] });
    },
    onError: (e) =>
      toast.error("Erreur", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      }),
  });

  const createMutation = useMutation({
    mutationFn: (data: {
      kind: PdaExamKind;
      session_id?: string;
      year: number;
      exam_date?: string;
      threshold?: number;
    }) =>
      pdaApi.createExam({
        school_id: schoolFilter,
        kind: data.kind,
        session_id: data.session_id,
        year: data.year,
        exam_date: data.exam_date || undefined,
        threshold: data.threshold,
      }),
    onSuccess: (exam) => {
      toast.success(
        exam.kind === "composition"
          ? `Composition N°${exam.number} ajoutée au plan d'action`
          : `Examen Blanc N°${exam.number} créé`,
      );
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ["pda-exams"] });
      setExamId(exam.id);
    },
    onError: (e) =>
      toast.error("Erreur", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => pdaApi.deleteExam(examId),
    onSuccess: () => {
      toast.success(
        selectedExam?.kind === "composition"
          ? "Composition retirée du plan d'action"
          : "Examen blanc supprimé",
      );
      setShowDelete(false);
      setExamId("");
      queryClient.invalidateQueries({ queryKey: ["pda-exams"] });
    },
    onError: (e) =>
      toast.error("Erreur", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      }),
  });

  // === Document officiel : page dédiée (pattern /synthese) ===
  // L'isolement print (#pda-doc) est tronqué par les conteneurs flex/overflow
  // du shell — le document s'ouvre donc sur sa propre page (nouvel onglet)
  // où l'impression A4 portrait ressort fidèle, et « Fermer » referme l'onglet.

  const pendingChanges = dirty ? " • modifications non enregistrées" : "";
  const examKindLabel = selectedExam
    ? selectedExam.kind === "composition"
      ? "Composition mensuelle"
      : "Examen blanc"
    : "";
  const unmatchedSubjects = subjects.filter((s) => !s.matched);
  const anyPresent = students.some((s) => s.present);

  return (
    <div className="space-y-4">
      {/* === Barre de cascade + actions === */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-primary" />
            Plan d&apos;Action Pluriannuel de l&apos;IEPP
            <span className="text-xs font-normal text-muted-foreground">
              Niveaux CE &amp; CM — Exploitation de texte · Mathématiques · Dictée
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="py-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            {needsSchoolSelect ? (
              <div className="space-y-1.5 w-full sm:w-auto sm:flex-1 sm:max-w-[280px]">
                <Label className="text-xs text-muted-foreground">École</Label>
                <Select
                  value={schoolFilter}
                  onValueChange={(v) => {
                    setSchoolFilter(v);
                    setExamId("");
                    setClassId("");
                    setOverride(null);
                  }}
                >
                  <SelectTrigger className="w-full overflow-hidden">
                    <SelectValue placeholder="Choisir une école…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(schoolsData?.schools ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5 w-full sm:w-auto sm:flex-1 sm:max-w-[320px]">
              <Label className="text-xs text-muted-foreground">
                Évaluation (composition ou examen blanc)
              </Label>
              <div className="flex gap-2">
                <Select
                  value={examId}
                  onValueChange={(v) => {
                    setExamId(v);
                    setClassId("");
                    setOverride(null);
                  }}
                  disabled={!hasSchool || exams.length === 0}
                >
                  <SelectTrigger className="w-full overflow-hidden">
                    <SelectValue
                      placeholder={
                        !hasSchool
                          ? "Choisir une école d'abord"
                          : exams.length === 0
                            ? "Aucune évaluation"
                            : "Choisir une évaluation…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {exams.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {pdaExamLabel(e)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="outline"
                  className="shrink-0"
                  title="Nouvelle évaluation (composition mensuelle ou examen blanc)"
                  disabled={!hasSchool}
                  onClick={() => setShowCreate(true)}
                >
                  <CalendarPlus className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="shrink-0"
                  title="Suivre les compositions mensuelles actives non encore suivies (rattrapage)"
                  disabled={!hasSchool || backfillMutation.isPending}
                  onClick={() => backfillMutation.mutate()}
                >
                  {backfillMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ListPlus className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="shrink-0 text-destructive hover:text-destructive"
                  title="Retirer cette évaluation du plan"
                  disabled={!examId}
                  onClick={() => setShowDelete(true)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5 w-full sm:w-auto sm:flex-1 sm:max-w-[200px]">
              <Label className="text-xs text-muted-foreground">Classe (CE / CM)</Label>
              <Select
                value={classId}
                onValueChange={(v) => {
                  setClassId(v);
                  setOverride(null);
                }}
                disabled={!examId || ceCmClasses.length === 0}
              >
                <SelectTrigger className="w-full overflow-hidden">
                  <SelectValue
                    placeholder={
                      !examId
                        ? "Choisir une évaluation d'abord"
                        : ceCmClasses.length === 0
                          ? "Aucune classe CE/CM"
                          : "Choisir une classe…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {ceCmClasses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 sm:ml-auto">
              {/* Document réseau groupé par centres d'examen — toutes les
                  écoles du périmètre pour CETTE évaluation (année+numéro). */}
              <Button
                size="sm"
                variant="outline"
                disabled={!selectedExam}
                title="Plan d'action pluriannuel de l'IEPP — toutes les écoles groupées par centre d'examen"
                onClick={() =>
                  selectedExam &&
                  window.open(
                    `/pda-plan-doc?year=${selectedExam.year}&number=${selectedExam.number}&kind=${selectedExam.kind}`,
                    "_blank",
                  )
                }
              >
                <Landmark className="w-4 h-4 mr-1.5" />
                Plan IEPP (centres)
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!examId || !classId}
                onClick={() =>
                  window.open(
                    `/pda-doc?exam_id=${encodeURIComponent(examId)}&class_id=${encodeURIComponent(classId)}`,
                    "_blank",
                  )
                }
              >
                <FileText className="w-4 h-4 mr-1.5" />
                Document officiel
              </Button>
            </div>
          </div>

          {selectedExam && classInfo && (
            <p className="text-xs text-muted-foreground">
              {readOnly ? (
                <>
                  Notes dérivées du module Notes — barèmes réels par matière :{" "}
                  {subjects.map((s, i) => (
                    <span key={s.key}>
                      {i > 0 && " · "}
                      <span className="font-medium">
                        {s.label} : /{s.max_score}
                      </span>{" "}
                      (seuil {s.seuil})
                    </span>
                  ))}{" "}
                  — {selectedExam.threshold} % du barème.
                </>
              ) : (
                <>
                  Barème {classInfo.level} :{" "}
                  <span className="font-medium">/{classInfo.max_score}</span> — Seuil
                  de maîtrise : <span className="font-medium">{seuil}</span> (
                  {selectedExam.threshold} %) — un élève « Admis » est présent avec
                  une note ≥ au seuil dans la matière.
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* === Grille === */}
      {!examId || !classId ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-12 text-center">
            <ClipboardCheck className="w-8 h-8 mx-auto mb-3 text-primary/50" />
            <p className="text-sm font-medium">
              Sélectionnez une évaluation puis une classe CE/CM
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {exams.length === 0 && hasSchool
                ? "Aucune évaluation pour cette école — ajoutez une composition mensuelle (notes du module Notes) ou un examen blanc avec le bouton +."
                : "La grille de maîtrise s'affichera ici, élève par élève et matière par matière."}
            </p>
          </CardContent>
        </Card>
      ) : resultsLoading || !resultsData ? (
        <Card>
          <CardContent className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Chargement de la grille…
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60 overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium">
                {readOnly ? "Niveaux — " : "Saisie — "}
                {examKindLabel}
                {selectedExam?.kind === "composition" && selectedExam.session_month
                  ? ` (${monthLabel(selectedExam.session_month)} ${selectedExam.year})`
                  : selectedExam
                    ? ` (${selectedExam.year})`
                    : ""}
                {" · "}
                {classInfo?.name} · {students.length} élève(s)
                {readOnly && (
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                    grille dérivée du module Notes — lecture seule
                  </span>
                )}
                {pendingChanges && (
                  <span className="text-amber-600 font-normal">{pendingChanges}</span>
                )}
              </CardTitle>
              {!readOnly && (
                <Button
                  size="sm"
                  disabled={!dirty || saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  ) : (
                    <Save className="w-4 h-4 mr-1.5" />
                  )}
                  Enregistrer
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0 space-y-0">
            {/* Avertissement : matières désignées non notées dans les compositions */}
            {readOnly && unmatchedSubjects.length > 0 && (
              <div className="px-4 pt-3">
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      {unmatchedSubjects.map((s) => (
                        <p key={s.key}>
                          <span className="font-medium">« {s.label} »</span> n&apos;est
                          pas notée dans les compositions mensuelles — créez cette
                          matière puis saisissez ses notes dans le module Notes pour
                          la suivre dans le plan d&apos;action.
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="p-0">
              <div className="overflow-x-auto scroll-sygren">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">#</TableHead>
                      <TableHead className="min-w-[180px]">Élève</TableHead>
                      <TableHead className="text-center w-[64px]">Présent</TableHead>
                      {subjects.map((s) => (
                        <Fragment key={s.key}>
                          <TableHead className="text-center w-[96px]">
                            {s.label}
                            {s.max_score > 0 && (
                              <span className="block text-[10px] font-normal text-muted-foreground">
                                /{s.max_score}
                              </span>
                            )}
                          </TableHead>
                          <TableHead className="text-center w-[90px]">
                            <span className="sr-only">
                              Maîtrise {s.label}
                            </span>
                          </TableHead>
                        </Fragment>
                      ))}
                      <TableHead className="text-center w-[110px]">
                        Niveau global
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((s, idx) => {
                      const row = rows[s.student_id] ?? {
                        present: false,
                        ex: "",
                        math: "",
                        dic: "",
                      };
                      const seuils = [
                        subjects[0]?.seuil ?? 0,
                        subjects[1]?.seuil ?? 0,
                        subjects[2]?.seuil ?? 0,
                      ];
                      if (readOnly) {
                        // Composition — données serveur (badges déjà calculés)
                        return (
                          <TableRow
                            key={s.student_id}
                            className={s.present ? "" : "opacity-70"}
                          >
                            <TableCell className="text-xs text-muted-foreground tabular-nums">
                              {idx + 1}
                            </TableCell>
                            <TableCell>
                              <div className="text-sm font-medium">
                                {s.last_name} {s.first_name}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {s.matricule} · {s.gender === "F" ? "Fille" : "Garçon"}
                              </div>
                            </TableCell>
                            <TableCell className="text-center">
                              <Checkbox checked={s.present} disabled aria-label={`Présence de ${s.last_name} (dérivée des notes)`} />
                            </TableCell>
                            {(
                              [
                                [s.note_exploitation, s.admis_exploitation],
                                [s.note_math, s.admis_math],
                                [s.note_dictee, s.admis_dictee],
                              ] as const
                            ).map(([note, admis], i) => (
                              <Fragment key={subjects[i]?.key ?? i}>
                                <TableCell className="text-center text-sm tabular-nums">
                                  {s.present && note != null ? note : "—"}
                                </TableCell>
                                <TableCell className="text-center">
                                  <MasteryBadgeReadonly
                                    present={s.present}
                                    note={note}
                                    admis={admis}
                                  />
                                </TableCell>
                              </Fragment>
                            ))}
                            <TableCell className="text-center">
                              {!s.present ? (
                                <span className="text-xs text-muted-foreground">
                                  Absent
                                </span>
                              ) : s.admis_global ? (
                                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200">
                                  Admis
                                </Badge>
                              ) : (
                                <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200">
                                  Non admis
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      }
                      // Examen blanc — grille de saisie éditable
                      const nEx = parseNote(row.ex);
                      const nMath = parseNote(row.math);
                      const nDic = parseNote(row.dic);
                      const invalid =
                        Number.isNaN(nEx) || Number.isNaN(nMath) || Number.isNaN(nDic);
                      const graded = nEx !== null && nMath !== null && nDic !== null;
                      const allAdmis =
                        row.present &&
                        graded &&
                        nEx !== null &&
                        nMath !== null &&
                        nDic !== null &&
                        nEx >= seuils[0] &&
                        nMath >= seuils[1] &&
                        nDic >= seuils[2];
                      return (
                        <TableRow
                          key={s.student_id}
                          className={row.present ? "" : "opacity-70"}
                        >
                          <TableCell className="text-xs text-muted-foreground tabular-nums">
                            {idx + 1}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm font-medium">
                              {s.last_name} {s.first_name}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {s.matricule} · {s.gender === "F" ? "Fille" : "Garçon"}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={row.present}
                              onCheckedChange={(v) =>
                                updateRow(s.student_id, { present: v === true })
                              }
                              aria-label={`Présence de ${s.last_name}`}
                            />
                          </TableCell>
                          {(
                            [
                              ["ex", "exploitation"],
                              ["math", "mathématiques"],
                              ["dic", "dictée"],
                            ] as const
                          ).map(([key, label], i) => (
                            <Fragment key={key}>
                              <TableCell className="text-center">
                                <Input
                                  value={row[key]}
                                  onChange={(e) =>
                                    updateRow(s.student_id, {
                                      [key]: sanitizeNote(e.target.value),
                                    })
                                  }
                                  disabled={!row.present}
                                  inputMode="decimal"
                                  placeholder="—"
                                  className="h-8 w-16 mx-auto text-center tabular-nums"
                                  aria-label={`Note ${label} de ${s.last_name}`}
                                />
                              </TableCell>
                              <TableCell className="text-center">
                                <MasteryBadge
                                  present={row.present}
                                  note={row[key]}
                                  seuil={seuils[i] ?? 0}
                                />
                              </TableCell>
                            </Fragment>
                          ))}
                          <TableCell className="text-center">
                            {!row.present ? (
                              <span className="text-xs text-muted-foreground">Absent</span>
                            ) : invalid ? (
                              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">
                                <TriangleAlert className="w-3 h-3 mr-1" />
                                Invalide
                              </Badge>
                            ) : !graded ? (
                              <span className="text-xs text-muted-foreground">Incomplet</span>
                            ) : allAdmis ? (
                              <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200">
                                Admis
                              </Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200">
                                Non admis
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {students.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={10}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          Aucun élève dans cette classe.
                        </TableCell>
                      </TableRow>
                    )}
                    {students.length > 0 && readOnly && !anyPresent && (
                      <TableRow>
                        <TableCell
                          colSpan={10}
                          className="py-4 text-center text-xs text-muted-foreground"
                        >
                          Aucune note de cette classe dans la session liée — les notes
                          saisies dans le module Notes alimenteront automatiquement
                          cette grille.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Dialog création d'une évaluation du plan === */}
      <CreateExamDialog
        key={showCreate ? "open" : "closed"}
        open={showCreate}
        onOpenChange={setShowCreate}
        schoolId={schoolFilter}
        existing={exams}
        pending={createMutation.isPending}
        onCreate={(kind, year, examDate, threshold, sessionId) =>
          createMutation.mutate({
            kind,
            session_id: sessionId,
            year,
            exam_date: examDate || undefined,
            threshold,
          })
        }
      />

      {/* === Dialog suppression === */}
      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title={
          selectedExam?.kind === "composition"
            ? "Retirer la composition du plan ?"
            : "Supprimer l'examen blanc ?"
        }
        description={
          selectedExam
            ? selectedExam.kind === "composition"
              ? `La ${pdaExamLabel(selectedExam)} sera retirée du plan d'action (les notes du module Notes ne sont PAS touchées).`
              : `L'Examen Blanc N°${selectedExam.number} (${selectedExam.year}) et tous ses résultats (notes + remédiation) seront définitivement supprimés.`
            : ""
        }
        confirmLabel={selectedExam?.kind === "composition" ? "Retirer" : "Supprimer"}
        onConfirm={() => deleteMutation.mutate()}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

// === Dialog de création d'une évaluation du plan ===
function CreateExamDialog({
  open,
  onOpenChange,
  schoolId,
  existing,
  pending,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  schoolId: string;
  existing: PdaExam[];
  pending: boolean;
  onCreate: (
    kind: PdaExamKind,
    year: number,
    examDate: string,
    threshold: number,
    sessionId?: string,
  ) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [kind, setKind] = useState<PdaExamKind>("composition");
  const [sessionId, setSessionId] = useState("");
  const [year, setYear] = useState(String(currentYear));
  const [examDate, setExamDate] = useState("");
  const [threshold, setThreshold] = useState("50");

  // Sessions de composition de l'école (brouillons et annulées exclus :
  // aucune note exploitable / évaluation sans objet).
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["pda-sessions", schoolId],
    queryFn: () => sessionsApi.list({ school_id: schoolId }),
    enabled: open && kind === "composition" && !!schoolId,
  });
  const eligibleSessions = useMemo(() => {
    return (sessionsData?.sessions ?? [])
      .filter(
        (s) => s.eval_type === "composition" && s.status !== "draft" && s.status !== "cancelled",
      )
      .sort(
        (a, b) =>
          b.year - a.year ||
          b.month - a.month ||
          b.eval_number - a.eval_number,
      );
  }, [sessionsData]);
  const selectedSession = eligibleSessions.find((s) => s.id === sessionId);
  const sessionAlreadyUsed = (sid: string) =>
    existing.some((e) => e.kind === "composition" && e.session_id === sid);

  // Numéro suivant proposé (info, blancs uniquement) : max + 1 pour l'année saisie
  const nextNumber = useMemo(() => {
    const y = Number(year) || currentYear;
    const nums = existing
      .filter((e) => e.kind === "blanc" && e.year === y)
      .map((e) => e.number);
    return (nums.length ? Math.max(...nums) : 0) + 1;
  }, [existing, year, currentYear]);

  const y = Number(year);
  const t = Number(threshold);
  const thresholdValid = Number.isFinite(t) && t >= 1 && t <= 100;
  const valid =
    thresholdValid &&
    (kind === "blanc"
      ? Number.isFinite(y) && y >= 2000 && y <= 2100
      : !!selectedSession && !sessionAlreadyUsed(selectedSession.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nouvelle évaluation du plan d&apos;action</DialogTitle>
          <DialogDescription>
            {kind === "composition"
              ? "La composition mensuelle sera suivie avec les notes déjà saisies dans le module Notes (aucune double saisie)."
              : `Le numéro N°${nextNumber} sera attribué automatiquement pour l'année ${year || currentYear}. Les 3 notes seront saisies ici.`}
            {" "}Le plan d&apos;action suit les élèves de CE et CM.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pda-kind">Type d&apos;évaluation</Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as PdaExamKind);
                setSessionId("");
              }}
            >
              <SelectTrigger id="pda-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="composition">
                  Composition mensuelle — notes du module Notes
                </SelectItem>
                <SelectItem value="blanc">
                  Examen blanc — saisie manuelle des 3 notes
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === "composition" ? (
            <div className="space-y-1.5">
              <Label htmlFor="pda-session">Composition mensuelle</Label>
              <Select
                value={sessionId}
                onValueChange={setSessionId}
                disabled={sessionsLoading || eligibleSessions.length === 0}
              >
                <SelectTrigger id="pda-session" className="w-full overflow-hidden">
                  <SelectValue
                    placeholder={
                      sessionsLoading
                        ? "Chargement des sessions…"
                        : eligibleSessions.length === 0
                          ? "Aucune composition disponible"
                          : "Choisir une composition…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {eligibleSessions.map((s) => (
                    <SelectItem key={s.id} value={s.id} disabled={sessionAlreadyUsed(s.id)}>
                      N°{s.eval_number} — {monthLabel(s.month)} {s.year}
                      {" · "}
                      {SESSION_STATUS_CONFIG[s.status as keyof typeof SESSION_STATUS_CONFIG]
                        ?.label ?? s.status}
                      {sessionAlreadyUsed(s.id) ? " (déjà suivie)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Numéro, année et notes proviennent de la session — seules les
                compositions de cette école sont listées.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="pda-year">Année scolaire</Label>
                <Input
                  id="pda-year"
                  value={year}
                  inputMode="numeric"
                  onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                  placeholder={String(currentYear)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pda-date">Date de passage (optionnel)</Label>
                <Input
                  id="pda-date"
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pda-threshold">Seuil de maîtrise (%)</Label>
            <Input
              id="pda-threshold"
              value={threshold}
              inputMode="numeric"
              onChange={(e) => setThreshold(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              placeholder="50"
            />
            <p className="text-[11px] text-muted-foreground">
              50 % du barème (ex : 5/10 en examen blanc CE — barèmes réels par
              matière pour les compositions).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Annuler
          </Button>
          <Button
            disabled={!valid || !schoolId || pending}
            onClick={() =>
              onCreate(
                kind,
                kind === "composition"
                  ? (selectedSession?.year ?? currentYear)
                  : y,
                kind === "blanc" ? examDate : "",
                t,
                kind === "composition" ? sessionId : undefined,
              )
            }
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            {kind === "composition" ? "Suivre la composition" : "Créer l'examen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
