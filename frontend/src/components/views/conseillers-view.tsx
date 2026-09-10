"use client";

// === Onglet « Conseillers » — module Utilisateurs (v5, session 26) ===
//
// CRUD des comptes CONSEILLER pédagogique (rôle "conseiller") : le
// conseiller suit les écoles de SON secteur et voit uniquement leurs
// directeurs et leurs adjoints au directeur (vue « Mon Secteur »).
//
// Le compte est créé ici ; l'AFFECTATION à un secteur se fait ensuite
// dans le module Écoles > plage « Secteurs d'écoles » (colonne
// users.sector_id — le nom du secteur est affiché dans cette liste).
//
// Accès (matrice RBAC v5 — module "users.conseillers") : admin + inspector.
// Le conseiller lui-même n'a PAS accès à cette liste (isolation).

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  UsersRound,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Mail,
  Phone,
  Search,
  Network,
} from "lucide-react";

import { conseillersApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type { User } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EntityDialog } from "@/components/entity-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
}

const EMPTY: FormData = {
  full_name: "",
  email: "",
  phone: "",
  password: "",
};

export function ConseillersView() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === "admin" || user?.role === "inspector";

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["conseillers", search],
    queryFn: () => conseillersApi.list(search.trim() || undefined),
  });

  const createMut = useCrudMutation(conseillersApi.create, {
    invalidateKeys: [["conseillers"], ["sectors"]],
    successMessage: "Compte conseiller créé avec succès",
    actionLabel: "Création",
  });
  const updateMut = useCrudMutation(
    (id: string, data: FormData) =>
      conseillersApi.update(id, {
        full_name: data.full_name || undefined,
        email: data.email || null,
        phone: data.phone || null,
        password: data.password || undefined,
      }),
    {
      invalidateKeys: [["conseillers"]],
      successMessage: "Compte conseiller mis à jour",
      actionLabel: "Mise à jour",
    },
  );
  const deleteMut = useCrudMutation((id: string) => conseillersApi.remove(id), {
    invalidateKeys: [["conseillers"], ["sectors"]],
    successMessage: "Compte conseiller supprimé",
    actionLabel: "Suppression",
  });

  const conseillers = useMemo(() => data?.conseillers ?? [], [data]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(c: User) {
    setEditing(c);
    setForm({
      full_name: c.full_name ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      password: "",
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
        // Mot de passe OPTIONNEL : vide → standard = numéro de téléphone
        // (convention SYGREN — le conseiller le modifie à tout moment via
        // « Modifier votre mot de passe »).
        await createMut.mutateAsync([
          {
            full_name: form.full_name.trim(),
            email: form.email.trim() || undefined,
            phone: form.phone.trim() || undefined,
            password: form.password || undefined,
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

  return (
    <div className="space-y-4">
      {/* === En-tête + actions === */}
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <UsersRound className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Conseillers</h2>
                <p className="text-xs text-muted-foreground">
                  Conseillers pédagogiques — suivent les écoles de leur
                  secteur (directeurs et adjoints au directeur)
                </p>
              </div>
            </div>
            {canManage && (
              <Button onClick={openCreate} className="shadow-sm">
                <Plus className="w-4 h-4 mr-1.5" />
                Nouveau conseiller
              </Button>
            )}
          </div>

          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher (nom, email, téléphone)…"
              className="pl-8"
            />
          </div>
        </CardContent>
      </Card>

      {/* === Liste === */}
      <Card className="border-border/60 overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-sm">Chargement des conseillers…</p>
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-destructive">
              Erreur de chargement — {(error as Error).message}
            </div>
          ) : conseillers.length === 0 ? (
            <div className="py-12 text-center">
              <UsersRound className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {search
                  ? "Aucun conseiller ne correspond à cette recherche."
                  : "Aucun compte conseiller. Créez le premier compte, puis affectez-le à un secteur depuis le module Écoles > Secteurs d'écoles."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto scroll-sygren">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        <Network className="w-3.5 h-3.5" /> Secteur affecté
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
                  {conseillers.map((c) => (
                    <TableRow key={c.id} className="hover:bg-muted/40">
                      <TableCell className="font-medium">
                        {c.full_name}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                          {c.email && (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="w-3 h-3" /> {c.email}
                            </span>
                          )}
                          {c.phone && (
                            <span className="inline-flex items-center gap-1">
                              <Phone className="w-3 h-3" /> {c.phone}
                            </span>
                          )}
                          {!c.email && !c.phone && <span>—</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {c.sector_name ? (
                          <Badge
                            variant="outline"
                            className="text-xs border-violet-300 bg-violet-50 text-violet-700"
                          >
                            <Network className="w-3 h-3 mr-1" />
                            {c.sector_name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            Non affecté
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {c.active ? (
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
                              onClick={() => openEdit(c)}
                              aria-label={`Modifier ${c.full_name}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(c)}
                              aria-label={`Supprimer ${c.full_name}`}
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
        title={
          editing ? "Modifier le compte conseiller" : "Nouveau compte conseiller"
        }
        description="Le conseiller suit les écoles de son secteur et voit uniquement leurs directeurs et leurs adjoints au directeur."
        icon={UsersRound}
        loading={busy}
      >
        <form onSubmit={submit} className="space-y-3 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="conseiller-full-name">Nom complet *</Label>
            <Input
              id="conseiller-full-name"
              value={form.full_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, full_name: e.target.value }))
              }
              placeholder="Ex : KOUAMÉ Jean Bosco"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="conseiller-email">Email</Label>
              <Input
                id="conseiller-email"
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder="conseiller@exemple.ci"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conseiller-phone">Téléphone</Label>
              <Input
                id="conseiller-phone"
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: e.target.value }))
                }
                placeholder="+225 07 00 00 00 00"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conseiller-password">
              {editing
                ? "Nouveau mot de passe (optionnel)"
                : "Mot de passe (optionnel)"}
            </Label>
            <Input
              id="conseiller-password"
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
          <p className="text-xs text-muted-foreground">
            Au moins un email OU un téléphone est requis (identifiant de
            connexion). Mot de passe standard = numéro de téléphone, modifiable
            à tout moment. L&apos;affectation au secteur se fait ensuite dans
            le module Écoles &gt; «&nbsp;Secteurs d&apos;écoles&nbsp;».
          </p>
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
        title="Supprimer ce compte conseiller ?"
        description={
          deleteTarget
            ? `Le compte de "${deleteTarget.full_name}" perdra l'accès à sa vue « Mon Secteur » et sera retiré de son secteur. Cette action est irréversible.`
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
