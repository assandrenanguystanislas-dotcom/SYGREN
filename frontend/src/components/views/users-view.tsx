"use client";

import { useState } from "react";
import { Users, Building2, ShieldCheck, UserCog, Pause, Play, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import { useAuthStore } from "@/lib/auth-store";
import { usersAdminApi } from "@/lib/api";
import { ROLE_LABELS, type Role, type UserAdminRow } from "@/lib/types";
import { TeachersView } from "./teachers-view";
import { DirectorsView } from "./directors-view";
import { InspectorsView } from "./inspectors-view";

/**
 * Vue unifiée "Utilisateurs" — fusionne Enseignants + Directeurs + Admins IEP
 * + (admin seulement) Tous les comptes avec boutons Suspendre/Réactiver.
 *
 * RBAC (Architecture D — dynamique via `modules[]`) :
 *   - "users.teachers"    → onglet Enseignants
 *   - "users.directors"   → onglet Directeurs
 *   - "users.inspectors"  → onglet Admin IEP
 *   - "users-admin"        → onglet "Tous les comptes" (super admin seul)
 */
export function UsersView() {
  const user = useAuthStore((s) => s.user);
  const modules = useAuthStore((s) => s.modules);
  const [tab, setTab] = useState("teachers");

  // Architecture D — visibility based on modules[] (with legacy fallback)
  const hasModule = (key: string) =>
    modules.length === 0 ? false : modules.includes(key);
  const hasLegacyRole = (roles: Role[]) =>
    modules.length === 0 && user ? roles.includes(user.role) : false;

  const canSeeTeachers =
    hasModule("users.teachers") || hasLegacyRole(["admin", "director", "inspector"]);
  const canSeeDirectors =
    hasModule("users.directors") || hasLegacyRole(["admin", "inspector"]);
  const canSeeInspectors = hasModule("users.inspectors") || hasLegacyRole(["admin"]);
  const canSeeAllAccounts = hasModule("users-admin") || hasLegacyRole(["admin"]);

  const visibleTabs = [
    canSeeTeachers && "teachers",
    canSeeDirectors && "directors",
    canSeeInspectors && "inspectors",
    canSeeAllAccounts && "all-accounts",
  ].filter(Boolean) as string[];

  // Si l'onglet courant n'est plus accessible, utiliser le 1er disponible
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0] ?? "teachers";

  // Si un seul onglet visible → rendu direct (pas de barre d'onglets)
  if (visibleTabs.length <= 1) {
    if (visibleTabs[0] === "teachers") return <TeachersView />;
    if (visibleTabs[0] === "directors") return <DirectorsView />;
    if (visibleTabs[0] === "inspectors") return <InspectorsView />;
    if (visibleTabs[0] === "all-accounts") return <AllAccountsTab />;
    return <TeachersView />;
  }

  return (
    <Tabs value={activeTab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        {canSeeTeachers && (
          <TabsTrigger value="teachers">
            <Users className="w-4 h-4 mr-1.5" />
            Enseignants
          </TabsTrigger>
        )}
        {canSeeDirectors && (
          <TabsTrigger value="directors">
            <Building2 className="w-4 h-4 mr-1.5" />
            Directeurs
          </TabsTrigger>
        )}
        {canSeeInspectors && (
          <TabsTrigger value="inspectors">
            <ShieldCheck className="w-4 h-4 mr-1.5" />
            Admin IEP
          </TabsTrigger>
        )}
        {canSeeAllAccounts && (
          <TabsTrigger value="all-accounts">
            <UserCog className="w-4 h-4 mr-1.5" />
            Tous les comptes
          </TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="teachers">
        <TeachersView />
      </TabsContent>
      <TabsContent value="directors">
        <DirectorsView />
      </TabsContent>
      <TabsContent value="inspectors">
        <InspectorsView />
      </TabsContent>
      <TabsContent value="all-accounts">
        <AllAccountsTab />
      </TabsContent>
    </Tabs>
  );
}

/**
 * Onglet "Tous les comptes" — visible par le super admin seulement.
 * Liste tous les utilisateurs avec boutons Suspendre/Réactiver.
 */
function AllAccountsTab() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [suspendTarget, setSuspendTarget] = useState<UserAdminRow | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["users-admin"],
    queryFn: () => usersAdminApi.list(),
  });

  const suspendMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      usersAdminApi.suspend(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-admin"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      toast.success("Utilisateur suspendu", {
        description: "Il sera déconnecté à sa prochaine action.",
      });
      setSuspendTarget(null);
      setSuspendReason("");
    },
    onError: (e: Error) => toast.error("Erreur", { description: e.message }),
  });

  const reactivateMut = useMutation({
    mutationFn: (id: string) => usersAdminApi.reactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-admin"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      toast.success("Utilisateur réactivé");
    },
    onError: (e: Error) => toast.error("Erreur", { description: e.message }),
  });

  const users = data?.users ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCog className="w-5 h-5 text-emerald-600" />
          Tous les comptes ({users.length})
        </CardTitle>
        <CardDescription>
          Suspendez ou réactivez un compte en un clic. Le compte reste en base
          (historique conservé). La suspension prend effet immédiatement.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded border">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-50 z-10">
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Email / Téléphone</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} className={!u.active ? "bg-red-50/40" : ""}>
                    <TableCell className="font-medium">{u.full_name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {u.email ?? u.phone ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={roleBadgeClass(u.role)}>
                        {ROLE_LABELS[u.role as Role] ?? u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.service ?? "—"}
                    </TableCell>
                    <TableCell>
                      {u.active ? (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                          Actif
                        </Badge>
                      ) : (
                        <Badge variant="destructive" title={u.suspended_reason ?? ""}>
                          Suspendu
                          {u.suspended_at && (
                            <span className="ml-1 font-normal opacity-70">
                              {new Date(u.suspended_at).toLocaleDateString("fr-FR")}
                            </span>
                          )}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {u.id === me?.id ? (
                        <span className="text-xs text-muted-foreground italic">Vous</span>
                      ) : u.active ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSuspendTarget(u)}
                        >
                          <Pause className="w-3 h-3 mr-1" /> Suspendre
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reactivateMut.mutate(u.id)}
                          disabled={reactivateMut.isPending}
                        >
                          <Play className="w-3 h-3 mr-1" /> Réactiver
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Suspend confirmation dialog */}
      <AlertDialog
        open={!!suspendTarget}
        onOpenChange={(o) => !o && setSuspendTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Suspendre {suspendTarget?.full_name} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              L'utilisateur sera immédiatement déconnecté et ne pourra plus se
              connecter. Son compte reste en base (historique conservé). La
              réactivation est possible à tout moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="suspend-reason" className="text-sm">
              Motif (optionnel)
            </Label>
            <Textarea
              id="suspend-reason"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Ex: fin de contrat, congé disciplinaire..."
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                suspendTarget &&
                suspendMut.mutate({
                  id: suspendTarget.id,
                  reason: suspendReason || undefined,
                })
              }
              className="bg-red-600 hover:bg-red-700"
              disabled={suspendMut.isPending}
            >
              {suspendMut.isPending ? "Suspension..." : "Confirmer la suspension"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function roleBadgeClass(role: string): string {
  switch (role) {
    case "admin":
      return "border-emerald-300 text-emerald-700 bg-emerald-50";
    case "inspector":
      return "border-amber-300 text-amber-700 bg-amber-50";
    case "director":
      return "border-sky-300 text-sky-700 bg-sky-50";
    case "teacher":
      return "border-slate-300 text-slate-700 bg-slate-50";
    default:
      return "";
  }
}
