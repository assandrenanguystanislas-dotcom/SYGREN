"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Mail,
  Phone,
  School as SchoolIcon,
  ShieldCheck,
  MapPin,
  Search,
} from "lucide-react";

import { directorsApi, schoolsApi, iepApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type { DirectorWithDetails, SchoolWithStats } from "@/lib/types";
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

export function DirectorsView() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";

  // === Filtres en cascade : IEP → École → recherche ===
  // - admin : peut choisir un IEP puis une école (cascade)
  // - inspector : son IEP est figé par le backend (RBAC) → pas de filtre IEP
  const [iepFilter, setIepFilter] = useState<string>("all");
  const [schoolFilter, setSchoolFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["directors"],
    queryFn: directorsApi.list,
  });
  const { data: schoolsData } = useQuery({
    queryKey: ["schools"],
    queryFn: schoolsApi.list,
  });
  // IEPs (admin seulement — inspector a son IEP figé par le backend RBAC)
  const { data: iepsData } = useQuery({
    queryKey: ["iep"],
    queryFn: iepApi.list,
    enabled: isAdmin,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DirectorWithDetails | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<DirectorWithDetails | null>(
    null,
  );

  const createMut = useCrudMutation(directorsApi.create, {
    invalidateKeys: [["directors"], ["schools"]],
    successMessage: "Directeur créé avec succès",
    actionLabel: "Création",
  });
  const updateMut = useCrudMutation(
    (id: string, data: FormData) =>
      directorsApi.update(id, {
        full_name: data.full_name || undefined,
        email: data.email || null,
        phone: data.phone || null,
        password: data.password || undefined,
        school_id: data.school_id || null,
      }),
    {
      invalidateKeys: [["directors"], ["schools"]],
      successMessage: "Directeur modifié avec succès",
      actionLabel: "Modification",
    },
  );
  const deleteMut = useCrudMutation(directorsApi.delete, {
    invalidateKeys: [["directors"], ["schools"]],
    successMessage: "Directeur supprimé",
    actionLabel: "Suppression",
  });

  function openCreate() {
    setForm(EMPTY);
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(d: DirectorWithDetails) {
    setForm({
      full_name: d.full_name,
      email: d.email ?? "",
      phone: d.phone ?? "",
      password: "",
      school_id: d.school_id ?? "",
    });
    setEditing(d);
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

  const directors = data?.directors ?? [];
  const schools = schoolsData?.schools ?? [];
  const ieps = iepsData?.ieps ?? [];

  // Cascade : écoles filtrées par IEP sélectionné (alimente le select École)
  const filteredSchools =
    iepFilter !== "all"
      ? schools.filter((s) => s.iep_id === iepFilter)
      : schools;

  // Filtrage côté client : IEP (via école) → École → recherche texte.
  // Le backend filtre déjà par rôle (admin voit tout, inspector voit son IEP).
  const filtered = directors.filter((d) => {
    if (schoolFilter !== "all" && d.school_id !== schoolFilter) return false;
    if (iepFilter !== "all") {
      const school = schools.find((s) => s.id === d.school_id);
      if (!school || school.iep_id !== iepFilter) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      if (
        !d.full_name.toLowerCase().includes(q) &&
        !(d.email ?? "").toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Directeurs d&apos;école</h2>
                <p className="text-xs text-muted-foreground">
                  {filtered.length} directeur(s) · un directeur par école
                </p>
              </div>
            </div>
            <Button onClick={openCreate} size="sm" className="shadow-sm">
              <Plus className="w-4 h-4 mr-1.5" />
              Créer un directeur
            </Button>
          </div>
          {/* === Filtres en cascade : IEP → École → recherche ===
              - admin : IEP (tous) → École (cascade selon IEP) → recherche
              - inspector : son IEP est figé par le backend (RBAC) → École + recherche
              - autres : École + recherche */}
          <div className="flex flex-wrap items-end gap-3">
            {/* Filtre IEP (admin seulement) */}
            {isAdmin && (
              <div className="space-y-1.5 min-w-[180px] flex-1 max-w-[280px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> IEP
                </label>
                <Select
                  value={iepFilter}
                  onValueChange={(v) => {
                    setIepFilter(v);
                    setSchoolFilter("all"); // reset école quand IEP change
                  }}
                >
                  <SelectTrigger className="w-full overflow-hidden">
                    <SelectValue placeholder="Tous les IEP" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les IEP</SelectItem>
                    {ieps.map((iep) => (
                      <SelectItem key={iep.id} value={iep.id}>
                        {iep.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Filtre École (cascade selon IEP) */}
            <div className="space-y-1.5 min-w-[200px] flex-1 max-w-[300px] min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <SchoolIcon className="w-3 h-3" /> École
              </label>
              <Select
                value={schoolFilter}
                onValueChange={setSchoolFilter}
                disabled={filteredSchools.length === 0}
              >
                <SelectTrigger className="w-full overflow-hidden">
                  <SelectValue placeholder="Toutes les écoles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les écoles</SelectItem>
                  {filteredSchools.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recherche texte (toujours disponible) */}
            <div className="relative flex-1 min-w-[200px] min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
                <Search className="w-3 h-3" /> Rechercher
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Par nom ou email…"
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {directors.length === 0 ? (
        <EmptyState onCreate={openCreate} />
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium">
              Aucun directeur ne correspond à votre recherche
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Modifiez les filtres pour élargir la recherche.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d, i) => (
            <Card
              key={d.id}
              className="border-border/60 hover:shadow-md transition-shadow animate-in-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{d.full_name}</p>
                      {d.active ? (
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
                      {d.email && (
                        <p className="flex items-center gap-1.5">
                          <Mail className="w-3 h-3" /> {d.email}
                        </p>
                      )}
                      {d.phone && (
                        <p className="flex items-center gap-1.5">
                          <Phone className="w-3 h-3" /> {d.phone}
                        </p>
                      )}
                      {d.school_name && (
                        <p className="flex items-center gap-1.5">
                          <SchoolIcon className="w-3 h-3" /> {d.school_name}
                        </p>
                      )}
                      {d.iep_name && (
                        <p className="flex items-center gap-1.5">
                          <MapPin className="w-3 h-3" /> IEP {d.iep_name}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(d)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(d)}
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
        title={editing ? "Modifier le directeur" : "Créer un directeur"}
        description={
          editing
            ? "Modifiez les informations du compte directeur."
            : "Créez un compte directeur (login par email OU téléphone)."
        }
        icon={Building2}
        loading={createMut.isPending || updateMut.isPending}
      >
        <form onSubmit={onSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="director-name">Nom complet</Label>
            <Input
              id="director-name"
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="Ex : Kouame Jean"
              required
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="director-email">Email</Label>
              <Input
                id="director-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="email@sygren.ci"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="director-phone">Téléphone</Label>
              <Input
                id="director-phone"
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
            <Label htmlFor="director-password">
              {editing ? "Nouveau mot de passe (optionnel)" : "Mot de passe"}
            </Label>
            <Input
              id="director-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={editing ? "Laisser vide pour ne pas changer" : "••••••••"}
              required={!editing}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="director-school">École dirigée</Label>
            <Select
              value={form.school_id}
              onValueChange={(v) => setForm({ ...form, school_id: v })}
            >
              <SelectTrigger id="director-school">
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
            <p className="text-[11px] text-muted-foreground">
              Un seul directeur actif par école.
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
              {editing ? "Enregistrer" : "Créer le directeur"}
            </Button>
          </div>
        </form>
      </EntityDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer le directeur ?"
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
        <p className="text-sm">Chargement des directeurs…</p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-10 text-center">
        <p className="text-sm text-destructive font-medium">
          Impossible de charger les directeurs
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
        <Building2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium">Aucun directeur enregistré</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          {onCreate
            ? "Créez des comptes directeurs pour qu'ils puissent gérer leur école."
            : "Les directeurs apparaîtront ici."}
        </p>
        {onCreate && (
          <Button onClick={onCreate} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Créer un directeur
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
