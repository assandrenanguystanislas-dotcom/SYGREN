"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Plus, Pencil, Trash2, MapPin, School as SchoolIcon, Loader2, User, Mail, Phone, MapPinned } from "lucide-react";

import { iepApi } from "@/lib/api";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type { IEPWithStats } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EntityDialog } from "@/components/entity-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface FormData {
  name: string;
  region: string;
  // === Informations de l'inspecteur titulaire ===
  // Alimentent le document de synthèse (signatures + en-tête contact).
  inspector_name: string;
  inspector_email: string;
  inspector_phone: string;
  bp: string;
}

const EMPTY: FormData = {
  name: "",
  region: "",
  inspector_name: "",
  inspector_email: "",
  inspector_phone: "",
  bp: "",
};

export function IepView() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["iep"],
    queryFn: iepApi.list,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IEPWithStats | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<IEPWithStats | null>(null);

  const createMut = useCrudMutation(iepApi.create, {
    invalidateKeys: [["iep"]],
    successMessage: "IEP créée avec succès",
    actionLabel: "Création",
  });
  const updateMut = useCrudMutation(
    (id: string, data: FormData) => iepApi.update(id, data),
    {
      invalidateKeys: [["iep"]],
      successMessage: "IEP modifiée avec succès",
      actionLabel: "Modification",
    },
  );
  const deleteMut = useCrudMutation(iepApi.delete, {
    invalidateKeys: [["iep"], ["schools"]],
    successMessage: "IEP supprimée",
    actionLabel: "Suppression",
  });

  function openCreate() {
    setForm(EMPTY);
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(iep: IEPWithStats) {
    setForm({
      name: iep.name,
      region: iep.region,
      inspector_name: iep.inspector_name || "",
      inspector_email: iep.inspector_email || "",
      inspector_phone: iep.inspector_phone || "",
      bp: iep.bp || "",
    });
    setEditing(iep);
    setDialogOpen(true);
  }
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const loading = editing ? updateMut.isPending : createMut.isPending;
    if (loading) return;
    try {
      if (editing) {
        await updateMut.mutateAsync([editing.id, form]);
      } else {
        await createMut.mutateAsync([form]);
      }
      setDialogOpen(false);
    } catch {
      // erreur déjà toastée par le hook
    }
  }
  async function onDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync([deleteTarget.id]);
      setDeleteTarget(null);
    } catch {
      // erreur déjà toastée
    }
  }

  if (isLoading) return <LoadingState />;

  if (error) return <ErrorState message={(error as Error).message} />;

  const ieps = data?.ieps ?? [];

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <Card className="border-border/60">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-base">Inspections (IEP)</h2>
              <p className="text-xs text-muted-foreground">
                {ieps.length} inspection(s) · circonscriptions scolaires
              </p>
            </div>
          </div>
          <Button onClick={openCreate} size="sm" className="shadow-sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Nouvelle IEP
          </Button>
        </CardContent>
      </Card>

      {/* Liste */}
      {ieps.length === 0 ? (
        <EmptyState onCreate={openCreate} />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {ieps.map((iep, i) => (
            <Card
              key={iep.id}
              className="border-border/60 hover:shadow-md transition-shadow animate-in-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{iep.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3" /> {iep.region || "—"}
                    </p>
                    {iep.inspector_name && (
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                        <User className="w-3 h-3" /> {iep.inspector_name}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(iep)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(iep)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-xs">
                    <SchoolIcon className="w-3 h-3 mr-1" />
                    {iep.school_count} école(s)
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog création/modification */}
      <EntityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Modifier l'IEP" : "Nouvelle IEP"}
        description={
          editing
            ? "Modifiez les informations de l'inspection."
            : "Créez une nouvelle circonscription scolaire."
        }
        icon={BarChart3}
        loading={createMut.isPending || updateMut.isPending}
      >
        <form onSubmit={onSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="iep-name">Nom de l'IEP</Label>
            <Input
              id="iep-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex : IEP Abidjan 1"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="iep-region">Région</Label>
            <Input
              id="iep-region"
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
              placeholder="Ex : Abidjan"
            />
          </div>

          {/* === Informations de l'inspecteur titulaire ===
              Ces champs sont importés automatiquement dans le document de
              synthèse (signatures + en-tête BP/Tel/Courriel). Section
              visuellement séparée car elle représente le titulaire, pas
              l'institution elle-même. */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
            <div className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">
                Inspecteur titulaire
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">
              Ces informations alimentent automatiquement les signatures et
              l&apos;en-tête du document de synthèse des résultats.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="iep-inspector-name" className="text-xs">
                Nom et prénom de l&apos;inspecteur
              </Label>
              <Input
                id="iep-inspector-name"
                value={form.inspector_name}
                onChange={(e) => setForm({ ...form, inspector_name: e.target.value })}
                placeholder="Ex : M. Konan Yao Bernard"
                className="text-sm"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="iep-inspector-email" className="text-xs flex items-center gap-1">
                  <Mail className="w-3 h-3" /> Courriel
                </Label>
                <Input
                  id="iep-inspector-email"
                  type="email"
                  value={form.inspector_email}
                  onChange={(e) => setForm({ ...form, inspector_email: e.target.value })}
                  placeholder="exemple@iep.edu.ci"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iep-inspector-phone" className="text-xs flex items-center gap-1">
                  <Phone className="w-3 h-3" /> Téléphone
                </Label>
                <Input
                  id="iep-inspector-phone"
                  value={form.inspector_phone}
                  onChange={(e) => setForm({ ...form, inspector_phone: e.target.value })}
                  placeholder="Ex : +225 27 21 00 00 00"
                  className="text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iep-bp" className="text-xs flex items-center gap-1">
                <MapPinned className="w-3 h-3" /> Boîte postale (BP) de l&apos;IEP
              </Label>
              <Input
                id="iep-bp"
                value={form.bp}
                onChange={(e) => setForm({ ...form, bp: e.target.value })}
                placeholder="Ex : BP 1234 Dabou"
                className="text-sm"
              />
            </div>
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
              {editing ? "Enregistrer" : "Créer l'IEP"}
            </Button>
          </div>
        </form>
      </EntityDialog>

      {/* Dialogue de confirmation suppression */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer l'IEP ?"
        description={
          deleteTarget
            ? `Êtes-vous sûr de vouloir supprimer "${deleteTarget.name}" ? Cette action est irréversible.`
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
        <p className="text-sm">Chargement des IEP…</p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-10 text-center">
        <p className="text-sm text-destructive font-medium">
          Impossible de charger les IEP
        </p>
        <p className="text-xs text-muted-foreground mt-1">{message}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 text-center">
        <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium">Aucune IEP configurée</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Créez votre première circonscription scolaire pour commencer.
        </p>
        <Button onClick={onCreate} size="sm">
          <Plus className="w-4 h-4 mr-1.5" />
          Créer une IEP
        </Button>
      </CardContent>
    </Card>
  );
}
