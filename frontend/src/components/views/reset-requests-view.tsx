"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Loader2,
  Link as LinkIcon,
  CheckCircle2,
  XCircle,
  Copy,
  Clock,
} from "lucide-react";
import { authApi } from "@/lib/api";
import { toast } from "sonner";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { PasswordResetRequest } from "@/lib/types";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin/IEP",
  inspector: "Admin IEP",
  director: "Directeur",
  teacher: "Enseignant",
};

export function ResetRequestsView({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [resultDialog, setResultDialog] = useState<{
    title: string;
    value: string;
    isLink: boolean;
    message: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["reset-requests", filter],
    queryFn: () => authApi.listResetRequests(filter),
  });

  const requests = data?.requests ?? [];

  async function handleApprove(req: PasswordResetRequest, method: "temp_password" | "reset_link") {
    try {
      const res = await authApi.approveResetRequest(req.id, { method });
      if (method === "temp_password" && res.temp_password) {
        setResultDialog({
          title: "Mot de passe temporaire généré",
          value: res.temp_password,
          isLink: false,
          message: `Communiquez ce mot de passe à ${res.user_name}. L'utilisateur devra le changer à la première connexion.`,
        });
      } else if (method === "reset_link" && res.reset_link) {
        setResultDialog({
          title: "Lien de réinitialisation généré",
          value: res.reset_link,
          isLink: true,
          message: `Copiez et partagez ce lien avec ${res.user_name}. L'utilisateur pourra définir son nouveau mot de passe.`,
        });
      }
      toast.success("Demande approuvée");
      queryClient.invalidateQueries({ queryKey: ["reset-requests"] });
    } catch (e) {
      toast.error("Erreur", { description: e instanceof Error ? e.message : "Erreur inconnue" });
    }
  }

  async function handleReject(req: PasswordResetRequest) {
    try {
      await authApi.rejectResetRequest(req.id, {});
      toast.success("Demande rejetée");
      queryClient.invalidateQueries({ queryKey: ["reset-requests"] });
    } catch (e) {
      toast.error("Erreur", { description: e instanceof Error ? e.message : "Erreur inconnue" });
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    toast.success("Copié dans le presse-papier");
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Chargement des demandes…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div
            className={cn(
              "flex items-center gap-3",
              embedded ? "justify-end" : "justify-between",
            )}
          >
            {/* Titre + count : masqués en mode embedded (l'onglet parent fournit le contexte) */}
            {!embedded && (
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-semibold text-base">Demandes de réinitialisation</h2>
                  <p className="text-xs text-muted-foreground">
                    {requests.length} demande(s) {filter === "pending" ? "en attente" : "au total"}
                  </p>
                </div>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilter((f) => (f === "pending" ? "all" : "pending"))}
            >
              {filter === "pending" ? "Voir tout" : "Voir pending"}
            </Button>
          </div>

          {requests.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm font-medium">
                {filter === "pending" ? "Aucune demande en attente" : "Aucune demande"}
              </p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="p-2 text-left font-semibold">Identifiant</th>
                    <th className="p-2 text-left font-semibold">Fonction</th>
                    <th className="p-2 text-left font-semibold">Utilisateur</th>
                    <th className="p-2 text-left font-semibold">Date</th>
                    <th className="p-2 text-left font-semibold">Statut</th>
                    <th className="p-2 text-center font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr key={req.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="p-2 font-mono text-xs">{req.identifier}</td>
                      <td className="p-2">{ROLE_LABELS[req.role_hint] ?? req.role_hint}</td>
                      <td className="p-2">{req.user_name || "—"}</td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {new Date(req.created_at).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="p-2">
                        {req.status === "pending" && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                            <Clock className="w-3 h-3" /> En attente
                          </span>
                        )}
                        {req.status === "approved" && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                            <CheckCircle2 className="w-3 h-3" /> Approuvée
                          </span>
                        )}
                        {req.status === "rejected" && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                            <XCircle className="w-3 h-3" /> Rejetée
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        {req.status === "pending" ? (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={() => handleApprove(req, "temp_password")}
                            >
                              <KeyRound className="w-3 h-3 mr-1" />
                              Mdp temp.
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={() => handleApprove(req, "reset_link")}
                            >
                              <LinkIcon className="w-3 h-3 mr-1" />
                              Lien
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs h-7 text-red-600"
                              onClick={() => handleReject(req)}
                            >
                              <XCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog résultat (mdp temporaire OU lien de reset) */}
      <Dialog open={!!resultDialog} onOpenChange={(v) => !v && setResultDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {resultDialog?.isLink ? (
                <LinkIcon className="w-5 h-5" />
              ) : (
                <KeyRound className="w-5 h-5" />
              )}
              {resultDialog?.title}
            </DialogTitle>
            <DialogDescription>{resultDialog?.message}</DialogDescription>
          </DialogHeader>
          {resultDialog && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted p-3 flex items-center gap-2">
                <code className="flex-1 text-sm font-mono break-all">
                  {resultDialog.value}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(resultDialog.value)}
                >
                  <Copy className="w-3.5 h-3.5 mr-1" />
                  Copier
                </Button>
              </div>
              <Button onClick={() => setResultDialog(null)} className="w-full">
                Fermer
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
