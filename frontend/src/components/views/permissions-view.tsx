"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Lock, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { permissionsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

export function PermissionsView({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const refreshModules = useAuthStore((s) => s.refreshModules);

  const { data, isLoading } = useQuery({
    queryKey: ["permissions"],
    queryFn: () => permissionsApi.list(),
  });

  const updateMut = useMutation({
    mutationFn: (params: { role_id: string; module_key: string; can_read?: boolean; can_write?: boolean }) =>
      permissionsApi.update(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      // Rafraîchir les modules du user courant au cas où ça affecte sa nav
      refreshModules().catch(() => {});
      toast.success("Permission mise à jour", {
        description: "Le cache RBAC est rafraîchi (≤ 5 min pour effet global).",
      });
    },
    onError: (e: Error) => toast.error("Erreur", { description: e.message }),
  })

  return (
    <div className={embedded ? "space-y-4" : "space-y-6"}>
      {/* En-tête + intro : masqués en mode embedded (l'onglet parent fournit le contexte) */}
      {!embedded && (
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
            Permissions
          </h1>
          <p className="text-sm text-muted-foreground">
            Modifiez dynamiquement la matrice rôle × module. Les changements sont actifs en
            ~5 minutes (cache), tracés dans le journal d'audit, et la nav des utilisateurs
            concernés se met à jour automatiquement.
          </p>
        </div>
      )}

      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="pt-6 flex gap-3">
          <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-medium text-amber-800">Règles de sécurité (irréductibles)</p>
            <p className="text-amber-700">
              Le rôle <strong>Super Admin</strong> garde toujours l'accès aux modules{" "}
              <code>settings</code>, <code>permissions</code>, <code>audit</code>,{" "}
              <code>users-admin</code> et <code>users.inspectors</code>. Ces cases sont
              verrouillées — impossible de les décocher — pour éviter tout auto-blocage.
            </p>
          </div>
        </CardContent>
      </Card>

      {isLoading || !data ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Matrice rôle × module</CardTitle>
            <CardDescription>
              Lignes = rôles · Colonnes = modules · Activez lecture ou écriture.
              Cliquez sur la disquette pour enregistrer les modifications en attente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-card z-10 min-w-[180px]">Rôle</TableHead>
                    {data.modules.map((m) => (
                      <TableHead key={m.key} className="text-center min-w-[140px]">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {m.key}
                          </span>
                          <span className="text-xs font-medium">{m.label}</span>
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.roles.map((role) => (
                    <TableRow key={role.id} className={role.is_system ? "bg-slate-50/40" : ""}>
                      <TableCell className="sticky left-0 bg-card z-10">
                        <div className="flex flex-col">
                          <span className="font-medium">{role.label}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {role.description}
                          </span>
                          {role.is_system && (
                            <Badge variant="outline" className="mt-1 w-fit text-[10px]">
                              Système
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      {role.modules.map((cell) => (
                        <TableCell key={cell.key} className="text-center align-middle">
                          <div className="flex flex-col items-center gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] uppercase text-muted-500">L</span>
                              <Switch
                                checked={cell.can_read}
                                disabled={cell.irreducible || updateMut.isPending}
                                onCheckedChange={(checked) =>
                                  updateMut.mutate({
                                    role_id: role.id,
                                    module_key: cell.key,
                                    can_read: checked,
                                  })
                                }
                              />
                              <span className="text-[9px] uppercase text-muted-500 ml-1">É</span>
                              <Switch
                                checked={cell.can_write}
                                disabled={cell.irreducible || updateMut.isPending}
                                onCheckedChange={(checked) =>
                                  updateMut.mutate({
                                    role_id: role.id,
                                    module_key: cell.key,
                                    can_write: checked,
                                  })
                                }
                              />
                            </div>
                            {cell.irreducible && <Lock className="w-3 h-3 text-amber-500" />}
                          </div>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Switch checked disabled /> L = Lecture (visible dans la nav + GET)
              </span>
              <span className="flex items-center gap-1">
                <Switch checked disabled /> É = Écriture (POST/PUT/DELETE)
              </span>
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3 text-amber-500" /> Irréductible (verrouillé)
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {user && user.role === "admin" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comment ça marche ?</CardTitle>
            <CardDescription>
              Comprendre le fonctionnement du RBAC dynamique.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">Lecture (L)</strong> : autorise le rôle à voir
              le module dans sa navigation et à appeler les endpoints <code>GET</code> du module.
            </p>
            <p>
              <strong className="text-foreground">Écriture (É)</strong> : autorise le rôle à
              appeler les endpoints <code>POST</code>, <code>PUT</code>, <code>DELETE</code> du
              module. Nécessite Lecture (un rôle ne peut pas écrire s'il ne peut pas lire).
            </p>
            <p>
              <strong className="text-foreground">Cache</strong> : les permissions sont mises en
              cache côté backend (5 min) pour ne pas soliciter la DB à chaque requête. Toute
              modification déclenche une invalidation immédiate — l'effet est visible dans les{" "}
              <strong>~5 minutes</strong> pour tous les utilisateurs (leur nav est rafraîchie
              automatiquement).
            </p>
            <p>
              <strong className="text-foreground">Audit</strong> : chaque changement est tracé dans
              le journal d'audit (qui a changé quoi, quand, depuis quelle IP). Consultez le
              module <em>Journal d'audit</em> pour voir l'historique.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
