"use client";

// === Onglet « Parents » — module Utilisateurs (v2) ===
//
// CRUD des comptes PARENT (rôle "parent") : le parent consulte et imprime
// LE BULLETIN INDIVIDUEL de son enfant depuis le Portail Parent, à partir
// du matricule. Le champ « Matricule de l'enfant » du compte PRÉ-REMPLIT
// la recherche du portail (le parent peut en saisir un autre).
//
// Accès (matrice RBAC — module "users.parents") : admin + inspector.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UserRound,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Mail,
  Phone,
  Search,
  IdCard,
} from "lucide-react";

import { parentsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type { User } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EntityDialog } from "@/components/entity-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
// Task 73 — SÉLECTION DE LIGNES (cases à cocher) : hook partagé + barre
// d'actions orange (suppression en masse de la sélection ; mêmes
// boutons que le Fichier du personnel — Task 72).
import { SelectionActionsBar } from "@/components/selection-actions-bar";
import {
  deleteRowsInBatches,
  useRowSelection,
} from "@/lib/use-row-selection";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface FormData {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  child_matricule: string;
}

const EMPTY: FormData = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
  child_matricule: "",
};

export function ParentsView() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === "admin" || user?.role === "inspector";

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  // Task 73 — confirmation de la SUPPRESSION EN MASSE des comptes cochés.
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["parents", search],
    queryFn: () => parentsApi.list(search.trim() || undefined),
  });

  const createMut = useCrudMutation(parentsApi.create, {
    invalidateKeys: [["parents"]],
    successMessage: "Compte parent créé avec succès",
    actionLabel: "Création",
  });
  const updateMut = useCrudMutation(
    (id: string, data: FormData) =>
      parentsApi.update(id, {
        full_name: data.full_name || undefined,
        email: data.email || null,
        phone: data.phone || null,
        password: data.password || undefined,
        child_matricule: data.child_matricule || null,
      }),
    {
      invalidateKeys: [["parents"]],
      successMessage: "Compte parent mis à jour",
      actionLabel: "Mise à jour",
    },
  );
  const deleteMut = useCrudMutation((id: string) => parentsApi.delete(id), {
    invalidateKeys: [["parents"]],
    successMessage: "Compte parent supprimé",
    actionLabel: "Suppression",
  });

  const parents = useMemo(() => data?.parents ?? [], [data]);

  // Task 73 — SÉLECTION DE LIGNES (cases à cocher) : ids des comptes
  // AFFICHÉS (recherche courante) ; la sélection suit la vue — les
  // comptes disparus du dernier chargement réussi sont décochés
  // automatiquement (suppression, recherche).
  const visibleIds = useMemo(() => parents.map((p) => p.id), [parents]);
  const selection = useRowSelection(visibleIds, !!data);

  // Task 73 — SUPPRESSION EN MASSE des comptes parents cochés : DELETE
  // compte par compte (endpoint existant) PAR LOTS de 25 requêtes ;
  // bilan succès / échecs toasté.
  const queryClient = useQueryClient();
  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) =>
      deleteRowsInBatches(ids, (id) => parentsApi.delete(id)),
    onSuccess: ({ ok, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["parents"] });
      selection.clearSelection();
      setConfirmBulkDelete(false);
      if (failed === 0) {
        toast.success(
          ok === 1
            ? "1 compte parent supprimé"
            : `${ok} comptes parents supprimés`,
        );
      } else {
        toast.warning(`${ok} compte(s) supprimé(s) — ${failed} échec(s)`, {
          description:
            "Certains comptes ont peut-être déjà été retirés — actualisez la page.",
        });
      }
    },
    onError: (error) => {
      setConfirmBulkDelete(false);
      toast.error("Suppression en masse échouée", {
        description:
          error instanceof Error ? error.message : "Erreur inattendue",
      });
    },
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(p: User) {
    setEditing(p);
    setForm({
      full_name: p.full_name ?? "",
      email: p.email ?? "",
      phone: p.phone ?? "",
      password: "",
      child_matricule: p.child_matricule ?? "",
    });
    setDialogOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    try {
      if (editing) {
        await updateMut.mutateAsync([editing.id, form]);
      } else {
        // Task 26 — mot de passe OPTIONNEL : vide → standard = numéro de
        // téléphone (le parent se connecte avec son numéro comme code ET
        // comme mot de passe).
        await createMut.mutateAsync([
          {
            full_name: form.full_name.trim(),
            email: form.email.trim() || undefined,
            phone: form.phone.trim() || undefined,
            password: form.password || undefined,
            child_matricule: form.child_matricule.trim() || undefined,
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

  const busy = createMut.isPending || updateMut.isPending;

  // Task 73 — aperçu des comptes cochés (confirmation de suppression
  // en masse) : les 3 premiers noms par ordre d'affichage.
  const selectedNamesSample = parents
    .filter((p) => selection.selected.has(p.id))
    .slice(0, 3)
    .map((p) => p.full_name)
    .join(", ");

  return (
    <div className="space-y-4">
      {/* === En-tête + actions === */}
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <UserRound className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Parents</h2>
                <p className="text-xs text-muted-foreground">
                  Comptes du Portail Parent — consultation et impression du
                  bulletin individuel de l&apos;enfant (par matricule)
                </p>
              </div>
            </div>
            {canManage && (
              <Button onClick={openCreate} className="shadow-sm">
                <Plus className="w-4 h-4 mr-1.5" />
                Nouveau parent
              </Button>
            )}
          </div>

          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher (nom, email, téléphone, matricule enfant)…"
              className="pl-8"
            />
          </div>

          {/* Task 73 — BARRE D'ACTION DE LA SÉLECTION : visible dès
              qu'au moins un compte est coché — suppression en masse
              (admin + inspector) avec confirmation préalable. */}
          {canManage && selection.count > 0 && (
            <SelectionActionsBar
              label={`${selection.count} compte${selection.count > 1 ? "s" : ""} parent${selection.count > 1 ? "s" : ""} sélectionné${selection.count > 1 ? "s" : ""} sur ${parents.length} affiché${parents.length > 1 ? "s" : ""}`}
              deleting={bulkDeleteMut.isPending}
              onDelete={() => setConfirmBulkDelete(true)}
              onClear={selection.clearSelection}
            />
          )}
        </CardContent>
      </Card>

      {/* === Liste === */}
      <Card className="border-border/60 overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-sm">Chargement des parents…</p>
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-destructive">
              Erreur de chargement — {(error as Error).message}
            </div>
          ) : parents.length === 0 ? (
            <div className="py-12 text-center">
              <UserRound className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {search
                  ? "Aucun parent ne correspond à cette recherche."
                  : "Aucun compte parent. Créez le premier compte pour ouvrir l'accès au portail."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto scroll-sygren">
              <Table>
                <TableHeader>
                  <TableRow>
                    {canManage && (
                      <TableHead className="w-[40px] text-center">
                        {/* Task 73 — « tout sélectionner » : coche tous
                            les comptes AFFICHÉS (recherche courante) ;
                            état indéterminé si la sélection est
                            partielle, re-clic = tout décocher. */}
                        <Checkbox
                          checked={
                            selection.allSelected
                              ? true
                              : selection.someSelected
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={() => selection.toggleAllVisible()}
                          disabled={parents.length === 0}
                          aria-label={
                            selection.allSelected
                              ? "Tout désélectionner"
                              : "Tout sélectionner"
                          }
                          title={
                            selection.allSelected
                              ? "Tout désélectionner"
                              : "Tout sélectionner"
                          }
                        />
                      </TableHead>
                    )}
                    <TableHead>Nom</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        <IdCard className="w-3.5 h-3.5" /> Matricule de
                        l&apos;enfant
                      </span>
                    </TableHead>
                    <TableHead className="text-center">Statut</TableHead>
                    {canManage && (
                      <TableHead className="w-[92px] text-center">
                        Actions
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parents.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted/40">
                      {canManage && (
                        <TableCell className="text-center">
                          {/* Task 73 — case de SÉLECTION du compte :
                              cochée → la barre orange d'actions
                              apparaît au-dessus du tableau. */}
                          <Checkbox
                            checked={selection.selected.has(p.id)}
                            onCheckedChange={(v) =>
                              selection.toggleOne(p.id, v === true)
                            }
                            aria-label={`Sélectionner ${p.full_name}`}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-medium">{p.full_name}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                          {p.email && (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="w-3 h-3" /> {p.email}
                            </span>
                          )}
                          {p.phone && (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {p.phone}
                            </span>
                          )}
                          {!p.email && !p.phone && <span>—</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {p.child_matricule ? (
                          <span className="font-mono text-xs">
                            {p.child_matricule}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {p.active ? (
                          <Badge
                            variant="outline"
                            className="text-xs text-emerald-700 border-emerald-300"
                          >
                            Actif
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-xs text-muted-foreground"
                          >
                            Inactif
                          </Badge>
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEdit(p)}
                              aria-label={`Modifier ${p.full_name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(p)}
                              aria-label={`Supprimer ${p.full_name}`}
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
          )}
        </CardContent>
      </Card>

      {/* === Dialog création/édition === */}
      <EntityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Modifier le compte parent" : "Nouveau compte parent"}
        description="Le parent consulte et imprime le bulletin individuel de son enfant sur le Portail Parent."
        icon={UserRound}
        loading={busy}
      >
        <form onSubmit={submit} className="space-y-3 pt-2">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="parent-full-name">Nom complet *</Label>
            <Input
              id="parent-full-name"
              value={form.full_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, full_name: e.target.value }))
              }
              placeholder="Ex : KOFFI Aya Marie"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="parent-email">Email</Label>
              <Input
                id="parent-email"
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder="parent@exemple.ci"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="parent-phone">Téléphone</Label>
              <Input
                id="parent-phone"
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: e.target.value }))
                }
                placeholder="+225 07 00 00 00 00"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="parent-password">
                {editing
                  ? "Nouveau mot de passe (optionnel)"
                  : "Mot de passe (optionnel)"}
              </Label>
              <Input
                id="parent-password"
                type="password"
                value={form.password}
                onChange={(e) =>
                  setForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder={
                  editing
                    ? "Laisser vide pour conserver"
                    : "Laisser vide → numéro de téléphone"
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="parent-child-matricule">
                Matricule de l&apos;enfant
              </Label>
              <Input
                id="parent-child-matricule"
                value={form.child_matricule}
                onChange={(e) =>
                  setForm((f) => ({ ...f, child_matricule: e.target.value }))
                }
                placeholder="Ex : 196254015U"
                className="font-mono"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Au moins un email OU un téléphone est requis (identifiant de
            connexion). Le matricule de l&apos;enfant pré-remplit la recherche
            du portail parent. Mot de passe standard = numéro de téléphone : le
            parent se connecte avec son numéro comme code ET comme mot de
            passe, modifiable à tout moment via «&nbsp;Modifier votre mot de
            passe&nbsp;».
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
            disabled={
              !form.full_name.trim() ||
              (!editing && !form.email.trim() && !form.phone.trim())
            }
          >
            {editing ? "Enregistrer" : "Créer le compte"}
          </Button>
        </div>
        </form>
      </EntityDialog>

      {/* === Confirmation de suppression === */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Supprimer ce compte parent ?"
        description={
          deleteTarget
            ? `Le compte de "${deleteTarget.full_name}" perdra l'accès au portail. Cette action est irréversible.`
            : ""
        }
        confirmLabel="Supprimer"
        destructive
        icon={Trash2}
        onConfirm={onDelete}
        loading={deleteMut.isPending}
      />

      {/* Task 73 — confirmation de la SUPPRESSION EN MASSE des comptes
          cochés : le compte total + les 3 premiers noms rappelés
          pour éviter toute erreur de sélection. */}
      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title="Supprimer les comptes parents sélectionnés ?"
        description={
          selection.count > 0
            ? `${selection.count} compte${selection.count > 1 ? "s" : ""} parent${
                selection.count > 1 ? "s" : ""
              } perdra${selection.count > 1 ? "ont" : "a"} l'accès au portail${
                selectedNamesSample ? ` : ${selectedNamesSample}` : ""
              }. Cette action est irréversible.`
            : ""
        }
        confirmLabel="Supprimer"
        destructive
        icon={Trash2}
        onConfirm={() => bulkDeleteMut.mutate([...selection.selected])}
        loading={bulkDeleteMut.isPending}
      />
    </div>
  );
}
