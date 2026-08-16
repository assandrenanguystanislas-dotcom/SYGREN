"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  School as SchoolIcon,
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Users,
  BookOpen,
  Loader2,
} from "lucide-react";

import { schoolsApi, iepApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type { SchoolWithStats, IEPWithStats } from "@/lib/types";
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
  iep_id: string;
  name: string;
  address: string;
}

const EMPTY: FormData = { iep_id: "", name: "", address: "" };

export function SchoolsView() {
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === "admin";

  const { data, isLoading, error } = useQuery({
    queryKey: ["schools"],
    queryFn: schoolsApi.list,
  });
  const { data: iepData } = useQuery({
    queryKey: ["iep"],
    queryFn: iepApi.list,
    enabled: canEdit,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolWithStats | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<SchoolWithStats | null>(null);

  const createMut = useCrudMutation(schoolsApi.create, {
    invalidateKeys: [["schools"], ["iep"]],
    successMessage: "École créée avec succès",
    actionLabel: "Création",
  });
  const updateMut = useCrudMutation(
    (id: string, data: FormData) => schoolsApi.update(id, data),
    {
      invalidateKeys: [["schools"]],
      successMessage: "École modifiée avec succès",
      actionLabel: "Modification",
    },
  );
  const deleteMut = useCrudMutation(schoolsApi.delete, {
    invalidateKeys: [["schools"], ["iep"]],
    successMessage: "École supprimée",
    actionLabel: "Suppression",
  });

  function openCreate() {
    setForm(EMPTY);
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(s: SchoolWithStats) {
    setForm({ iep_id: s.iep_id, name: s.name, address: s.address });
    setEditing(s);
    setDialogOpen(true);
  }
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (editing) {
        await updateMut.mutateAsync([editing.id, form]);
      } else {
        await createMut.mutateAsync([form]);
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

  const schools = data?.schools ?? [];
  const ieps = iepData?.ieps ?? [];

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <SchoolIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-base">Écoles</h2>
              <p className="text-xs text-muted-foreground">
                {schools.length} établissement(s) · rattaché(s) aux IEP
              </p>
            </div>
          </div>
          {canEdit && (
            <Button onClick={openCreate} size="sm" className="shadow-sm">
              <Plus className="w-4 h-4 mr-1.5" />
              Nouvelle école
            </Button>
          )}
        </CardContent>
      </Card>

      {schools.length === 0 ? (
        <EmptyState onCreate={canEdit ? openCreate : undefined} />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {schools.map((s, i) => (
            <Card
              key={s.id}
              className="border-border/60 hover:shadow-md transition-shadow animate-in-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3" />
                      {s.address || "Adresse non renseignée"}
                    </p>
                    {s.iep_name && (
                      <Badge variant="outline" className="mt-2 text-[10px]">
                        {s.iep_name}
                      </Badge>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(s)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(s)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3 h-3" />
                    {s.class_count} classe(s)
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {s.student_count} élève(s)
                  </span>
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
          title={editing ? "Modifier l'école" : "Nouvelle école"}
          description={
            editing
              ? "Modifiez les informations de l'établissement."
              : "Rattachez un nouvel établissement à une IEP."
          }
          icon={SchoolIcon}
          loading={createMut.isPending || updateMut.isPending}
        >
          <form onSubmit={onSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="school-iep">IEP de rattachement</Label>
              <Select
                value={form.iep_id}
                onValueChange={(v) => setForm({ ...form, iep_id: v })}
              >
                <SelectTrigger id="school-iep">
                  <SelectValue placeholder="Choisir une IEP…" />
                </SelectTrigger>
                <SelectContent>
                  {ieps.map((iep: IEPWithStats) => (
                    <SelectItem key={iep.id} value={iep.id}>
                      {iep.name} — {iep.region}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {ieps.length === 0 && (
                <p className="text-xs text-destructive">
                  Aucune IEP — créez-en une d'abord.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school-name">Nom de l'école</Label>
              <Input
                id="school-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex : École Primaire Publique du Plateau"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="school-address">Adresse</Label>
              <Input
                id="school-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Ex : Bd Laguna, Abidjan"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={!form.iep_id}>
                {editing ? "Enregistrer" : "Créer l'école"}
              </Button>
            </div>
          </form>
        </EntityDialog>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer l'école ?"
        description={
          deleteTarget
            ? `Supprimer "${deleteTarget.name}" ? Les classes et élèves rattachés devront être traités au préalable.`
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
        <p className="text-sm">Chargement des écoles…</p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-10 text-center">
        <p className="text-sm text-destructive font-medium">
          Impossible de charger les écoles
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
        <SchoolIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium">Aucune école enregistrée</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          {onCreate
            ? "Créez votre premier établissement scolaire."
            : "Les écoles apparaîtront ici une fois créées par l'administrateur."}
        </p>
        {onCreate && (
          <Button onClick={onCreate} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Créer une école
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
