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
  Search,
  School as SchoolIcon,
  MapPin,
  Printer,
  IdCard,
} from "lucide-react";

import { teachersApi, schoolsApi, iepApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type {
  TeacherWithDetails,
  SchoolWithStats,
  PersonnelDossier,
} from "@/lib/types";
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
import {
  PersonnelDossierFields,
  personnelOf,
} from "@/components/personnel-dossier-fields";

interface FormData {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  school_id: string;
  personnel: PersonnelDossier;
}

const EMPTY: FormData = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
  school_id: "",
  personnel: {},
};

export function TeachersView() {
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === "admin" || user?.role === "director";
  // Cascade : IEP (admin) → École → recherche
  // - admin : filtre IEP optionnel → filtre École (cascade) → recherche
  // - inspector : IEP figé (RBAC backend) → filtre École → recherche
  // - director : école figée (RBAC backend) → recherche seule
  const isAdmin = user?.role === "admin";

  // === Filtres en cascade ===
  const [iepFilter, setIepFilter] = useState<string>("all");
  const [schoolFilter, setSchoolFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => teachersApi.list(),
  });
  const { data: schoolsData } = useQuery({
    queryKey: ["schools"],
    queryFn: schoolsApi.list,
    enabled: canEdit,
  });
  // IEPs (admin seulement — inspector a son IEP figé par le backend RBAC)
  const { data: iepsData } = useQuery({
    queryKey: ["iep"],
    queryFn: iepApi.list,
    enabled: isAdmin,
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
        personnel: data.personnel, // dossier toujours envoyé (mise à jour complète)
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
      personnel: personnelOf(t),
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
        // Task 25 — mot de passe optionnel : s'il est vide, le backend
        // applique le mot de passe STANDARD = numéro de téléphone.
        await createMut.mutateAsync([
          {
            full_name: form.full_name,
            email: form.email || undefined,
            phone: form.phone || undefined,
            password: form.password || undefined,
            school_id: form.school_id || undefined,
            personnel: form.personnel,
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
  const ieps = iepsData?.ieps ?? [];

  // Cascade : écoles filtrées par IEP sélectionné
  const filteredSchools =
    iepFilter !== "all"
      ? schools.filter((s) => s.iep_id === iepFilter)
      : schools;

  // Filtrage côté client : IEP (via école) → École → recherche texte.
  // Le backend filtre déjà par rôle (admin voit tout, inspector voit son IEP,
  // director voit son école).
  const filtered = teachers.filter((t) => {
    if (schoolFilter !== "all" && t.school_id !== schoolFilter) return false;
    if (iepFilter !== "all") {
      const school = schools.find((s) => s.id === t.school_id);
      if (!school || school.iep_id !== iepFilter) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      if (
        !t.full_name.toLowerCase().includes(q) &&
        !(t.email ?? "").toLowerCase().includes(q) &&
        !(t.phone ?? "").toLowerCase().includes(q)
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
                <Users className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Enseignants</h2>
                <p className="text-xs text-muted-foreground">
                  {filtered.length} enseignant(s) affiché(s)
                  {iepFilter !== "all" && ieps.find((i) => i.id === iepFilter)
                    ? ` · ${ieps.find((i) => i.id === iepFilter)?.name}`
                    : ""}
                  {" · comptes + affectation"}
                </p>
              </div>
            </div>
            {canEdit && (
              <div className="flex items-center gap-2">
                {(() => {
                  // Cible de l'état nominatif : le directeur imprime son école,
                  // admin/inspecteur l'école sélectionnée dans le filtre.
                  const target =
                    user?.role === "director"
                      ? user?.school_id ?? ""
                      : schoolFilter !== "all"
                        ? schoolFilter
                        : "";
                  return (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!target}
                      title={
                        target
                          ? "Imprimer l'état nominatif du personnel"
                          : "Sélectionnez d'abord une école dans le filtre"
                      }
                      onClick={() =>
                        window.open(`/personnel-doc?school=${target}`, "_blank")
                      }
                    >
                      <Printer className="w-4 h-4 mr-1.5" />
                      État nominatif
                    </Button>
                  );
                })()}
                <Button onClick={openCreate} size="sm" className="shadow-sm">
                  <Plus className="w-4 h-4 mr-1.5" />
                  Créer un enseignant
                </Button>
              </div>
            )}
          </div>
          {/* === Filtres en cascade : IEP → École → recherche ===
              - admin : IEP (tous) → École (cascade selon IEP) → recherche
              - inspector/director : IEP figé par le backend → École + recherche */}
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
                    setSchoolFilter("all");
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

            {/* Recherche texte */}
            <div className="relative flex-1 min-w-[200px] min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
                <Search className="w-3 h-3" /> Rechercher
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Par nom, email ou téléphone…"
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {teachers.length === 0 ? (
        <EmptyState onCreate={canEdit ? openCreate : undefined} />
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
            <p className="text-sm font-medium">
              Aucun enseignant ne correspond à votre recherche
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Modifiez les filtres pour élargir la recherche.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t, i) => (
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
                      {t.matricule && (
                        <p className="flex items-center gap-1.5 font-mono">
                          <IdCard className="w-3 h-3" /> {t.matricule}
                        </p>
                      )}
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
                {(t.fonction || t.categorie || t.echelon != null) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.fonction && (
                      <Badge variant="outline" className="text-[10px]">
                        {t.fonction === "ADJOINT(E)" ? "Adjoint(e)" : t.fonction}
                      </Badge>
                    )}
                    {t.categorie && (
                      <Badge variant="outline" className="text-[10px]">
                        {t.categorie}
                      </Badge>
                    )}
                    {t.echelon != null && (
                      <Badge variant="outline" className="text-[10px]">
                        Éch. {t.echelon}
                      </Badge>
                    )}
                  </div>
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
              ? "Modifiez les informations du compte enseignant et son dossier personnel."
              : "Créez un compte enseignant (login par email OU téléphone)."
          }
          icon={Users}
          loading={createMut.isPending || updateMut.isPending}
          maxWidth="sm:max-w-2xl"
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
                {editing ? "Nouveau mot de passe (optionnel)" : "Mot de passe (optionnel)"}
              </Label>
              <Input
                id="teacher-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={editing ? "Laisser vide pour ne pas changer" : "Laisser vide → téléphone"}
              />
              {!editing && (
                <p className="text-[11px] text-muted-foreground">
                  Mot de passe standard = numéro de téléphone. L&apos;enseignant
                  pourra le modifier à tout moment via «&nbsp;Modifier votre
                  mot de passe&nbsp;».
                </p>
              )}
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
            <PersonnelDossierFields
              value={form.personnel}
              onChange={(p) => setForm({ ...form, personnel: p })}
            />
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
                disabled={!editing && (!form.full_name || (!form.email && !form.phone))}
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
