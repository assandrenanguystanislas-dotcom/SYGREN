"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  School as SchoolIcon,
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Users,
  BookOpen,
  ImagePlus,
  Loader2,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { schoolsApi, iepApi, classesApi, teachersApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type {
  SchoolWithStats,
  IEPWithStats,
  ClassWithDetails,
  TeacherWithDetails,
  SchoolStatus,
} from "@/lib/types";
import { SCHOOL_STATUS_LABELS } from "@/lib/types";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { EntityDialog } from "@/components/entity-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface FormData {
  iep_id: string;
  code: string;
  name: string;
  address: string;
  status: SchoolStatus;
}

const EMPTY: FormData = {
  iep_id: "",
  code: "",
  name: "",
  address: "",
  status: "public",
};

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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SchoolStatus>("all");
  const [expandedSchoolId, setExpandedSchoolId] = useState<string | null>(null);
  const [logoOpen, setLogoOpen] = useState(false);
  const [logoTarget, setLogoTarget] = useState<SchoolWithStats | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

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
  const uploadLogoMut = useCrudMutation(schoolsApi.uploadLogo, {
    invalidateKeys: [["schools"]],
    successMessage: "Logo enregistré",
    actionLabel: "Enregistrement du logo",
  });
  const removeLogoMut = useCrudMutation(schoolsApi.removeLogo, {
    invalidateKeys: [["schools"]],
    successMessage: "Logo retiré",
    actionLabel: "Retrait du logo",
  });

  function openCreate() {
    setForm(EMPTY);
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(s: SchoolWithStats) {
    setForm({
      iep_id: s.iep_id,
      code: s.code ?? "",
      name: s.name,
      address: s.address,
      status: (s.status as SchoolStatus) ?? "public",
    });
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

  function openLogo(s: SchoolWithStats) {
    setLogoTarget(s);
    setLogoFile(null);
    setLogoPreview(null);
    setLogoOpen(true);
  }
  function closeLogo() {
    if (uploadLogoMut.isPending || removeLogoMut.isPending) return;
    setLogoOpen(false);
    setLogoFile(null);
    setLogoPreview(null);
  }
  // Pré-vérifications client (le backend re-valide toujours : taille via
  // MaxBytesReader, type via sniffing du contenu)
  function onLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      setLogoFile(null);
      setLogoPreview(null);
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      toast.error("Logo trop volumineux", { description: "2 Mo maximum" });
      e.target.value = "";
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      toast.error("Format non supporté", { description: "PNG, JPEG ou WebP attendu" });
      e.target.value = "";
      return;
    }
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  }
  async function onUploadLogo() {
    if (!logoTarget || !logoFile) return;
    try {
      await uploadLogoMut.mutateAsync([logoTarget.id, logoFile]);
      setLogoOpen(false);
      setLogoFile(null);
      setLogoPreview(null);
    } catch {
      /* toastée */
    }
  }
  async function onRemoveLogo() {
    if (!logoTarget) return;
    try {
      await removeLogoMut.mutateAsync([logoTarget.id]);
      setLogoOpen(false);
      setLogoFile(null);
      setLogoPreview(null);
    } catch {
      /* toastée */
    }
  }

  if (isLoading) return <LoadingState />;

  if (error) return <ErrorState message={(error as Error).message} />;

  const allSchools = data?.schools ?? [];
  const ieps = iepData?.ieps ?? [];

  // Filtrage local : recherche textuelle + filtre par statut
  const schools = allSchools.filter((s) => {
    const matchSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.code ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (s.address ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === "all" || s.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Compteurs par statut pour les badges du filtre
  const statusCounts = {
    all: allSchools.length,
    public: allSchools.filter((s) => s.status === "public").length,
    private: allSchools.filter((s) => s.status === "private").length,
    community: allSchools.filter((s) => s.status === "community").length,
  };

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          {/* Ligne 1 : titre + bouton Nouvelle école */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <SchoolIcon className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Écoles</h2>
                <p className="text-xs text-muted-foreground">
                  {schools.length} / {allSchools.length} établissement(s)
                  {statusFilter !== "all" && ` · filtré par ${SCHOOL_STATUS_LABELS[statusFilter]}`}
                </p>
              </div>
            </div>
            {canEdit && (
              <Button onClick={openCreate} size="sm" className="shadow-sm">
                <Plus className="w-4 h-4 mr-1.5" />
                Nouvelle école
              </Button>
            )}
          </div>

          {/* Ligne 2 : barre de recherche + filtres par statut */}
          {allSchools.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher par nom, code ou adresse…"
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-1">
                <FilterChip
                  label="Tous"
                  count={statusCounts.all}
                  active={statusFilter === "all"}
                  onClick={() => setStatusFilter("all")}
                />
                <FilterChip
                  label="Public"
                  count={statusCounts.public}
                  active={statusFilter === "public"}
                  onClick={() => setStatusFilter("public")}
                  color="blue"
                />
                <FilterChip
                  label="Privé"
                  count={statusCounts.private}
                  active={statusFilter === "private"}
                  onClick={() => setStatusFilter("private")}
                  color="amber"
                />
                <FilterChip
                  label="Communautaire"
                  count={statusCounts.community}
                  active={statusFilter === "community"}
                  onClick={() => setStatusFilter("community")}
                  color="emerald"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {allSchools.length === 0 ? (
        <EmptyState onCreate={canEdit ? openCreate : undefined} />
      ) : schools.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-muted-foreground">
            <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Aucune école ne correspond à votre recherche</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
              }}
            >
              Réinitialiser les filtres
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {schools.map((s, i) => (
            <Collapsible
              key={s.id}
              open={expandedSchoolId === s.id}
              onOpenChange={(open) => setExpandedSchoolId(open ? s.id : null)}
            >
              <Card
                className="border-border/60 hover:shadow-md transition-shadow animate-in-up"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {s.logo_url && (
                        <img
                          src={s.logo_url}
                          alt={`Logo ${s.name}`}
                          className="h-9 w-9 rounded-md object-contain border bg-white shrink-0"
                        />
                      )}
                      <p className="font-semibold truncate">{s.name}</p>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          s.status === "public"
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : s.status === "private"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {SCHOOL_STATUS_LABELS[(s.status as SchoolStatus) ?? "public"]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3" />
                      {s.address || "Adresse non renseignée"}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      {s.code && (
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          <span className="opacity-70 mr-1">Code:</span>
                          {s.code}
                        </Badge>
                      )}
                      {s.iep_name && (
                        <Badge variant="outline" className="text-[10px]">
                          {s.iep_name}
                        </Badge>
                      )}
                    </div>
                  </div>
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Logo de l'école"
                          onClick={() => openLogo(s)}
                        >
                          <ImagePlus className="w-3.5 h-3.5" />
                        </Button>
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

                  {/* Panneau dépliable : gestion des classes de cette école */}
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-3 justify-between text-xs h-8"
                    >
                      <span className="flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5" />
                        Classes (CP1 → CM2)
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 group-data-[state=open]:rotate-180 transition-transform" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 pt-3 border-t border-border/60">
                      <SchoolClassesPanel schoolId={s.id} canEdit={canEdit} />
                    </div>
                  </CollapsibleContent>
                </CardContent>
              </Card>
            </Collapsible>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="school-code">Code école</Label>
                <Input
                  id="school-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="Ex : IEP-ABJ-001"
                  required
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Code unique identifiant l&apos;école dans le système IEP.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="school-status">Statut</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm({ ...form, status: v as SchoolStatus })
                  }
                >
                  <SelectTrigger id="school-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="private">Privé</SelectItem>
                    <SelectItem value="community">Communautaire</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
              <Button
                type="submit"
                disabled={!form.iep_id || !form.code || !form.name}
              >
                {editing ? "Enregistrer" : "Créer l'école"}
              </Button>
            </div>
          </form>
        </EntityDialog>
      )}

      {canEdit && (
        <EntityDialog
          open={logoOpen}
          onOpenChange={(o) => (o ? setLogoOpen(true) : closeLogo())}
          title="Logo de l'école"
          description={logoTarget ? logoTarget.name : ""}
          icon={ImagePlus}
          loading={uploadLogoMut.isPending || removeLogoMut.isPending}
        >
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-center">
              {logoPreview || logoTarget?.logo_url ? (
                <img
                  src={logoPreview ?? logoTarget?.logo_url}
                  alt="Aperçu du logo"
                  className="h-24 w-24 rounded-lg object-contain border bg-white"
                />
              ) : (
                <div className="h-24 w-24 rounded-lg border border-dashed flex items-center justify-center text-xs text-muted-foreground">
                  Aucun logo
                </div>
              )}
            </div>
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploadLogoMut.isPending || removeLogoMut.isPending}
              onChange={onLogoFileChange}
            />
            <p className="text-xs text-muted-foreground">
              PNG, JPEG ou WebP — 2 Mo max. Le logo apparaît à côté du nom de
              l&apos;école.
            </p>
            <div className="flex items-center justify-between gap-2">
              {logoTarget?.logo_path ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onRemoveLogo}
                  disabled={uploadLogoMut.isPending || removeLogoMut.isPending}
                >
                  {removeLogoMut.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Retirer
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                onClick={onUploadLogo}
                disabled={
                  !logoFile || uploadLogoMut.isPending || removeLogoMut.isPending
                }
              >
                {uploadLogoMut.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Enregistrer
              </Button>
            </div>
          </div>
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

/**
 * SchoolClassesPanel — panneau de gestion des classes d'une école.
 *
 * Affiche les 6 classes standard (CP1, CP2, CE1, CE2, CM1, CM2) avec :
 *   - checkbox Active/Désactivée (toggle soft-delete)
 *   - select enseignant (affectation)
 *   - compteur d'élèves par classe
 *
 * Le directeur ne voit que son école (backend filtre par school_id du director).
 * L'admin voit toutes les écoles.
 */
function SchoolClassesPanel({
  schoolId,
  canEdit,
}: {
  schoolId: string;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();

  // Récupère TOUTES les classes (y compris inactives) de cette école
  const { data, isLoading } = useQuery({
    queryKey: ["classes", schoolId],
    queryFn: async () => classesApi.list({ includeInactive: true, schoolId }),
  });

  // Récupère la liste des enseignants pour l'affectation (limité au scope du directeur)
  const { data: teachersData } = useQuery({
    queryKey: ["teachers", "include-directors"],
    queryFn: () => teachersApi.list({ includeDirectors: true }),
    enabled: canEdit,
  });

  const classes = data?.classes ?? [];
  const allTeachers = teachersData?.teachers ?? [];
  // Règle métier : un enseignant/directeur ne peut être affecté qu'à une
  // classe de SON école. On filtre donc la liste côté frontend pour ne
  // montrer que les users rattachés à cette école (UX + cohérence avec la
  // validation backend qui refuse les affectations hors-école).
  const teachers = allTeachers.filter((t) => t.school_id === schoolId);

  // Trier par ordre standard : CP1, CP2, CE1, CE2, CM1, CM2
  const CLASS_ORDER = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"];
  const sortedClasses = [...classes].sort(
    (a, b) =>
      CLASS_ORDER.indexOf(a.name) - CLASS_ORDER.indexOf(b.name),
  );

  async function toggleActive(cls: ClassWithDetails, newActive: boolean) {
    try {
      await classesApi.update(cls.id, { active: newActive });
      toast.success(
        newActive ? "Classe activée" : "Classe désactivée",
        { description: `${cls.name} — ${cls.school_name ?? ""}` },
      );
      await queryClient.invalidateQueries({ queryKey: ["classes", schoolId] });
      await queryClient.invalidateQueries({ queryKey: ["schools"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur";
      toast.error("Échec du changement de statut", { description: msg });
    }
  }

  async function updateTeacher(cls: ClassWithDetails, teacherId: string) {
    try {
      const tid = teacherId === "__none__" ? null : teacherId;
      await classesApi.update(cls.id, { teacher_id: tid });
      toast.success("Enseignant affecté", {
        description: `${cls.name} — ${cls.school_name ?? ""}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["classes", schoolId] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur";
      toast.error("Échec de l'affectation", { description: msg });
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Chargement des classes…
      </div>
    );
  }

  if (classes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic py-4">
        Aucune classe. Les classes sont normalement auto-créées à la création de
        l&apos;école.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1">
        <span>Active</span>
        <span>Classe · Enseignant</span>
        <span className="text-right">Élèves</span>
      </div>
      {sortedClasses.map((cls) => (
        <div
          key={cls.id}
          className={`grid grid-cols-[auto_1fr_auto] gap-3 items-center px-3 py-2 rounded-md border ${
            cls.active
              ? "border-border/60 bg-card"
              : "border-dashed border-border/40 bg-muted/30 opacity-75"
          }`}
        >
          {/* Checkbox Active */}
          {canEdit ? (
            <Checkbox
              checked={cls.active}
              onCheckedChange={(v) => toggleActive(cls, v === true)}
              aria-label={`Classe ${cls.name} ${cls.active ? "active" : "inactive"}`}
            />
          ) : (
            <span className="text-muted-foreground">
              {cls.active ? (
                <Check className="w-4 h-4 text-emerald-600" />
              ) : (
                <X className="w-4 h-4" />
              )}
            </span>
          )}

          {/* Classe + Enseignant */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{cls.name}</span>
              <Badge variant="outline" className="text-[9px] uppercase">
                {cls.level}
              </Badge>
              {!cls.active && (
                <Badge
                  variant="outline"
                  className="text-[9px] border-amber-300 bg-amber-50 text-amber-700"
                >
                  Désactivée
                </Badge>
              )}
            </div>
            {canEdit ? (
              <Select
                value={cls.teacher_id ?? "__none__"}
                onValueChange={(v) => updateTeacher(cls, v)}
              >
                <SelectTrigger className="h-7 mt-1 text-xs">
                  <SelectValue placeholder="Aucun enseignant" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Aucun —</SelectItem>
                  {teachers.map((t: TeacherWithDetails) => (
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
                        {t.school_name && (
                          <span className="text-[11px] text-muted-foreground">
                            · {t.school_name}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {cls.teacher_name ?? "— Aucun enseignant —"}
              </p>
            )}
          </div>

          {/* Compteur élèves */}
          <div className="text-right">
            <span className="text-sm font-semibold">{cls.student_count}</span>
            <p className="text-[10px] text-muted-foreground">élève(s)</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * FilterChip — bouton de filtre avec compteur.
 * Utilisé pour filtrer les écoles par statut (Tous/Public/Privé/Communautaire).
 */
function FilterChip({
  label,
  count,
  active,
  onClick,
  color,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: "blue" | "amber" | "emerald";
}) {
  const colorClasses = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  const activeClass = color
    ? colorClasses[color]
    : "border-primary bg-primary text-primary-foreground";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-xs font-medium transition-colors ${
        active
          ? activeClass
          : "border-border bg-card text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
      <span
        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
          active ? "bg-black/10" : "bg-muted"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
