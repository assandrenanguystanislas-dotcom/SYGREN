"use client";

import { useState, useMemo, useEffect } from "react";
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
  Landmark,
  Network,
  UsersRound,
  ListChecks,
  Eye,
} from "lucide-react";
import { toast } from "sonner";

import {
  schoolsApi,
  iepApi,
  classesApi,
  teachersApi,
  examCentersApi,
  sectorsApi,
  conseillersApi,
} from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type {
  SchoolWithStats,
  IEPWithStats,
  ClassWithDetails,
  TeacherWithDetails,
  SchoolStatus,
  ExamCenterWithStats,
  SectorWithStats,
  ConseillerWithSector,
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
import { SectorViewDialog } from "@/components/secteur/sector-view-dialog";
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
  exam_center_id: string; // "" = aucun centre (sentinel UI __none__)
  sector_id: string; // "" = hors secteur (sentinel UI __none__)
}

const EMPTY: FormData = {
  iep_id: "",
  code: "",
  name: "",
  address: "",
  status: "public",
  exam_center_id: "",
  sector_id: "",
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
  // Centres d'examen (documents officiels du plan IEPP) — le backend
  // renvoie déjà le périmètre du user (admin : tous, directeur : le sien).
  const { data: centersData } = useQuery({
    queryKey: ["exam-centers"],
    queryFn: examCentersApi.list,
  });
  // v5 (session 29) — secteurs d'écoles : liste pour le champ Secteur du
  // formulaire école et le formulaire « Affectation des écoles ».
  const { data: sectorsData } = useQuery({
    queryKey: ["sectors"],
    queryFn: sectorsApi.list,
    enabled: canEdit,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolWithStats | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<SchoolWithStats | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SchoolStatus>("all");
  const [centerFilter, setCenterFilter] = useState<string>("all");
  const [expandedSchoolId, setExpandedSchoolId] = useState<string | null>(null);
  const [centersOpen, setCentersOpen] = useState(false);
  // v5 (session 26) — plage « SECTEURS D'ECOLES » du module Écoles
  const [sectorsOpen, setSectorsOpen] = useState(false);
  // v5 (session 29) — formulaire « Affectation des écoles aux secteurs »
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);
  const [logoTarget, setLogoTarget] = useState<SchoolWithStats | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const createMut = useCrudMutation(schoolsApi.create, {
    invalidateKeys: [["schools"], ["iep"], ["exam-centers"]],
    successMessage: "École créée avec succès",
    actionLabel: "Création",
  });
  const updateMut = useCrudMutation(
    (id: string, data: FormData) => schoolsApi.update(id, data),
    {
      // exam-centers aussi : le compteur school_count d'un centre change
      // quand une école est (re)rattachée ou détachée.
      invalidateKeys: [["schools"], ["exam-centers"]],
      successMessage: "École modifiée avec succès",
      actionLabel: "Modification",
    },
  );
  const deleteMut = useCrudMutation(schoolsApi.delete, {
    invalidateKeys: [["schools"], ["iep"], ["exam-centers"]],
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
      exam_center_id: s.exam_center_id ?? "",
      sector_id: s.sector_id ?? "",
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
  const examCenters: ExamCenterWithStats[] = centersData?.exam_centers ?? [];
  const sectors = sectorsData?.sectors ?? [];

  // Filtrage local : recherche textuelle + filtres statut et centre d'examen
  const schools = allSchools.filter((s) => {
    const matchSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.code ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (s.address ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === "all" || s.status === statusFilter;
    const matchCenter =
      centerFilter === "all" || s.exam_center_id === centerFilter;
    return matchSearch && matchStatus && matchCenter;
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
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCentersOpen(true)}
                  title="Gérer les centres d'examen (regroupement des écoles dans les documents officiels du plan IEPP)"
                >
                  <Landmark className="w-4 h-4 mr-1.5" />
                  Centres d&apos;examens
                </Button>
                {/* v5 (session 26) — secteurs d'écoles : regroupement des
                    écoles par secteur de conseiller pédagogique. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSectorsOpen(true)}
                  title="Gérer les secteurs d'écoles (écoles et conseillers affectés à chaque secteur)"
                >
                  <Network className="w-4 h-4 mr-1.5" />
                  Secteurs d&apos;écoles
                </Button>
                {/* v5 (session 29) — formulaire « Affectation des écoles » :
                    le sens école → secteur, une ligne par école. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAssignmentOpen(true)}
                  title="Affecter chaque école à son secteur (une ligne par école)"
                >
                  <ListChecks className="w-4 h-4 mr-1.5" />
                  Affectation des écoles
                </Button>
                <Button onClick={openCreate} size="sm" className="shadow-sm">
                  <Plus className="w-4 h-4 mr-1.5" />
                  Nouvelle école
                </Button>
              </div>
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
              {/* Filtre par centre d'examen (documents du plan IEPP) */}
              {examCenters.length > 0 && (
                <Select
                  value={centerFilter}
                  onValueChange={setCenterFilter}
                >
                  <SelectTrigger className="w-[190px] h-8 text-xs">
                    <SelectValue placeholder="Centre d'examen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les centres</SelectItem>
                    {examCenters.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.school_count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
                      {s.exam_center_name && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-violet-200 bg-violet-50 text-violet-700"
                        >
                          <Landmark className="w-3 h-3 mr-1" />
                          {s.exam_center_name}
                        </Badge>
                      )}
                      {/* v5 (session 29) — secteur d'écoles de l'école
                          (nom résolu côté serveur : sector_name). */}
                      {s.sector_name && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-teal-200 bg-teal-50 text-teal-700"
                        >
                          <Network className="w-3 h-3 mr-1" />
                          Secteur {s.sector_name}
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
                  placeholder="Ex : E001103"
                  required
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Code unique : la lettre E suivie de chiffres (ex :
                  E001103).
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
            {/* Centre d'examen — regroupement des écoles dans les documents
                officiels du plan IEPP (PLAN D'ACTION PLURIANNUEL). Options
                limitées aux centres de l'IEP choisie ci-dessus. */}
            <div className="space-y-1.5">
              <Label htmlFor="school-exam-center">
                Centre d&apos;examen de rattachement
              </Label>
              <Select
                value={form.exam_center_id || "__none__"}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    exam_center_id: v === "__none__" ? "" : v,
                  })
                }
                disabled={!form.iep_id}
              >
                <SelectTrigger id="school-exam-center">
                  <SelectValue
                    placeholder={
                      form.iep_id
                        ? "Choisir un centre d'examen…"
                        : "Choisir une IEP d'abord"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Aucun centre —</SelectItem>
                  {examCenters
                    .filter((c) => c.iep_id === form.iep_id)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Regroupe les écoles par lieu d&apos;examen dans le
                « Plan d&apos;action pluriannuel de l&apos;IEPP » (module
                Résultats).
              </p>
            </div>
            {/* Secteur d'écoles — affectation de l'école à un secteur de
                conseiller pédagogique (vue « Mon Secteur », v5 session 29).
                Options limitées aux secteurs de l'IEP choisie ci-dessus. */}
            <div className="space-y-1.5">
              <Label htmlFor="school-sector">Secteur d&apos;écoles</Label>
              <Select
                value={form.sector_id || "__none__"}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    sector_id: v === "__none__" ? "" : v,
                  })
                }
                disabled={!form.iep_id}
              >
                <SelectTrigger id="school-sector">
                  <SelectValue
                    placeholder={
                      form.iep_id
                        ? "Choisir un secteur… (ou aucun)"
                        : "Choisir une IEP d'abord"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Aucun secteur —</SelectItem>
                  {sectors
                    .filter((sec) => sec.iep_id === form.iep_id)
                    .map((sec) => (
                      <SelectItem key={sec.id} value={sec.id}>
                        {sec.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Regroupe les écoles suivies par un conseiller pédagogique
                (vue « Mon Secteur »).
              </p>
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

      {canEdit && (
        <ExamCentersDialog
          open={centersOpen}
          onOpenChange={setCentersOpen}
          ieps={ieps}
        />
      )}

      {/* v5 (session 26) — plage « SECTEURS D'ECOLES » : création des
          secteurs, affectation des écoles et des conseillers. */}
      {canEdit && (
        <SectorsDialog
          open={sectorsOpen}
          onOpenChange={setSectorsOpen}
          ieps={ieps}
          schools={allSchools}
        />
      )}

      {/* v5 (session 29) — formulaire « Affectation des écoles » : chaque
          école présente une ligne avec le sélecteur de son secteur. */}
      {canEdit && (
        <SectorAssignmentDialog
          open={assignmentOpen}
          onOpenChange={setAssignmentOpen}
          schools={allSchools}
          sectors={sectors}
        />
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
      toast.success("Adjoint(e) au directeur affecté(e)", {
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
        <span>Classe · Adjoint(e) au directeur</span>
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
                  <SelectValue placeholder="Aucun adjoint au directeur" />
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
 * ExamCentersDialog — gestion des centres d'examen (admin).
 *
 * Les centres regroupent les écoles dans les documents officiels du plan
 * IEPP (« PLAN D'ACTION PLURIANNUEL DE L'IEPP », colonne CENTRES D'EXAMENS).
 * Liste + création + renommage + ordre (position) + suppression (refusée
 * par le backend tant que des écoles sont rattachées).
 */
function ExamCentersDialog({
  open,
  onOpenChange,
  ieps,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ieps: IEPWithStats[];
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["exam-centers"],
    queryFn: examCentersApi.list,
    enabled: open,
  });
  const centers = data?.exam_centers ?? [];

  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [iepId, setIepId] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<ExamCenterWithStats | null>(null);

  const createMut = useCrudMutation(examCentersApi.create, {
    invalidateKeys: [["exam-centers"], ["schools"]],
    successMessage: "Centre d'examen créé",
    actionLabel: "Création du centre",
  });
  const updateMut = useCrudMutation(
    (id: string, payload: { name?: string; position?: number }) =>
      examCentersApi.update(id, payload),
    {
      invalidateKeys: [["exam-centers"], ["schools"]],
      successMessage: "Centre d'examen modifié",
      actionLabel: "Modification du centre",
    },
  );
  const deleteMut = useCrudMutation(examCentersApi.remove, {
    invalidateKeys: [["exam-centers"], ["schools"]],
    successMessage: "Centre d'examen supprimé",
    actionLabel: "Suppression du centre",
  });

  function resetCreate() {
    setName("");
    setPosition("");
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const targetIep = iepId || ieps[0]?.id || "";
    if (!targetIep) {
      toast.error("Aucune IEP", {
        description: "Créez une IEP avant d'ajouter un centre d'examen.",
      });
      return;
    }
    try {
      await createMut.mutateAsync([
        {
          iep_id: targetIep,
          name: name.trim(),
          position: position ? Number(position) : undefined,
        },
      ]);
      resetCreate();
    } catch {
      /* toastée par useCrudMutation */
    }
  }

  async function onSaveEdit(c: ExamCenterWithStats) {
    try {
      await updateMut.mutateAsync([c.id, { name: editName.trim() }]);
      setEditId(null);
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

  function bumpPosition(c: ExamCenterWithStats, delta: number) {
    updateMut.mutate([c.id, { position: Math.max(0, c.position + delta) }]);
  }

  return (
    <>
      <EntityDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Centres d'examen"
        description="Lieux de regroupement des écoles dans les documents officiels du plan IEPP. Rattachez ensuite chaque école à un centre via son formulaire."
        icon={Landmark}
        loading={createMut.isPending || updateMut.isPending}
      >
        <div className="space-y-4 pt-2">
          {/* Création */}
          <form onSubmit={onCreate} className="space-y-2">
            {ieps.length > 1 && (
              <Select value={iepId || ieps[0]?.id} onValueChange={setIepId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="IEP" />
                </SelectTrigger>
                <SelectContent>
                  {ieps.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nom du centre (ex : DABOU AGNIMEL)"
                required
                className="flex-1"
              />
              <Input
                value={position}
                onChange={(e) =>
                  setPosition(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="Ordre"
                inputMode="numeric"
                className="w-24 shrink-0"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!name.trim() || createMut.isPending}
                className="shrink-0"
              >
                {createMut.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-1" />
                )}
                Ajouter
              </Button>
            </div>
          </form>

          {/* Liste des centres */}
          <div className="max-h-72 overflow-y-auto rounded-md border border-border/60 divide-y divide-border/60">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Chargement…
              </div>
            ) : centers.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                Aucun centre d&apos;examen — créez le premier ci-dessus.
              </p>
            ) : (
              centers.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 px-3 py-2.5"
                >
                  {editId === c.id ? (
                    <>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8 flex-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") onSaveEdit(c);
                          if (e.key === "Escape") setEditId(null);
                        }}
                      />
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={!editName.trim() || updateMut.isPending}
                        onClick={() => onSaveEdit(c)}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => setEditId(null)}
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-primary"
                          title="Monter dans l'ordre des documents"
                          onClick={() => bumpPosition(c, -1)}
                          disabled={updateMut.isPending}
                        >
                          <ChevronDown className="w-3.5 h-3.5 rotate-180" />
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-primary"
                          title="Descendre dans l'ordre des documents"
                          onClick={() => bumpPosition(c, +1)}
                          disabled={updateMut.isPending}
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground w-6 text-center shrink-0">
                        {c.position}
                      </span>
                      <span className="font-medium text-sm truncate flex-1">
                        {c.name}
                      </span>
                      <Badge
                        variant="secondary"
                        className="text-[10px] shrink-0"
                      >
                        {c.school_count} école(s)
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title="Renommer"
                        onClick={() => {
                          setEditId(c.id);
                          setEditName(c.name);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                        title="Supprimer (si aucune école rattachée)"
                        onClick={() => setDeleteTarget(c)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            L&apos;ordre (position) détermine l&apos;ordre des groupes dans le
            « Plan d&apos;action pluriannuel de l&apos;IEPP » imprimé.
          </p>
        </div>
      </EntityDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer le centre d'examen ?"
        description={
          deleteTarget
            ? `Supprimer « ${deleteTarget.name} » ? Le backend refuse si des écoles y sont encore rattachées.`
            : ""
        }
        confirmLabel="Supprimer"
        destructive
        icon={Trash2}
        onConfirm={onDelete}
        loading={deleteMut.isPending}
      />
    </>
  );
}

/**
 * SectorsDialog — gestion des SECTEURS D'ECOLES (v5, session 26).
 *
 * Chaque secteur regroupe des écoles (schools.sector_id) et reçoit des
 * CONSEILLERS affectés (users.sector_id) : « les directeurs et les adjoints
 * au directeurs dont les écoles sont dans les secteurs d'écoles concernés
 * seront sous l'autorité de ces conseillers ». Un secteur non vidé ne peut
 * pas être supprimé (refus backend 409).
 */
function SectorsDialog({
  open,
  onOpenChange,
  ieps,
  schools,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ieps: IEPWithStats[];
  schools: SchoolWithStats[];
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["sectors"],
    queryFn: sectorsApi.list,
    enabled: open,
  });
  // Comptes conseillers disponibles pour l'affectation (actifs uniquement
  // acceptés par le backend — on n'affiche qu'eux).
  const { data: consData } = useQuery({
    queryKey: ["conseillers"],
    queryFn: () => conseillersApi.list(),
    enabled: open,
  });
  const sectors = data?.sectors ?? [];
  const conseillers = useMemo(
    () => (consData?.conseillers ?? []).filter((c) => c.active),
    [consData],
  );

  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [iepId, setIepId] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SectorWithStats | null>(
    null,
  );
  // Secteur déplié + sélections courantes (écoles / conseillers)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [schoolSel, setSchoolSel] = useState<Set<string>>(new Set());
  const [conseillerSel, setConseillerSel] = useState<Set<string>>(new Set());
  const [schoolSearch, setSchoolSearch] = useState("");
  // v33 — « reproduire la même chose » : consultation du secteur dans la
  // vue Mon Secteur exacte du conseiller (SectorViewDialog partagé).
  const [viewSector, setViewSector] = useState<SectorWithStats | null>(null);

  const createMut = useCrudMutation(sectorsApi.create, {
    invalidateKeys: [["sectors"], ["schools"]],
    successMessage: "Secteur créé",
    actionLabel: "Création du secteur",
  });
  const updateMut = useCrudMutation(
    (id: string, payload: { name?: string; position?: number }) =>
      sectorsApi.update(id, payload),
    {
      invalidateKeys: [["sectors"], ["schools"]],
      successMessage: "Secteur modifié",
      actionLabel: "Modification du secteur",
    },
  );
  const deleteMut = useCrudMutation(sectorsApi.remove, {
    invalidateKeys: [["sectors"], ["schools"]],
    successMessage: "Secteur supprimé",
    actionLabel: "Suppression du secteur",
  });
  const setSchoolsMut = useCrudMutation(
    (id: string, ids: string[]) => sectorsApi.setSchools(id, ids),
    {
      invalidateKeys: [["sectors"], ["schools"]],
      successMessage: "Écoles du secteur enregistrées",
      actionLabel: "Affectation des écoles",
    },
  );
  const setConseillersMut = useCrudMutation(
    (id: string, ids: string[]) => sectorsApi.setConseillers(id, ids),
    {
      invalidateKeys: [["sectors"], ["conseillers"]],
      successMessage: "Conseillers du secteur enregistrés",
      actionLabel: "Affectation des conseillers",
    },
  );

  /** Déplier un secteur : pré-sélectionne ses écoles et ses conseillers. */
  function toggleExpand(s: SectorWithStats) {
    if (expandedId === s.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(s.id);
    setSchoolSel(
      new Set(schools.filter((x) => x.sector_id === s.id).map((x) => x.id)),
    );
    setConseillerSel(
      new Set(
        conseillers.filter((c) => c.sector_id === s.id).map((c) => c.id),
      ),
    );
    setSchoolSearch("");
  }

  function toggleSel(
    set: Set<string>,
    setter: (s: Set<string>) => void,
    id: string,
  ) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const targetIep = iepId || ieps[0]?.id || "";
    if (!targetIep) {
      toast.error("Aucune IEP", {
        description: "Créez une IEP avant d'ajouter un secteur d'écoles.",
      });
      return;
    }
    try {
      await createMut.mutateAsync([
        {
          iep_id: targetIep,
          name: name.trim(),
          position: position ? Number(position) : undefined,
        },
      ]);
      setName("");
      setPosition("");
    } catch {
      /* toastée par useCrudMutation */
    }
  }

  async function onSaveEdit(s: SectorWithStats) {
    try {
      await updateMut.mutateAsync([s.id, { name: editName.trim() }]);
      setEditId(null);
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

  const expanded = sectors.find((s) => s.id === expandedId) ?? null;
  // Écoles de l'IEP du secteur déplié (l'affectation inter-IEP est refusée
  // par le backend — on ne propose que les écoles autorisées).
  const expandableSchools = expanded
    ? schools
        .filter((x) => x.iep_id === expanded.iep_id)
        .filter(
          (x) =>
            !schoolSearch ||
            x.name.toLowerCase().includes(schoolSearch.toLowerCase()) ||
            (x.code ?? "").toLowerCase().includes(schoolSearch.toLowerCase()),
        )
    : [];

  return (
    <>
      <EntityDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Secteurs d'écoles"
        description="Regroupement des écoles par secteur : affectez des écoles et des conseillers — chaque conseiller suivra uniquement les directeurs et adjoints des écoles de son secteur."
        icon={Network}
        loading={createMut.isPending || updateMut.isPending}
      >
        <div className="space-y-4 pt-2">
          {/* Création */}
          <form onSubmit={onCreate} className="space-y-2">
            {ieps.length > 1 && (
              <Select value={iepId || ieps[0]?.id} onValueChange={setIepId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="IEP" />
                </SelectTrigger>
                <SelectContent>
                  {ieps.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nom du secteur (ex : COSROU)"
                required
                className="flex-1"
              />
              <Input
                value={position}
                onChange={(e) =>
                  setPosition(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="Ordre"
                inputMode="numeric"
                className="w-24 shrink-0"
              />
              <Button
                type="submit"
                size="sm"
                disabled={!name.trim() || createMut.isPending}
                className="shrink-0"
              >
                {createMut.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-1" />
                )}
                Ajouter
              </Button>
            </div>
          </form>

          {/* Liste des secteurs */}
          <div className="max-h-[52vh] overflow-y-auto rounded-md border border-border/60 divide-y divide-border/60">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Chargement…
              </div>
            ) : sectors.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                Aucun secteur d&apos;écoles — créez le premier ci-dessus
                (ex&nbsp;: COSROU, VIEUX-BADIEN, TOUPAH, OUSROU, LEBOUTOU,
                BOUBOURY).
              </p>
            ) : (
              sectors.map((s) => (
                <div key={s.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {editId === s.id ? (
                      <>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8 flex-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onSaveEdit(s);
                            if (e.key === "Escape") setEditId(null);
                          }}
                        />
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={!editName.trim() || updateMut.isPending}
                          onClick={() => onSaveEdit(s)}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8"
                          onClick={() => setEditId(null)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                          onClick={() => toggleExpand(s)}
                          aria-expanded={expandedId === s.id}
                        >
                          <ChevronDown
                            className={`w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform ${
                              expandedId === s.id ? "" : "-rotate-90"
                            }`}
                          />
                          <span className="font-mono text-[10px] text-muted-foreground w-6 text-center shrink-0">
                            {s.position}
                          </span>
                          <span className="font-medium text-sm truncate">
                            {s.name}
                          </span>
                        </button>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {s.school_count} école(s)
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-[10px] shrink-0 gap-1"
                        >
                          <UsersRound className="w-3 h-3" />
                          {(s.conseillers ?? []).length}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          title="Voir le secteur — vue Mon Secteur du conseiller"
                          onClick={() => setViewSector(s)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          title="Renommer"
                          onClick={() => {
                            setEditId(s.id);
                            setEditName(s.name);
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                          title="Supprimer (si aucune école ni conseiller rattaché)"
                          onClick={() => setDeleteTarget(s)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Panneau déplié : écoles + conseillers du secteur */}
                  {expandedId === s.id && (
                    <div className="mt-3 space-y-4 border-t border-border/60 pt-3">
                      {/* Écoles */}
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                            <SchoolIcon className="w-3.5 h-3.5" />
                            Écoles du secteur
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={setSchoolsMut.isPending}
                            onClick={() =>
                              setSchoolsMut.mutateAsync([s.id, [...schoolSel]])
                            }
                          >
                            {setSchoolsMut.isPending && (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            )}
                            Enregistrer ({schoolSel.size})
                          </Button>
                        </div>
                        <Input
                          value={schoolSearch}
                          onChange={(e) => setSchoolSearch(e.target.value)}
                          placeholder="Rechercher une école…"
                          className="h-8 text-xs mb-2"
                        />
                        <div className="max-h-48 overflow-y-auto rounded-md border border-border/40 p-2 space-y-1">
                          {expandableSchools.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic py-3 text-center">
                              Aucune école de cette IEP.
                            </p>
                          ) : (
                            expandableSchools.map((x) => (
                              <label
                                key={x.id}
                                className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/60 cursor-pointer"
                              >
                                <Checkbox
                                  checked={schoolSel.has(x.id)}
                                  onCheckedChange={() =>
                                    toggleSel(schoolSel, setSchoolSel, x.id)
                                  }
                                  aria-label={`École ${x.name}`}
                                />
                                <span className="text-xs truncate flex-1">
                                  {x.name}
                                </span>
                                {x.code && (
                                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                                    {x.code}
                                  </span>
                                )}
                                {x.sector_id && x.sector_id !== s.id && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] shrink-0 border-amber-300 text-amber-700 bg-amber-50"
                                  >
                                    autre secteur
                                  </Badge>
                                )}
                              </label>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Conseillers */}
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                            <UsersRound className="w-3.5 h-3.5" />
                            Conseillers affectés
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={setConseillersMut.isPending}
                            onClick={() =>
                              setConseillersMut.mutateAsync([
                                s.id,
                                [...conseillerSel],
                              ])
                            }
                          >
                            {setConseillersMut.isPending && (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            )}
                            Enregistrer ({conseillerSel.size})
                          </Button>
                        </div>
                        {conseillers.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic py-3 text-center border border-dashed border-border/40 rounded-md">
                            Aucun compte conseiller — créez-en dans le module
                            Utilisateurs &gt; onglet Conseillers.
                          </p>
                        ) : (
                          <div className="max-h-36 overflow-y-auto rounded-md border border-border/40 p-2 space-y-1">
                            {conseillers.map((c) => (
                              <label
                                key={c.id}
                                className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/60 cursor-pointer"
                              >
                                <Checkbox
                                  checked={conseillerSel.has(c.id)}
                                  onCheckedChange={() =>
                                    toggleSel(
                                      conseillerSel,
                                      setConseillerSel,
                                      c.id,
                                    )
                                  }
                                  aria-label={`Conseiller ${c.full_name}`}
                                />
                                <span className="text-xs truncate flex-1">
                                  {c.full_name}
                                </span>
                                {c.sector_id && c.sector_id !== s.id && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] shrink-0 border-amber-300 text-amber-700 bg-amber-50"
                                  >
                                    autre secteur
                                  </Badge>
                                )}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Cochez les écoles et les conseillers de chaque secteur puis
            enregistrez. Chaque conseiller voit uniquement les directeurs et
            adjoints au directeur des écoles de SON secteur (vue « Mon
            Secteur »).
          </p>
        </div>
      </EntityDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer le secteur d'écoles ?"
        description={
          deleteTarget
            ? `Supprimer « ${deleteTarget.name} » ? Le backend refuse si des écoles ou des conseillers y sont encore rattachés.`
            : ""
        }
        confirmLabel="Supprimer"
        destructive
        icon={Trash2}
        onConfirm={onDelete}
        loading={deleteMut.isPending}
      />

      {/* v33 — « reproduire la même chose » : la vue Mon Secteur EXACTE du
          conseiller, ouverte depuis chaque secteur (bouton œil). */}
      <SectorViewDialog
        open={!!viewSector}
        onOpenChange={(o) => !o && setViewSector(null)}
        sectorId={viewSector?.id ?? ""}
        sectorName={viewSector?.name}
      />
    </>
  );
}

/**
 * SectorAssignmentDialog — formulaire « Affectation des écoles » (v5,
 * session 29).
 *
 * Sens ÉCOLE → SECTEUR, en complément du dialog « Secteurs d'écoles »
 * (sens secteur → écoles, cases à cocher) : chaque ligne présente une
 * école avec le sélecteur de son secteur d'écoles ; le changement est
 * enregistré immédiatement (PUT /api/schools/{id}, sector_id — le backend
 * refuse un secteur d'une autre IEP, même règle que l'affectation par
 * secteur). Filtres : recherche par nom/code et par secteur (dont
 * « hors secteur ») pour préparer par exemple le rattachement des écoles
 * de Dabou ville.
 */
function SectorAssignmentDialog({
  open,
  onOpenChange,
  schools,
  sectors,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  schools: SchoolWithStats[];
  sectors: SectorWithStats[];
}) {
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  // Choix optimistes par école : le sélecteur affiche la valeur locale en
  // attendant le rechargement de la liste (invalidation ["schools"]).
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const assignMut = useCrudMutation(
    (id: string, data: { sector_id?: string | null }) =>
      schoolsApi.update(id, data),
    {
      invalidateKeys: [["schools"], ["sectors"]],
      successMessage: "Affectation du secteur enregistrée",
      actionLabel: "Affectation du secteur",
    },
  );

  // Les schools rechargées reflètent les enregistrements réussis : on
  // retire les choix optimistes devenus redondants.
  useEffect(() => {
    setDrafts({});
  }, [schools]);

  async function assign(schoolId: string, value: string) {
    setDrafts((d) => ({ ...d, [schoolId]: value }));
    try {
      await assignMut.mutateAsync([
        schoolId,
        { sector_id: value === "__none__" ? "" : value },
      ]);
    } catch {
      // Échec (ex : secteur d'une autre IEP) — on réaffiche la valeur
      // réelle de l'école (le toast d'erreur est déjà émis par le hook).
      setDrafts((d) => {
        const next = { ...d };
        delete next[schoolId];
        return next;
      });
    }
  }

  const filtered = schools.filter((s) => {
    const matchSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.code ?? "").toLowerCase().includes(search.toLowerCase());
    const matchSector =
      sectorFilter === "all" ||
      (sectorFilter === "none" ? !s.sector_id : s.sector_id === sectorFilter);
    return matchSearch && matchSector;
  });

  const assignedCount = schools.filter((s) => s.sector_id).length;

  return (
    <EntityDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Affectation des écoles"
      description="Choisissez le secteur de chaque école — chaque conseiller suivra uniquement les directeurs et adjoints des écoles de son secteur (vue « Mon Secteur »)."
      icon={ListChecks}
      loading={assignMut.isPending}
    >
      <div className="space-y-3 pt-2">
        {/* Compteurs + filtre par secteur */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            {assignedCount} / {schools.length} affectée(s)
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] border-amber-200 bg-amber-50 text-amber-700"
          >
            {schools.length - assignedCount} hors secteur
          </Badge>
          <Select value={sectorFilter} onValueChange={setSectorFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs ml-auto">
              <SelectValue placeholder="Filtrer par secteur" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les secteurs</SelectItem>
              <SelectItem value="none">— Hors secteur —</SelectItem>
              {sectors.map((sec) => (
                <SelectItem key={sec.id} value={sec.id}>
                  {sec.name} ({sec.school_count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Recherche (nom ou code officiel) */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une école (nom ou code)…"
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Une ligne par école : nom, code, sélecteur du secteur */}
        <div className="max-h-[46vh] overflow-y-auto rounded-md border border-border/60 divide-y divide-border/60">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Aucune école ne correspond.
            </p>
          ) : (
            filtered.map((s) => {
              const value = drafts[s.id] ?? s.sector_id ?? "__none__";
              // Un école ne peut rejoindre qu'un secteur de SA propre IEP
              // (contrôle backend : même règle sur PUT /api/sectors/...).
              const options = sectors.filter(
                (sec) => sec.iep_id === s.iep_id,
              );
              return (
                <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{s.name}</p>
                    {s.code && (
                      <p className="text-[10px] font-mono text-muted-foreground">
                        {s.code}
                      </p>
                    )}
                  </div>
                  <Select
                    value={value}
                    onValueChange={(v) => assign(s.id, v)}
                    disabled={assignMut.isPending}
                  >
                    <SelectTrigger className="w-[180px] h-8 text-xs shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Hors secteur —</SelectItem>
                      {options.map((sec) => (
                        <SelectItem key={sec.id} value={sec.id}>
                          {sec.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Le changement est enregistré dès la sélection ; seuls les secteurs
          de l&apos;IEP de l&apos;école sont proposés. L&apos;affectation groupée
          par secteur (cases à cocher) reste disponible via
          «&nbsp;Secteurs d&apos;écoles&nbsp;».
        </p>
      </div>
    </EntityDialog>
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
