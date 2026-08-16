"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Mail,
  Phone,
  BookOpen,
  ShieldCheck,
} from "lucide-react";

import { teachersApi, schoolsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type { TeacherWithDetails, SchoolWithStats } from "@/lib/types";
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
  full_name: string;
  email: string;
  phone: string;
  password: string;
  school_id: string;
}

const EMPTY: FormData = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
  school_id: "",
};

export function TeachersView() {
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === "admin" || user?.role === "director";

  const { data, isLoading, error } = useQuery({
    queryKey: ["teachers"],
    queryFn: teachersApi.list,
  });
  const { data: schoolsData } = useQuery({
    queryKey: ["schools"],
    queryFn: schoolsApi.list,
    enabled: canEdit,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TeacherWithDetails | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<TeacherWithDetails | null>(
    null,
  );

  const createMut = useCrudMutation(teachersApi.create, {
    invalidateKeys: [["teachers"], ["classes"]],
    successMessage: "Enseignant créé avec succès",
    actionLabel: "Création",
  });
  const updateMut = useCrudMutation(
    (id: string, data: FormData) =>
      teachersApi.update(id, {
        full_name: data.full_name || undefined,
        email: data.email || null,
        phone: data.phone || null,
        password: data.password || undefined,
        school_id: data.school_id || null,
      }),
    {
      invalidateKeys: [["teachers"], ["classes"]],
      successMessage: "Enseignant modifié avec succès",
      actionLabel: "Modification",
    },
  );
  const deleteMut = useCrudMutation(teachersApi.delete, {
    invalidateKeys: [["teachers"], ["classes"]],
    successMessage: "Enseignant supprimé",
    actionLabel: "Suppression",
  });

  function openCreate() {
    const defaultSchool =
      user?.role === "director" && schoolsData?.schools[0]
        ? schoolsData.schools[0].id
        : "";
    setForm({ ...EMPTY, school_id: defaultSchool });
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(t: TeacherWithDetails) {
    setForm({
      full_name: t.full_name,
      email: t.email ?? "",
      phone: t.phone ?? "",
      password: "",
      school_id: t.school_id ?? "",
    });
    setEditing(t);
    setDialogOpen(true);
  }
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Au moins un identifiant requis (email OU téléphone)
    if (!form.email && !form.phone) return;
    try {
      if (editing) {
        await updateMut.mutateAsync([editing.id, form]);
      } else {
        if (!form.password) return;
        await createMut.mutateAsync([
          {
            full_name: form.full_name,
            email: form.email || undefined,
            phone: form.phone || undefined,
            password: form.password,
            school_id: form.school_id || undefined,
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

  const teachers = data?.teachers ?? [];
  const schools = schoolsData?.schools ?? [];

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-base">Enseignants</h2>
              <p className="text-xs text-muted-foreground">
                {teachers.length} enseignant(s) · comptes + affectation
              </p>
            </div>
          </div>
          {canEdit && (
            <Button onClick={openCreate} size="sm" className="shadow-sm">
              <Plus className="w-4 h-4 mr-1.5" />
              Créer un enseignant
            </Button>
          )}
        </CardContent>
      </Card>

      {teachers.length === 0 ? (
        <EmptyState onCreate={canEdit ? openCreate : undefined} />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {teachers.map((t, i) => (
            <Card
              key={t.id}
              className="border-border/60 hover:shadow-md transition-shadow animate-in-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{t.full_name}</p>
                      {t.active ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px]"
                        >
                          <ShieldCheck className="w-3 h-3 mr-1" />
                          Actif
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Inactif
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {t.email && (
                        <p className="flex items-center gap-1.5">
                          <Mail className="w-3 h-3" /> {t.email}
                        </p>
                      )}
                      {t.phone && (
                        <p className="flex items-center gap-1.5">
                          <Phone className="w-3 h-3" /> {t.phone}
                        </p>
                      )}
                      {t.school_name && (
                        <p className="flex items-center gap-1.5">
                          <BookOpen className="w-3 h-3" /> {t.school_name}
                        </p>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(t)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(t)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                {t.class_name && (
                  <Badge
                    variant="secondary"
                    className="mt-3 text-[10px]"
                  >
                    Classe : {t.class_name}
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {canEdit && (
        <EntityDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={editing ? "Modifier l'enseignant" : "Créer un enseignant"}
          description={
            editing
              ? "Modifiez les informations du compte enseignant."
              : "Créez un compte enseignant (login par email OU téléphone)."
          }
          icon={Users}
          loading={createMut.isPending || updateMut.isPending}
        >
          <form onSubmit={onSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="teacher-name">Nom complet</Label>
              <Input
                id="teacher-name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Ex : Konan Marie"
                required
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="teacher-email">Email</Label>
                <Input
                  id="teacher-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="email@sygren.ci"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="teacher-phone">Téléphone</Label>
                <Input
                  id="teacher-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+225 07 00 00 00"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">
              Au moins un email OU un téléphone est requis (cahier des charges §4.1)
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="teacher-password">
                {editing ? "Nouveau mot de passe (optionnel)" : "Mot de passe"}
              </Label>
              <Input
                id="teacher-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editing ? "Laisser vide pour ne pas changer" : "••••••••"}
                required={!editing}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="teacher-school">École</Label>
              <Select
                value={form.school_id}
                onValueChange={(v) => setForm({ ...form, school_id: v })}
              >
                <SelectTrigger id="teacher-school">
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
                disabled={!editing && (!form.full_name || !form.password || (!form.email && !form.phone))}
              >
                {editing ? "Enregistrer" : "Créer l'enseignant"}
              </Button>
            </div>
          </form>
        </EntityDialog>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer l'enseignant ?"
        description={
          deleteTarget
            ? `Supprimer le compte de "${deleteTarget.full_name}" ? Sa classe sera désaffectée.`
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
        <p className="text-sm">Chargement des enseignants…</p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-10 text-center">
        <p className="text-sm text-destructive font-medium">
          Impossible de charger les enseignants
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
        <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium">Aucun enseignant enregistré</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          {onCreate
            ? "Créez des comptes enseignants pour qu'ils puissent saisir les notes."
            : "Les enseignants apparaîtront ici."}
        </p>
        {onCreate && (
          <Button onClick={onCreate} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Créer un enseignant
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
