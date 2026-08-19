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
  Building2,
  School as SchoolIcon,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  scope: "all" | "school";
  school_code: string;
  month: string;
  year: string;
  eval_type: "composition" | "exam_blanc";
  eval_number: string;
  open_at: string;
  close_at: string;
  auto_open: boolean;
}

function toLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowPlusDays(days: number): string {
  return toLocalDatetime(new Date(Date.now() + days * 86400000));
}

function toISO(localDt: string): string {
  if (!localDt) return "";
  return new Date(localDt).toISOString();
}

const EMPTY: FormData = {
  scope: "all",
  school_code: "",
  month: String(new Date().getMonth() + 1),
  year: String(new Date().getFullYear()),
  eval_type: "composition",
  eval_number: "1",
  open_at: nowPlusDays(0),
  close_at: nowPlusDays(7),
  auto_open: false,
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
  const [extendTarget, setExtendTarget] = useState<SessionWithDetails | null>(null);
  const [extendDate, setExtendDate] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => sessionsApi.list(),
  });
  const { data: classesData } = useQuery({
    queryKey: ["classes"],
    queryFn: () => classesApi.list(),
    enabled: canManage,
  });

  const createMut = useMutation({
    mutationFn: async (data: FormData) => {
      return sessionsApi.bulkCreate({
        scope: data.scope,
        school_code: data.scope === "school" ? data.school_code : undefined,
        month: parseInt(data.month, 10),
        year: parseInt(data.year, 10),
        eval_type: data.eval_type,
        eval_number: parseInt(data.eval_number, 10) || 1,
        open_at: toISO(data.open_at),
        close_at: toISO(data.close_at),
        auto_open: data.auto_open,
      });
    },
    onSuccess: async (result) => {
      toast.success("Sessions créées", {
        description: `${result.created} session(s) créée(s)${result.skipped.length > 0 ? ` · ${result.skipped.length} ignorée(s)` : ""}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : "Erreur";
      toast.error("Création échouée", { description: msg });
    },
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
      await createMut.mutateAsync(form);
      setDialogOpen(false);
    } catch {
      /* toastée */
    }
  }

  async function onExtend() {
    if (!extendTarget || !extendDate) return;
    try {
      await sessionsApi.extend(extendTarget.id, toISO(extendDate));
      toast.success("Session prolongée", {
        description: `Nouvelle clôture : ${new Date(extendDate).toLocaleDateString("fr-FR")}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setExtendTarget(null);
      setExtendDate("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur";
      toast.error("Prolongation échouée", { description: msg });
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
      // Director : scope forcé à "school" (son école)
      scope: user?.role === "director" ? "school" : "all",
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
              Programmer une session
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
                        {s.eval_type === "exam_blanc" ? "Examen Blanc" : "Composition"} N°{s.eval_number}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {monthLabel(s.month)} {s.year} · {s.class_name ?? "Classe inconnue"}
                        {s.school_name && ` · ${s.school_name}`}
                      </p>
                      {s.open_at && s.close_at && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          📅 {new Date(s.open_at).toLocaleDateString("fr-FR")} → {new Date(s.close_at).toLocaleDateString("fr-FR")}
                          {s.auto_open && " · ⏰ ouverture auto"}
                        </p>
                      )}
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

                  {/* Prolongation (visible si session open ou closed) */}
                  {canManage && (s.status === "open" || s.status === "closed") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-1.5 text-xs"
                      onClick={() => {
                        setExtendTarget(s);
                        setExtendDate(s.close_at ? toLocalDatetime(new Date(s.close_at)) : nowPlusDays(7));
                      }}
                    >
                      <Calendar className="w-3.5 h-3.5 mr-1.5" />
                      Prolonger la clôture
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
          title="Programmer une session"
          description="La session sera créée pour toutes les classes actives du périmètre choisi."
          icon={Calendar}
          loading={createMut.isPending}
        >
          <form onSubmit={onSubmit} className="space-y-4 pt-2">
            {/* Périmètre : toutes les écoles ou une école spécifique */}
            <div className="space-y-2">
              <Label>Périmètre</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, scope: "all" })}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition-colors ${
                    form.scope === "all"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  <Building2 className="w-4 h-4" />
                  <span className="font-medium">Toutes les écoles</span>
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, scope: "school" })}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-sm transition-colors ${
                    form.scope === "school"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border bg-card text-muted-foreground"
                  } ${user?.role === "director" ? "pointer-events-none opacity-60" : ""}`}
                >
                  <SchoolIcon className="w-4 h-4" />
                  <span className="font-medium">Une école</span>
                </button>
              </div>
              {form.scope === "school" && (
                <div className="space-y-1.5 mt-2">
                  <Label htmlFor="school-code">Code de l&apos;école</Label>
                  <Input
                    id="school-code"
                    value={form.school_code}
                    onChange={(e) => setForm({ ...form, school_code: e.target.value })}
                    placeholder="Ex : E19474745"
                    required
                    className="font-mono"
                    disabled={user?.role === "director"}
                  />
                  {user?.role === "director" && (
                    <p className="text-[11px] text-muted-foreground">
                      En tant que directeur, les sessions seront créées pour votre école uniquement.
                    </p>
                  )}
                </div>
              )}
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

            {/* Type d'évaluation + Numéro */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="session-eval-type">Type d&apos;évaluation</Label>
                <Select
                  value={form.eval_type}
                  onValueChange={(v) =>
                    setForm({ ...form, eval_type: v as "composition" | "exam_blanc" })
                  }
                >
                  <SelectTrigger id="session-eval-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="composition">Composition</SelectItem>
                    <SelectItem value="exam_blanc">Examen Blanc (CM2)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {form.eval_type === "exam_blanc"
                    ? "⚠️ Examen Blanc réservé au CM2 — inclut la matière EPS."
                    : "Composition classique (sans EPS sauf si configurée pour la classe)."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="session-eval-number">Numéro</Label>
                <Input
                  id="session-eval-number"
                  type="number"
                  min="1"
                  value={form.eval_number}
                  onChange={(e) =>
                    setForm({ ...form, eval_number: e.target.value })
                  }
                  required
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  N° de l&apos;évaluation dans l&apos;année (1, 2, 3…).
                </p>
              </div>
            </div>

            {/* Dates d'ouverture et de clôture */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="session-open-at">Date d&apos;ouverture</Label>
                <Input
                  id="session-open-at"
                  type="datetime-local"
                  value={form.open_at}
                  onChange={(e) => setForm({ ...form, open_at: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="session-close-at">Date de clôture</Label>
                <Input
                  id="session-close-at"
                  type="datetime-local"
                  value={form.close_at}
                  onChange={(e) => setForm({ ...form, close_at: e.target.value })}
                  required
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">
              Les dates sont obligatoires. La clôture doit être après l&apos;ouverture.
            </p>

            {/* Ouverture automatique */}
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={form.auto_open}
                onCheckedChange={(v) => setForm({ ...form, auto_open: v === true })}
              />
              <span>Ouverture automatique à la date programmée</span>
            </label>
            {form.auto_open && (
              <p className="text-[11px] text-muted-foreground -mt-2">
                La session restera en statut « Brouillon » jusqu&apos;à la date d&apos;ouverture, puis passera automatiquement à « Saisie ouverte ».
              </p>
            )}

            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-[11px] text-emerald-700">
              ℹ️ La session sera créée avec le statut « Saisie ouverte » (ou « Brouillon » si ouverture automatique). Les enseignants pourront saisir leurs notes.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={form.scope === "school" && !form.school_code}>
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

      {/* Modal de prolongation */}
      {extendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <CardContent className="py-6 space-y-4">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Prolonger la session
              </h3>
              <p className="text-sm text-muted-foreground">
                {extendTarget.eval_type === "exam_blanc" ? "Examen Blanc" : "Composition"} N°{extendTarget.eval_number}
                {" — "}
                {extendTarget.class_name}
              </p>
              {extendTarget.close_at && (
                <p className="text-xs text-muted-foreground">
                  Clôture actuelle :{" "}
                  <span className="font-medium">
                    {new Date(extendTarget.close_at).toLocaleString("fr-FR")}
                  </span>
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="extend-date">Nouvelle date de clôture</Label>
                <Input
                  id="extend-date"
                  type="datetime-local"
                  value={extendDate}
                  onChange={(e) => setExtendDate(e.target.value)}
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  La nouvelle date doit être dans le futur et après la clôture actuelle.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setExtendTarget(null);
                    setExtendDate("");
                  }}
                >
                  Annuler
                </Button>
                <Button
                  type="button"
                  onClick={onExtend}
                  disabled={!extendDate}
                >
                  Prolonger
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
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
