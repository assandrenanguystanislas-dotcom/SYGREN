"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Hash,
  Search,
  School as SchoolIcon,
  GraduationCap,
} from "lucide-react";

import { studentsApi, classesApi, schoolsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type { StudentWithClass, ClassWithDetails, SchoolWithStats } from "@/lib/types";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityDialog } from "@/components/entity-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface FormData {
  class_id: string;
  first_name: string;
  last_name: string;
  gender: "M" | "F";
  matricule: string; // fourni par le Ministère de l'Éducation (optionnel)
}

const EMPTY: FormData = {
  class_id: "",
  first_name: "",
  last_name: "",
  gender: "M",
  matricule: "",
};

export function StudentsView() {
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === "admin" || user?.role === "director";
  // isAdmin : voit toutes les écoles (filtre École actif)
  // isDirector : son école est pré-sélectionnée (filtre École désactivé)
  // isTeacher : pas de filtre du tout, sa classe s'affiche directement
  const isAdmin = user?.role === "admin";
  const isDirector = user?.role === "director";
  const isTeacher = user?.role === "teacher";

  // === Filtres en cascade ===
  // - admin : schoolFilter (toutes écoles) → classFilter (cascade selon école)
  // - director : schoolFilter = son école (figé, non modifiable)
  // - teacher : pas de filtre école ni classe (sa classe est chargée auto)
  const [search, setSearch] = useState("");
  const [schoolFilter, setSchoolFilter] = useState<string>(
    isDirector ? (user?.school_id ?? "all") : "all",
  );
  const [classFilter, setClassFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StudentWithClass | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<StudentWithClass | null>(
    null,
  );

  // === Écoles (admin seulement) ===
  const { data: schoolsData } = useQuery({
    queryKey: ["schools"],
    queryFn: () => schoolsApi.list(),
    enabled: isAdmin,
  });

  // === Classes : filtrées par école sélectionnée (admin/director) ===
  // Pour teacher, on charge aussi les classes (pour lookup du nom de sa classe
  // dans le tableau), mais le backend filtre déjà par teacher_id.
  const { data: classesData } = useQuery({
    queryKey: ["classes", "students-view", schoolFilter],
    queryFn: () =>
      classesApi.list({
        schoolId: schoolFilter !== "all" ? schoolFilter : undefined,
      }),
    // Teacher n'a pas besoin du filtre école (le backend filtre par teacher_id)
    enabled: !isDirector || !!user?.school_id,
  });

  // === Élèves : le backend filtre déjà par rôle (RBAC) ===
  // - admin : tous les élèves (pas de filtre scope)
  // - director : élèves de son école
  // - teacher : élèves de sa classe (teacher_id = classes.teacher_id)
  // On passe classFilter au backend pour filtrer côté serveur (plus performant
  // que de filtrer côté client sur de grosses listes).
  const { data, isLoading, error } = useQuery({
    queryKey: ["students", schoolFilter, classFilter],
    queryFn: () =>
      studentsApi.list(classFilter !== "all" ? classFilter : undefined),
  });

  const createMut = useCrudMutation(studentsApi.create, {
    invalidateKeys: [["students"], ["classes"], ["schools"]],
    successMessage: "Élève inscrit avec succès",
    actionLabel: "Inscription",
  });
  const updateMut = useCrudMutation(
    (id: string, data: FormData) => studentsApi.update(id, data),
    {
      invalidateKeys: [["students"]],
      successMessage: "Élève modifié avec succès",
      actionLabel: "Modification",
    },
  );
  const deleteMut = useCrudMutation(studentsApi.delete, {
    invalidateKeys: [["students"], ["classes"], ["schools"]],
    successMessage: "Élève supprimé",
    actionLabel: "Suppression",
  });

  function openCreate() {
    setForm(EMPTY);
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(s: StudentWithClass) {
    setForm({
      class_id: s.class_id,
      first_name: s.first_name,
      last_name: s.last_name,
      gender: s.gender as "M" | "F",
      matricule: s.matricule ?? "",
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
        const result = await createMut.mutateAsync([form]);
        // Afficher le matricule généré
        if ("matricule" in result) {
          // toast déjà affiché par le hook ; le matricule est visible dans la liste
        }
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

  const allStudents = data?.students ?? [];
  const classes = classesData?.classes ?? [];
  const schools = (schoolsData?.schools ?? []) as SchoolWithStats[];

  // Filtrage local : uniquement la recherche texte (le filtre école/classe est
  // déjà appliqué côté backend via les query params studentsApi.list(classId)
  // et le RBAC du handler ListStudents).
  const filtered = allStudents.filter((s) => {
    const mat = s.matricule ?? "";
    const matchSearch =
      !search ||
      s.first_name.toLowerCase().includes(search.toLowerCase()) ||
      s.last_name.toLowerCase().includes(search.toLowerCase()) ||
      mat.toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  // Pour le directeur, on récupère le nom de son école (pour l'afficher
  // dans le filtre désactivé).
  const directorSchoolName = isDirector
    ? schools.find((s) => s.id === user?.school_id)?.name ?? "Mon école"
    : "";

  return (
    <div className="space-y-4">
      {/* En-tête + filtres en cascade par rôle */}
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Élèves</h2>
                <p className="text-xs text-muted-foreground">
                  {allStudents.length} élève(s) affiché(s)
                  {isTeacher && " · votre classe"}
                  {isDirector && ` · ${directorSchoolName}`}
                  {isAdmin && " · matricule fourni par le Ministère"}
                </p>
              </div>
            </div>
            {canEdit && (
              <Button onClick={openCreate} size="sm" className="shadow-sm">
                <Plus className="w-4 h-4 mr-1.5" />
                Inscrire un élève
              </Button>
            )}
          </div>
          {/* === Filtres en cascade (admin + director seulement) ===
              - admin : École (toutes) → Classe (cascade selon école)
              - director : École (figée = son école, désactivé) → Classe
              - teacher : aucun filtre (sa classe est chargée automatiquement
                par le backend via RBAC teacher_id) */}
          {(isAdmin || isDirector) && (
            <div className="flex flex-wrap items-end gap-3">
              {/* Filtre École (admin: actif, director: désactivé/figé) */}
              {isAdmin && (
                <div className="space-y-1.5 min-w-[200px] flex-1 max-w-[300px] min-w-0">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <SchoolIcon className="w-3 h-3" /> École
                  </label>
                  <Select
                    value={schoolFilter}
                    onValueChange={(v) => {
                      setSchoolFilter(v);
                      setClassFilter("all"); // reset classe quand école change
                    }}
                  >
                    <SelectTrigger className="w-full overflow-hidden">
                      <SelectValue placeholder="Toutes les écoles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Toutes les écoles</SelectItem>
                      {schools.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isDirector && (
                <div className="space-y-1.5 min-w-[200px] flex-1 max-w-[300px] min-w-0">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <SchoolIcon className="w-3 h-3" /> École
                  </label>
                  <Input
                    value={directorSchoolName}
                    disabled
                    className="bg-muted/50 text-muted-foreground"
                  />
                </div>
              )}

              {/* Filtre Classe (cascade selon école) */}
              <div className="space-y-1.5 min-w-[160px] flex-1 max-w-[200px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <GraduationCap className="w-3 h-3" /> Classe
                </label>
                <Select
                  value={classFilter}
                  onValueChange={setClassFilter}
                  disabled={classes.length === 0}
                >
                  <SelectTrigger className="w-full overflow-hidden">
                    <SelectValue placeholder="Toutes les classes" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Toutes les classes</SelectItem>
                    {classes.map((c: ClassWithDetails) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
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
                    placeholder="Par nom ou matricule…"
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
          )}
          {/* Teacher : juste la recherche (pas de filtre école/classe) */}
          {isTeacher && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="relative flex-1 min-w-[200px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
                  <Search className="w-3 h-3" /> Rechercher
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Par nom ou matricule…"
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        allStudents.length === 0 ? (
          <EmptyState onCreate={canEdit ? openCreate : undefined} />
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-10 text-center text-muted-foreground">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Aucun élève ne correspond à votre recherche</p>
            </CardContent>
          </Card>
        )
      ) : (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <div className="overflow-x-auto scroll-sygren">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Matricule</TableHead>
                    <TableHead>Nom</TableHead>
                    <TableHead>Prénom</TableHead>
                    <TableHead>Sexe</TableHead>
                    <TableHead>Classe</TableHead>
                    <TableHead>École</TableHead>
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((s) => (
                    <TableRow key={s.id} className="hover:bg-muted/40">
                      <TableCell>
                        <span
                          className={`font-mono text-xs px-2 py-1 rounded ${
                            s.matricule
                              ? "bg-muted"
                              : "bg-muted/40 text-muted-foreground italic"
                          }`}
                        >
                          {s.matricule || "N/A"}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{s.last_name}</TableCell>
                      <TableCell>{s.first_name}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            s.gender === "M"
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-pink-200 bg-pink-50 text-pink-700"
                          }
                        >
                          {s.gender}
                        </Badge>
                      </TableCell>
                      <TableCell>{s.class_name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {s.school_name ?? "—"}
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
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
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <EntityDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={editing ? "Modifier l'élève" : "Inscrire un élève"}
          description={
            editing
              ? "Modifiez les informations de l'élève."
              : "Le matricule est fourni par le Ministère de l'Éducation. Laissez vide si non disponible."
          }
          icon={Users}
          loading={createMut.isPending || updateMut.isPending}
        >
          <form onSubmit={onSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="student-matricule">Matricule (Ministère)</Label>
              <Input
                id="student-matricule"
                value={form.matricule}
                onChange={(e) =>
                  setForm({ ...form, matricule: e.target.value })
                }
                placeholder="Laisser vide si non disponible — affiché « N/A »"
              />
              <p className="text-xs text-muted-foreground">
                Numéro administratif fourni par le Ministère de l'Éducation. Optionnel.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="student-class">Classe</Label>
              <Select
                value={form.class_id}
                onValueChange={(v) => setForm({ ...form, class_id: v })}
              >
                <SelectTrigger id="student-class">
                  <SelectValue placeholder="Choisir une classe…" />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c: ClassWithDetails) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} — {c.school_name ?? "École"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {classes.length === 0 && (
                <p className="text-xs text-destructive">
                  Aucune classe disponible — créez-en une d'abord.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="student-lastname">Nom</Label>
                <Input
                  id="student-lastname"
                  value={form.last_name}
                  onChange={(e) =>
                    setForm({ ...form, last_name: e.target.value })
                  }
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="student-firstname">Prénom</Label>
                <Input
                  id="student-firstname"
                  value={form.first_name}
                  onChange={(e) =>
                    setForm({ ...form, first_name: e.target.value })
                  }
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="student-gender">Sexe</Label>
              <Select
                value={form.gender}
                onValueChange={(v) =>
                  setForm({ ...form, gender: v as "M" | "F" })
                }
              >
                <SelectTrigger id="student-gender">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">Masculin</SelectItem>
                  <SelectItem value="F">Féminin</SelectItem>
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
              <Button type="submit" disabled={!form.class_id}>
                {editing ? "Enregistrer" : "Inscrire l'élève"}
              </Button>
            </div>
          </form>
        </EntityDialog>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer l'élève ?"
        description={
          deleteTarget
            ? `Supprimer "${deleteTarget.first_name} ${deleteTarget.last_name}" (${deleteTarget.matricule}) ? Cette action est irréversible.`
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
        <p className="text-sm">Chargement des élèves…</p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-10 text-center">
        <p className="text-sm text-destructive font-medium">
          Impossible de charger les élèves
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
        <Hash className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium">Aucun élève inscrit</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          {onCreate
            ? "Inscrivez vos premiers élèves. Le matricule est optionnel (fourni par le Ministère)."
            : "Les élèves inscrits apparaîtront ici."}
        </p>
        {onCreate && (
          <Button onClick={onCreate} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Inscrire un élève
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
