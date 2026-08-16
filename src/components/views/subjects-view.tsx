"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Plus, Pencil, Trash2, Search, Loader2 } from "lucide-react";

import { subjectsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type { Subject } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EntityDialog } from "@/components/entity-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface FormData {
  name: string;
  coefficient: string;
}

const EMPTY: FormData = { name: "", coefficient: "1" };

export function SubjectsView() {
  const user = useAuthStore((s) => s.user);
  const canEdit =
    user?.role === "admin" || user?.role === "director";

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<Subject | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["subjects"],
    queryFn: subjectsApi.list,
  });

  const createMut = useCrudMutation(subjectsApi.create, {
    invalidateKeys: [["subjects"]],
    successMessage: "Matière créée avec succès",
    actionLabel: "Création",
  });
  const updateMut = useCrudMutation(
    (id: string, data: { name: string; coefficient: number }) =>
      subjectsApi.update(id, data),
    {
      invalidateKeys: [["subjects"]],
      successMessage: "Matière modifiée avec succès",
      actionLabel: "Modification",
    },
  );
  const deleteMut = useCrudMutation(subjectsApi.delete, {
    invalidateKeys: [["subjects"]],
    successMessage: "Matière supprimée",
    actionLabel: "Suppression",
  });

  function openCreate() {
    setForm(EMPTY);
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(s: Subject) {
    setForm({ name: s.name, coefficient: String(s.coefficient) });
    setEditing(s);
    setDialogOpen(true);
  }
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const coef = parseFloat(form.coefficient) || 1;
    try {
      if (editing) {
        await updateMut.mutateAsync([editing.id, { name: form.name, coefficient: coef }]);
      } else {
        await createMut.mutateAsync([{ name: form.name, coefficient: coef }]);
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

  const subjects = data?.subjects ?? [];
  const filtered = subjects.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <BookOpen className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Matières</h2>
                <p className="text-xs text-muted-foreground">
                  {subjects.length} matière(s) · coefficient par défaut = 1
                </p>
              </div>
            </div>
            {canEdit && (
              <Button onClick={openCreate} size="sm" className="shadow-sm">
                <Plus className="w-4 h-4 mr-1.5" />
                Nouvelle matière
              </Button>
            )}
          </div>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une matière…"
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Aucune matière trouvée</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((subject, i) => (
            <Card
              key={subject.id}
              className="border-border/60 hover:shadow-md hover:border-primary/30 transition-all animate-in-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <CardContent className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-sm">
                    {subject.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{subject.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Créée le{" "}
                      {new Date(subject.created_at).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-mono">
                    coef. {subject.coefficient}
                  </Badge>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(subject)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(subject)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {canEdit && (
        <EntityDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={editing ? "Modifier la matière" : "Nouvelle matière"}
          description={
            editing
              ? "Modifiez le nom ou le coefficient."
              : "Ajoutez une nouvelle discipline."
          }
          icon={BookOpen}
          loading={createMut.isPending || updateMut.isPending}
        >
          <form onSubmit={onSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="subject-name">Nom de la matière</Label>
              <Input
                id="subject-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex : Lecture"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject-coef">Coefficient</Label>
              <Input
                id="subject-coef"
                type="number"
                step="0.5"
                min="0.5"
                value={form.coefficient}
                onChange={(e) =>
                  setForm({ ...form, coefficient: e.target.value })
                }
              />
              <p className="text-[11px] text-muted-foreground">
                Coefficient par défaut = 1 pour les compositions mensuelles
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
              <Button type="submit">
                {editing ? "Enregistrer" : "Créer la matière"}
              </Button>
            </div>
          </form>
        </EntityDialog>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer la matière ?"
        description={
          deleteTarget
            ? `Supprimer "${deleteTarget.name}" ? Les notes déjà saisies pour cette matière ne seront plus accessibles.`
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
        <p className="text-sm">Chargement des matières…</p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-10 text-center">
        <p className="text-sm text-destructive font-medium">
          Impossible de charger les matières
        </p>
        <p className="text-xs text-muted-foreground mt-1">{message}</p>
      </CardContent>
    </Card>
  );
}
