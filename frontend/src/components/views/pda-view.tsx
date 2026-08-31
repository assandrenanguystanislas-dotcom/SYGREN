"use client";

// === PDA IEPP — Plan d'Action Pluriannuel (examens blancs CE/CM) ===
// Onglet du module Résultats. Reproduit le document officiel
// « RÉSULTAT DE L'EXAMEN BLANC N°X » à partir d'une saisie par élève :
//   1. Cascade stricte École → Examen blanc → Classe (CE1/CE2/CM1/CM2)
//   2. Grille de saisie : Présent + 3 notes (Exploitation de texte,
//      Mathématiques, Dictée) avec maîtrise affichée en direct
//   3. Document officiel imprimable (pda-document.tsx) — agrégats
//      calculés côté serveur (source unique de vérité)
// Barème : CE=/10, CM=/20 — Admis = présent ET note >= seuil (50 % défaut).

import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  ClipboardCheck,
  FileText,
  Loader2,
  Save,
  ScrollText,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { classesApi, pdaApi, schoolsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { PdaExam, PdaStudentRow } from "@/lib/types";
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
import { PdaDocument } from "./pda-document";

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
  const [showDoc, setShowDoc] = useState(false);

  const hasSchool = schoolFilter !== "" && schoolFilter !== "all";

  // Écoles (admin/inspector seulement — cascade stricte)
  const { data: schoolsData } = useQuery({
    queryKey: ["schools", "pda-filter"],
    queryFn: () => schoolsApi.list(),
    enabled: needsSchoolSelect,
  });

  // Examens blancs (scope serveur : director/teacher = leur école)
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

  // === État local de la grille (dérivation + override — zéro effet) ===
  // serverRows : dérivé de la réponse serveur. override : saisie locale en
  // cours (remis à null au changement de classe/examen et après sauvegarde).
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
    mutationFn: (data: { school_id: string; year: number; exam_date?: string; threshold?: number }) =>
      pdaApi.createExam(data),
    onSuccess: (exam) => {
      toast.success(`Examen Blanc N°${exam.number} créé`);
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
      toast.success("Examen blanc supprimé");
      setShowDelete(false);
      setExamId("");
      queryClient.invalidateQueries({ queryKey: ["pda-exams"] });
    },
    onError: (e) =>
      toast.error("Erreur", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      }),
  });

  // === Vue document plein écran ===
  if (showDoc && examId && classId) {
    return (
      <PdaDocument
        examId={examId}
        classId={classId}
        onClose={() => setShowDoc(false)}
      />
    );
  }

  const pendingChanges = dirty ? " • modifications non enregistrées" : "";

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

            <div className="space-y-1.5 w-full sm:w-auto sm:flex-1 sm:max-w-[300px]">
              <Label className="text-xs text-muted-foreground">Examen blanc</Label>
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
                            ? "Aucun examen"
                            : "Choisir un examen…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {exams.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        Examen Blanc N°{e.number} — {e.year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="outline"
                  className="shrink-0"
                  title="Nouvel examen blanc"
                  disabled={!hasSchool}
                  onClick={() => setShowCreate(true)}
                >
                  <CalendarPlus className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="shrink-0 text-destructive hover:text-destructive"
                  title="Supprimer cet examen blanc"
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
                        ? "Choisir un examen d'abord"
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
              <Button
                size="sm"
                variant="outline"
                disabled={!examId || !classId}
                onClick={() => setShowDoc(true)}
              >
                <FileText className="w-4 h-4 mr-1.5" />
                Document officiel
              </Button>
            </div>
          </div>

          {selectedExam && classInfo && (
            <p className="text-xs text-muted-foreground">
              Barème {classInfo.level} : <span className="font-medium">/{classInfo.max_score}</span>{" "}
              — Seuil de maîtrise : <span className="font-medium">{seuil}</span> ({selectedExam.threshold} %) —
              un élève « Admis » est présent avec une note ≥ au seuil dans la matière.
            </p>
          )}
        </CardContent>
      </Card>

      {/* === Grille de saisie === */}
      {!examId || !classId ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-12 text-center">
            <ClipboardCheck className="w-8 h-8 mx-auto mb-3 text-primary/50" />
            <p className="text-sm font-medium">
              Sélectionnez un examen blanc puis une classe CE/CM
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {exams.length === 0 && hasSchool
                ? "Aucun examen blanc pour cette école — créez-en un avec le bouton +."
                : "La grille de saisie s'affichera ici avec la maîtrise de chaque élève."}
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
                Saisie — Examen Blanc N°{selectedExam?.number} ({selectedExam?.year}) ·{" "}
                {classInfo?.name} · {students.length} élève(s)
                {pendingChanges && (
                  <span className="text-amber-600 font-normal">{pendingChanges}</span>
                )}
              </CardTitle>
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
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto scroll-sygren">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">#</TableHead>
                    <TableHead className="min-w-[180px]">Élève</TableHead>
                    <TableHead className="text-center w-[64px]">Présent</TableHead>
                    <TableHead className="text-center w-[96px]">Exploitation</TableHead>
                    <TableHead className="text-center w-[90px]">
                      <span className="sr-only">Maîtrise exploitation</span>
                    </TableHead>
                    <TableHead className="text-center w-[96px]">Mathématiques</TableHead>
                    <TableHead className="text-center w-[90px]">
                      <span className="sr-only">Maîtrise mathématiques</span>
                    </TableHead>
                    <TableHead className="text-center w-[96px]">Dictée</TableHead>
                    <TableHead className="text-center w-[90px]">
                      <span className="sr-only">Maîtrise dictée</span>
                    </TableHead>
                    <TableHead className="text-center w-[110px]">Niveau global</TableHead>
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
                    const nEx = parseNote(row.ex);
                    const nMath = parseNote(row.math);
                    const nDic = parseNote(row.dic);
                    const invalid =
                      Number.isNaN(nEx) || Number.isNaN(nMath) || Number.isNaN(nDic);
                    const graded = nEx !== null && nMath !== null && nDic !== null;
                    const allAdmis =
                      row.present &&
                      graded &&
                      nEx >= seuil &&
                      nMath >= seuil &&
                      nDic >= seuil;
                    return (
                      <TableRow key={s.student_id} className={row.present ? "" : "opacity-70"}>
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
                        ).map(([key, label]) => (
                          <Fragment key={key}>
                            <TableCell className="text-center">
                              <Input
                                value={row[key]}
                                onChange={(e) =>
                                  updateRow(s.student_id, { [key]: sanitizeNote(e.target.value) })
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
                                seuil={seuil}
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
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Dialog création d'examen blanc === */}
      <CreateExamDialog
        key={showCreate ? "open" : "closed"}
        open={showCreate}
        onOpenChange={setShowCreate}
        schoolId={schoolFilter}
        existing={exams}
        pending={createMutation.isPending}
        onCreate={(year, examDate, threshold) =>
          createMutation.mutate({ school_id: schoolFilter, year, exam_date: examDate || undefined, threshold })
        }
      />

      {/* === Dialog suppression === */}
      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="Supprimer l'examen blanc ?"
        description={
          selectedExam
            ? `L'Examen Blanc N°${selectedExam.number} (${selectedExam.year}) et tous ses résultats (notes + remédiation) seront définitivement supprimés.`
            : ""
        }
        confirmLabel="Supprimer"
        onConfirm={() => deleteMutation.mutate()}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

// === Dialog de création d'un examen blanc ===
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
  onCreate: (year: number, examDate: string, threshold: number) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [examDate, setExamDate] = useState("");
  const [threshold, setThreshold] = useState("50");

  // Numéro suivant proposé (info) : max + 1 pour l'année saisie
  const nextNumber = useMemo(() => {
    const y = Number(year) || currentYear;
    const nums = existing.filter((e) => e.year === y).map((e) => e.number);
    return (nums.length ? Math.max(...nums) : 0) + 1;
  }, [existing, year, currentYear]);

  const y = Number(year);
  const t = Number(threshold);
  const valid = Number.isFinite(y) && y >= 2000 && y <= 2100 && Number.isFinite(t) && t >= 1 && t <= 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nouvel examen blanc</DialogTitle>
          <DialogDescription>
            Le numéro N°{nextNumber} sera attribué automatiquement pour l&apos;année{" "}
            {year || currentYear}. Le plan d&apos;action suit les élèves de CE et CM.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
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
              <Label htmlFor="pda-threshold">Seuil de maîtrise (%)</Label>
              <Input
                id="pda-threshold"
                value={threshold}
                inputMode="numeric"
                onChange={(e) => setThreshold(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                placeholder="50"
              />
              <p className="text-[11px] text-muted-foreground">
                50 % = 5/10 en CE, 10/20 en CM
              </p>
            </div>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Annuler
          </Button>
          <Button
            disabled={!valid || !schoolId || pending}
            onClick={() => onCreate(y, examDate, t)}
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
            Créer l&apos;examen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
