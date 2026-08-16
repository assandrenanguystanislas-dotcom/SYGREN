"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Plus,
  Loader2,
  Lock,
  Unlock,
  CheckCircle2,
  Users,
  TrendingUp,
  Clock,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

import { sessionsApi, classesApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import {
  monthLabel,
  SESSION_STATUS_CONFIG,
  nextStatus,
} from "@/lib/session-utils";
import type { SessionWithDetails, ClassWithDetails } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EntityDialog } from "@/components/entity-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface FormData {
  class_id: string;
  month: string;
  year: string;
}

const EMPTY: FormData = {
  class_id: "",
  month: String(new Date().getMonth() + 1),
  year: String(new Date().getFullYear()),
};

export function SessionsView() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === "admin" || user?.role === "director";

  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [statusTarget, setStatusTarget] = useState<SessionWithDetails | null>(
    null,
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => sessionsApi.list(),
  });
  const { data: classesData } = useQuery({
    queryKey: ["classes"],
    queryFn: classesApi.list,
    enabled: canManage,
  });

  const createMut = useCrudMutation(sessionsApi.create, {
    invalidateKeys: [["sessions"]],
    successMessage: "Session créée avec succès",
    actionLabel: "Création",
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "closed" | "validated" }) =>
      sessionsApi.updateStatus(id, status),
    onSuccess: async (_, vars) => {
      const labels = { open: "Saisie ouverte", closed: "Saisie fermée", validated: "Session validée" };
      toast.success(labels[vars.status]);
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (e) => {
      toast.error("Échec du changement de statut", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      });
    },
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createMut.mutateAsync([
        {
          class_id: form.class_id,
          month: parseInt(form.month, 10),
          year: parseInt(form.year, 10),
          status: "open",
        },
      ]);
      setDialogOpen(false);
    } catch {
      /* toastée */
    }
  }

  async function onStatusChange() {
    if (!statusTarget) return;
    const next = nextStatus(statusTarget.status);
    if (!next.status) return;
    try {
      await statusMut.mutateAsync({ id: statusTarget.id, status: next.status });
      setStatusTarget(null);
    } catch {
      /* toastée */
    }
  }

  function openCreate() {
    setForm({
      ...EMPTY,
      // Pré-remplir avec la première classe si directeur (sa classe unique)
      class_id:
        user?.role === "director" && classesData?.classes[0]
          ? classesData.classes[0].id
          : "",
    });
    setDialogOpen(true);
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;

  const sessions = data?.sessions ?? [];
  const classes = classesData?.classes ?? [];

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <Card className="border-border/60">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-base">Sessions de saisie</h2>
              <p className="text-xs text-muted-foreground">
                {sessions.length} session(s) · cycles mensuels par classe
              </p>
            </div>
          </div>
          {canManage && (
            <Button onClick={openCreate} size="sm" className="shadow-sm">
              <Plus className="w-4 h-4 mr-1.5" />
              Ouvrir une session
            </Button>
          )}
        </CardContent>
      </Card>

      {sessions.length === 0 ? (
        <EmptyState onCreate={canManage ? openCreate : undefined} />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((s, i) => {
            const cfg = SESSION_STATUS_CONFIG[s.status as keyof typeof SESSION_STATUS_CONFIG];
            const next = nextStatus(s.status);
            return (
              <Card
                key={s.id}
                className="border-border/60 hover:shadow-md transition-shadow animate-in-up"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <CardContent className="py-4">
                  {/* En-tête : mois/année + statut */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <p className="font-semibold text-base">
                        {monthLabel(s.month)} {s.year}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {s.class_name ?? "Classe inconnue"}
                        {s.school_name && ` · ${s.school_name}`}
                      </p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] ${cfg.color}`}>
                      {cfg.label}
                    </Badge>
                  </div>

                  {/* Stats */}
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Users className="w-3 h-3" /> Élèves
                      </span>
                      <span className="font-medium">{s.student_count}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" /> Notes saisies
                      </span>
                      <span className="font-medium">
                        {s.graded_count} / {s.student_count * s.subject_count}
                      </span>
                    </div>
                    {s.draft_count > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" /> En brouillon
                        </span>
                        <span className="font-medium text-amber-600">
                          {s.draft_count}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Barre de complétion */}
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Complétion</span>
                      <span className="font-medium">
                        {s.completion_rate.toFixed(0)}%
                      </span>
                    </div>
                    <Progress value={s.completion_rate} className="h-1.5" />
                  </div>

                  {/* Action de changement de statut */}
                  {canManage && next.status && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-3 justify-between group"
                      onClick={() => setStatusTarget(s)}
                      disabled={statusMut.isPending}
                    >
                      <span className="flex items-center gap-1.5">
                        {next.status === "open" && <Unlock className="w-3.5 h-3.5" />}
                        {next.status === "closed" && <Lock className="w-3.5 h-3.5" />}
                        {next.status === "validated" && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {next.label}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog création de session */}
      {canManage && (
        <EntityDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Ouvrir une session de saisie"
          description="Créez une session mensuelle pour permettre la saisie des notes."
          icon={Calendar}
          loading={createMut.isPending}
        >
          <form onSubmit={onSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="session-class">Classe</Label>
              <Select
                value={form.class_id}
                onValueChange={(v) => setForm({ ...form, class_id: v })}
              >
                <SelectTrigger id="session-class">
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
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="session-month">Mois</Label>
                <Select
                  value={form.month}
                  onValueChange={(v) => setForm({ ...form, month: v })}
                >
                  <SelectTrigger id="session-month">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {monthLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="session-year">Année</Label>
                <Select
                  value={form.year}
                  onValueChange={(v) => setForm({ ...form, year: v })}
                >
                  <SelectTrigger id="session-year">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026, 2027].map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-[11px] text-emerald-700">
              ℹ️ La session sera créée avec le statut « Saisie ouverte ». Les enseignants pourront saisir leurs notes immédiatement.
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
                Ouvrir la session
              </Button>
            </div>
          </form>
        </EntityDialog>
      )}

      {/* Dialogue de confirmation changement de statut */}
      <ConfirmDialog
        open={!!statusTarget}
        onOpenChange={(o) => !o && setStatusTarget(null)}
        title={
          statusTarget
            ? nextStatus(statusTarget.status).label + " ?"
            : ""
        }
        description={
          statusTarget
            ? `${monthLabel(statusTarget.month)} ${statusTarget.year} — classe ${statusTarget.class_name}. ` +
              (nextStatus(statusTarget.status).status === "validated"
                ? "Cette action verrouillera définitivement les notes. Plus aucune modification ne sera possible."
                : nextStatus(statusTarget.status).status === "closed"
                  ? "La saisie sera fermée. Les enseignants ne pourront plus modifier les notes."
                  : "La saisie sera ouverte. Les enseignants pourront saisir leurs notes.")
            : ""
        }
        confirmLabel="Confirmer"
        destructive={nextStatus(statusTarget?.status ?? "")?.status === "validated"}
        icon={
          nextStatus(statusTarget?.status ?? "")?.status === "validated"
            ? CheckCircle2
            : nextStatus(statusTarget?.status ?? "")?.status === "closed"
              ? Lock
              : Unlock
        }
        onConfirm={onStatusChange}
        loading={statusMut.isPending}
      />
    </div>
  );
}

function LoadingState() {
  return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm">Chargement des sessions…</p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-10 text-center">
        <p className="text-sm text-destructive font-medium">
          Impossible de charger les sessions
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
        <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium">Aucune session de saisie</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          {onCreate
            ? "Ouvrez une session mensuelle pour permettre la saisie des notes."
            : "Les sessions apparaîtront ici une fois ouvertes par le directeur."}
        </p>
        {onCreate && (
          <Button onClick={onCreate} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Ouvrir une session
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
