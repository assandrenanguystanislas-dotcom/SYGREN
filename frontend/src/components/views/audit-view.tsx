"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Loader2, Search, Filter, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { auditApi } from "@/lib/api";
import type { AuditLog } from "@/lib/types";

const ACTION_LABELS: Record<string, string> = {
  "auth.login":          "Connexion",
  "auth.logout":         "Déconnexion",
  "user.suspend":        "Suspension",
  "user.reactivate":     "Réactivation",
  "user.create":         "Création utilisateur",
  "user.delete":         "Suppression utilisateur",
  "user.role_change":    "Changement de rôle",
  "permission.update":   "Modification permission",
  "session.validate":    "Validation session",
  "session.cancel":      "Annulation session",
  "session.archive":     "Archivage session",
  "setting.update":      "Modification paramètre",
};

const ENTITY_TYPES = [
  { value: "user", label: "Utilisateur" },
  { value: "permission", label: "Permission" },
  { value: "session", label: "Session" },
  { value: "setting", label: "Paramètre" },
];

export function AuditView() {
  const [action, setAction] = useState<string>("all");
  const [entityType, setEntityType] = useState<string>("all");
  const [actorId, setActorId] = useState<string>("");
  const [targetId, setTargetId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const pageSize = 50;

  const params: Parameters<typeof auditApi.list>[0] = {
    page,
    pageSize,
  };
  if (action !== "all") params.action = action;
  if (entityType !== "all") params.entity_type = entityType;
  if (actorId.trim()) params.actor_id = actorId.trim();
  if (targetId.trim()) params.target_id = targetId.trim();
  if (from) params.from = new Date(from).toISOString();
  if (to) params.to = new Date(to + "T23:59:59").toISOString();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["audit", action, entityType, actorId, targetId, from, to, page],
    queryFn: () => auditApi.list(params),
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 0;

  function resetFilters() {
    setAction("all");
    setEntityType("all");
    setActorId("");
    setTargetId("");
    setFrom("");
    setTo("");
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <History className="w-6 h-6 text-emerald-600" />
          Journal d'audit
        </h1>
        <p className="text-sm text-muted-foreground">
          Traçabilité complète des actions sensibles (connexions, suspensions,
          modifications de permissions, créations de comptes).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4" /> Filtres
          </CardTitle>
          <CardDescription>Affinez la liste par action, type d'entité, acteur, cible ou période.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="filter-action" className="text-xs">Action</Label>
              <Select value={action} onValueChange={(v) => { setAction(v); setPage(1); }}>
                <SelectTrigger id="filter-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les actions</SelectItem>
                  {Object.entries(ACTION_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="filter-entity" className="text-xs">Type d'entité</Label>
              <Select value={entityType} onValueChange={(v) => { setEntityType(v); setPage(1); }}>
                <SelectTrigger id="filter-entity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous</SelectItem>
                  {ENTITY_TYPES.map((e) => (
                    <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="filter-actor" className="text-xs">ID acteur</Label>
              <Input
                id="filter-actor"
                value={actorId}
                onChange={(e) => { setActorId(e.target.value); setPage(1); }}
                placeholder="ex: abcd1234..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="filter-target" className="text-xs">ID cible</Label>
              <Input
                id="filter-target"
                value={targetId}
                onChange={(e) => { setTargetId(e.target.value); setPage(1); }}
                placeholder="ex: abcd1234..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="filter-from" className="text-xs">Depuis</Label>
              <Input
                id="filter-from"
                type="date"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setPage(1); }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="filter-to" className="text-xs">Jusqu'à</Label>
              <Input
                id="filter-to"
                type="date"
                value={to}
                onChange={(e) => { setTo(e.target.value); setPage(1); }}
              />
            </div>
            <div className="flex items-end">
              <Button variant="outline" size="sm" onClick={resetFilters} className="w-full">
                Réinitialiser
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Événements</span>
            <span className="text-xs font-normal text-muted-foreground">
              {total} au total · page {page} / {pages}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <Search className="w-6 h-6" />
              <p className="text-sm">Aucun événement ne correspond aux filtres.</p>
            </div>
          ) : (
            <>
              <div className="max-h-[60vh] overflow-y-auto rounded border">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-50 z-10">
                    <TableRow>
                      <TableHead className="min-w-[140px]">Date</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Acteur</TableHead>
                      <TableHead>Cible</TableHead>
                      <TableHead>Détails</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log: AuditLog) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString("fr-FR")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={actionBadgeClass(log.action)}>
                            {ACTION_LABELS[log.action] ?? log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {log.actor_name || log.actor_email ? (
                            <div>
                              <div className="font-medium">{log.actor_name || "—"}</div>
                              {log.actor_email && (
                                <div className="text-muted-foreground">{log.actor_email}</div>
                              )}
                              <Badge variant="outline" className="text-[10px] mt-0.5">
                                {log.actor_role}
                              </Badge>
                            </div>
                          ) : (
                            <span className="text-muted-foreground italic">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {log.entity_id ? (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {log.entity_id.slice(0, 8)}…
                            </span>
                          ) : (
                            <span className="text-muted-foreground italic">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDetails(log)}
                          {log.ip && (
                            <div className="text-[10px] text-muted-500 font-mono mt-1">
                              IP: {log.ip}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="w-3 h-3 mr-1" /> Précédent
                </Button>
                <span className="text-xs text-muted-foreground">
                  {isFetching && "chargement…"}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pages || isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Suivant <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function actionBadgeClass(action: string): string {
  if (action.startsWith("user.suspend")) return "border-red-300 text-red-700 bg-red-50";
  if (action.startsWith("user.reactivate")) return "border-emerald-300 text-emerald-700 bg-emerald-50";
  if (action.startsWith("permission")) return "border-amber-300 text-amber-700 bg-amber-50";
  if (action.startsWith("user.create")) return "border-sky-300 text-sky-700 bg-sky-50";
  if (action.startsWith("auth")) return "border-slate-300 text-slate-700 bg-slate-50";
  if (action.startsWith("session.cancel")) return "border-red-300 text-red-700 bg-red-50";
  if (action.startsWith("session.validate") || action.startsWith("session.archive")) return "border-emerald-300 text-emerald-700 bg-emerald-50";
  return "";
}

function formatDetails(log: AuditLog): string {
  if (log.action === "permission.update" && log.details) {
    try {
      const d = JSON.parse(log.details);
      const before = d.before ?? {};
      const after = d.after ?? {};
      const beforeTxt = `${before.can_read ? "L" : "•"}${before.can_write ? "É" : "•"}`;
      const afterTxt = `${after.can_read ? "L" : "•"}${after.can_write ? "É" : "•"}`;
      return `${d.after?.role ?? before.role} · ${d.after?.module ?? before.module} : ${beforeTxt} → ${afterTxt}`;
    } catch {
      // fallthrough
    }
  }
  if (log.action === "user.suspend" && log.details) {
    try {
      const d = JSON.parse(log.details);
      const target = d.target_name ? `${d.target_name} (${d.target_role})` : "";
      const reason = d.reason ? ` — motif: ${d.reason}` : "";
      return `Suspendu ${target}${reason}`;
    } catch {
      // fallthrough
    }
  }
  if (log.action === "user.reactivate" && log.details) {
    try {
      const d = JSON.parse(log.details);
      const target = d.target_name ? `${d.target_name} (${d.target_role})` : "";
      return `Réactivé ${target}`;
    } catch {
      // fallthrough
    }
  }
  if (log.action === "auth.login") {
    return "Connexion réussie";
  }
  return log.details ? log.details.slice(0, 100) : "—";
}
