"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Users,
  UserCheck,
  Loader2,
} from "lucide-react";

import { classesApi, schoolsApi, teachersApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type {
  ClassWithDetails,
  SchoolWithStats,
  TeacherWithDetails,
  ClassName,
} from "@/lib/types";
import { CLASS_NAMES } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { EntityDialog } from "@/components/entity-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface FormData {
  school_id: string;
  name: ClassName | "";
  teacher_id: string | null;
}

const EMPTY: FormData = { school_id: "", name: "", teacher_id: null };

// Badge color by class level
const LEVEL_COLORS: Record<string, string> = {
  CP: "bg-blue-100 text-blue-700 border-blue-200",
  CE: "bg-amber-100 text-amber-700 border-amber-200",
  CM: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export function ClassesView() {
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === "admin" || user?.role === "director";

  const { data, isLoading, error } = useQuery({
    queryKey: ["classes"],
    queryFn: () => classesApi.list(),
  });
  const { data: schoolsData } = useQuery({
    queryKey: ["schools"],
    queryFn: schoolsApi.list,
    enabled: canEdit,
  });
  const { data: teachersData } = useQuery({
    queryKey: ["teachers", "include-directors"],
    queryFn: () => teachersApi.list({ includeDirectors: true }),
    enabled: canEdit,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClassWithDetails | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<ClassWithDetails | null>(
    null,
  );

  const createMut = useCrudMutation(classesApi.create, {
    invalidateKeys: [["classes"], ["schools"]],
    successMessage: "Classe créée avec succès",
    actionLabel: "Création",
  });
  const updateMut = useCrudMutation(
    (id: string, data: FormData) =>
      classesApi.update(id, {
        name: data.name || undefined,
        teacher_id: data.teacher_id || null,
      }),
    {
      invalidateKeys: [["classes"], ["teachers"]],
      successMessage: "Classe modifiée avec succès",
      actionLabel: "Modification",
    },
  );
  const deleteMut = useCrudMutation(classesApi.delete, {
    invalidateKeys: [["classes"], ["schools"]],
    successMessage: "Classe supprimée",
    actionLabel: "Suppression",
  });

  function openCreate() {
    // Pré-remplir l'école si directeur (école unique)
    const defaultSchool =
      user?.role === "director" && schoolsData?.schools[0]
        ? schoolsData.schools[0].id
        : "";
    setForm({ ...EMPTY, school_id: defaultSchool });
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(c: ClassWithDetails) {
    setForm({
      school_id: c.school_id,
      name: c.name as ClassName,
      teacher_id: c.teacher_id ?? null,
    });
    setEditing(c);
    setDialogOpen(true);
  }
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name) return;
    try {
      if (editing) {
        await updateMut.mutateAsync([editing.id, form]);
      } else {
        await createMut.mutateAsync([
          {
            school_id: form.school_id,
            name: form.name,
            teacher_id: form.teacher_id || undefined,
          },
        ]);
      }
      setDialogOpen(false);
    } catch {
      /* toastée */
    }
  }
  async function onDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync([deleteTarget.id]);
      setDeleteTarget(null);
    } catch {
      /* toastée */
    }
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;

  const classes = data?.classes ?? [];
  const schools = schoolsData?.schools ?? [];
  const teachers = teachersData?.teachers ?? [];
  // Enseignants disponibles (non déjà affectés, ou celui en cours d'édition)
  const availableTeachers = teachers.filter(
    (t) => !t.class_name || (editing && t.id === editing.teacher_id),
  );

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-base">Classes</h2>
              <p className="text-xs text-muted-foreground">
                {classes.length} classe(s) · CP1 → CM2
              </p>
            </div>
          </div>
          {canEdit && (
            <Button onClick={openCreate} size="sm" className="shadow-sm">
              <Plus className="w-4 h-4 mr-1.5" />
              Nouvelle classe
            </Button>
          )}
        </CardContent>
      </Card>

      {classes.length === 0 ? (
        <EmptyState onCreate={canEdit ? openCreate : undefined} />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c, i) => {
            const level = (c.name.match(/^(CP|CE|CM)/)?.[0] ?? "CP") as string;
            return (
              <Card
                key={c.id}
                className="border-border/60 hover:shadow-md transition-shadow animate-in-up"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold">{c.name}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${LEVEL_COLORS[level]}`}
                        >
                          {level}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {c.school_name ?? "École inconnue"}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(c)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 space-y-1.5 text-xs">
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <UserCheck className="w-3 h-3" />
                      {c.teacher_name ?? "Aucun enseignant affecté"}
                    </p>
                    <p className="flex items-center gap-1.5 text-muted-foreground">
                      <Users className="w-3 h-3" />
                      {c.student_count} élève(s)
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {canEdit && (
        <EntityDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={editing ? "Modifier la classe" : "Nouvelle classe"}
          description={
            editing
              ? "Modifiez le nom ou l'affectation de l'enseignant."
              : "Créez une nouvelle classe (CP1 à CM2)."
          }
          icon={BookOpen}
          loading={createMut.isPending || updateMut.isPending}
        >
          <form onSubmit={onSubmit} className="space-y-4 pt-2">
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="class-school">École</Label>
                <Select
                  value={form.school_id}
                  onValueChange={(v) => setForm({ ...form, school_id: v })}
                >
                  <SelectTrigger id="class-school">
                    <SelectValue placeholder="Choisir une école…" />
                  </SelectTrigger>
                  <SelectContent>
                    {schools.map((s: SchoolWithStats) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="class-name">Niveau</Label>
                <Select
                  value={form.name}
                  onValueChange={(v) => setForm({ ...form, name: v as ClassName })}
                >
                  <SelectTrigger id="class-name">
                    <SelectValue placeholder="Choisir un niveau…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLASS_NAMES.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="class-teacher">Enseignant affecté</Label>
              <Select
                value={form.teacher_id ?? "none"}
                onValueChange={(v) =>
                  setForm({ ...form, teacher_id: v === "none" ? null : v })
                }
              >
                <SelectTrigger id="class-teacher">
                  <SelectValue placeholder="Aucun enseignant" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Aucun —</SelectItem>
                  {availableTeachers.map((t: TeacherWithDetails) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-1.5">
                        <span>{t.full_name}</span>
                        {t.role === "director" && (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 px-1.5 h-4 font-medium border-amber-300 text-amber-700 bg-amber-50"
                          >
                            Directeur
                          </Badge>
                        )}
                        {t.email && (
                          <span className="text-[11px] text-muted-foreground">
                            ({t.email})
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Affectation dynamique (cahier des charges §3)
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={!editing && (!form.school_id || !form.name)}
              >
                {editing ? "Enregistrer" : "Créer la classe"}
              </Button>
            </div>
          </form>
        </EntityDialog>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer la classe ?"
        description={
          deleteTarget
            ? `Supprimer la classe "${deleteTarget.name}" ? Elle ne doit contenir aucun élève.`
            : ""
        }
        confirmLabel="Supprimer"
        destructive
        icon={Trash2}
        onConfirm={onDelete}
        loading={deleteMut.isPending}
      />
    </div>
  );
}

function LoadingState() {
  return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm">Chargement des classes…</p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-10 text-center">
        <p className="text-sm text-destructive font-medium">
          Impossible de charger les classes
        </p>
        <p className="text-xs text-muted-foreground mt-1">{message}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate?: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 text-center">
        <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium">Aucune classe créée</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          {onCreate
            ? "Créez vos classes de CP1 à CM2."
            : "Les classes apparaîtront ici une fois créées."}
        </p>
        {onCreate && (
          <Button onClick={onCreate} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Créer une classe
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
