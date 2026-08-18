"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Mail,
  Phone,
  MapPin,
  BarChart3,
  CheckCircle2,
} from "lucide-react";

import { inspectorsApi, iepApi } from "@/lib/api";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type { InspectorWithDetails, IEPWithStats } from "@/lib/types";
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
  iep_id: string;
}

const EMPTY: FormData = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
  iep_id: "",
};

export function InspectorsView() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["inspectors"],
    queryFn: inspectorsApi.list,
  });
  const { data: iepsData } = useQuery({
    queryKey: ["iep"],
    queryFn: iepApi.list,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InspectorWithDetails | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<InspectorWithDetails | null>(
    null,
  );

  const createMut = useCrudMutation(inspectorsApi.create, {
    invalidateKeys: [["inspectors"], ["iep"]],
    successMessage: "Inspecteur créé avec succès",
    actionLabel: "Création",
  });
  const updateMut = useCrudMutation(
    (id: string, data: FormData) =>
      inspectorsApi.update(id, {
        full_name: data.full_name || undefined,
        email: data.email || null,
        phone: data.phone || null,
        password: data.password || undefined,
        iep_id: data.iep_id || null,
      }),
    {
      invalidateKeys: [["inspectors"], ["iep"]],
      successMessage: "Inspecteur modifié avec succès",
      actionLabel: "Modification",
    },
  );
  const deleteMut = useCrudMutation(inspectorsApi.delete, {
    invalidateKeys: [["inspectors"], ["iep"]],
    successMessage: "Inspecteur supprimé",
    actionLabel: "Suppression",
  });

  function openCreate() {
    setForm(EMPTY);
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(i: InspectorWithDetails) {
    setForm({
      full_name: i.full_name,
      email: i.email ?? "",
      phone: i.phone ?? "",
      password: "",
      iep_id: i.iep_id ?? "",
    });
    setEditing(i);
    setDialogOpen(true);
  }
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
            iep_id: form.iep_id || undefined,
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

  const inspectors = data?.inspectors ?? [];
  const ieps = iepsData?.ieps ?? [];

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-base">Inspecteurs IEP</h2>
              <p className="text-xs text-muted-foreground">
                {inspectors.length} inspecteur(s) · un inspecteur par IEP
              </p>
            </div>
          </div>
          <Button onClick={openCreate} size="sm" className="shadow-sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Créer un inspecteur
          </Button>
        </CardContent>
      </Card>

      {inspectors.length === 0 ? (
        <EmptyState onCreate={openCreate} />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {inspectors.map((i, idx) => (
            <Card
              key={i.id}
              className="border-border/60 hover:shadow-md transition-shadow animate-in-up"
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{i.full_name}</p>
                      {i.active ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px]"
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Actif
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Inactif
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {i.email && (
                        <p className="flex items-center gap-1.5">
                          <Mail className="w-3 h-3" /> {i.email}
                        </p>
                      )}
                      {i.phone && (
                        <p className="flex items-center gap-1.5">
                          <Phone className="w-3 h-3" /> {i.phone}
                        </p>
                      )}
                      {i.iep_name && (
                        <p className="flex items-center gap-1.5">
                          <BarChart3 className="w-3 h-3" /> IEP {i.iep_name}
                        </p>
                      )}
                      {!i.iep_name && (
                        <p className="flex items-center gap-1.5 italic">
                          <MapPin className="w-3 h-3" /> Aucune IEP affectée
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(i)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(i)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EntityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Modifier l'inspecteur" : "Créer un inspecteur"}
        description={
          editing
            ? "Modifiez les informations du compte inspecteur."
            : "Créez un compte inspecteur (login par email OU téléphone)."
        }
        icon={ShieldCheck}
        loading={createMut.isPending || updateMut.isPending}
      >
        <form onSubmit={onSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="inspector-name">Nom complet</Label>
            <Input
              id="inspector-name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="Ex : Bamba Ibrahim"
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="inspector-email">Email</Label>
              <Input
                id="inspector-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="email@sygren.ci"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inspector-phone">Téléphone</Label>
              <Input
                id="inspector-phone"
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
            <Label htmlFor="inspector-password">
              {editing ? "Nouveau mot de passe (optionnel)" : "Mot de passe"}
            </Label>
            <Input
              id="inspector-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={editing ? "Laisser vide pour ne pas changer" : "••••••••"}
              required={!editing}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inspector-iep">IEP supervisée</Label>
            <Select
              value={form.iep_id}
              onValueChange={(v) => setForm({ ...form, iep_id: v })}
            >
              <SelectTrigger id="inspector-iep">
                <SelectValue placeholder="Choisir une IEP…" />
              </SelectTrigger>
              <SelectContent>
                {ieps.map((iep: IEPWithStats) => (
                  <SelectItem key={iep.id} value={iep.id}>
                    {iep.name} {iep.region ? `— ${iep.region}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Un seul inspecteur actif par IEP.
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
              disabled={!editing && (!form.full_name || !form.password || (!form.email && !form.phone))}
            >
              {editing ? "Enregistrer" : "Créer l'inspecteur"}
            </Button>
          </div>
        </form>
      </EntityDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer l'inspecteur ?"
        description={
          deleteTarget
            ? `Supprimer le compte de "${deleteTarget.full_name}" ? Cette action est irréversible.`
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
        <p className="text-sm">Chargement des inspecteurs…</p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-10 text-center">
        <p className="text-sm text-destructive font-medium">
          Impossible de charger les inspecteurs
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
        <ShieldCheck className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium">Aucun inspecteur enregistré</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          {onCreate
            ? "Créez des comptes inspecteurs pour superviser les IEP."
            : "Les inspecteurs apparaîtront ici."}
        </p>
        {onCreate && (
          <Button onClick={onCreate} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Créer un inspecteur
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
