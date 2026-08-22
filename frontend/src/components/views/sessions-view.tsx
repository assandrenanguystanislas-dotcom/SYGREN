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
  ShieldOff,
  Trash2,
  Layers,
  GraduationCap,
  Ban,
  Archive,
  History,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

import { sessionsApi, classesApi, schoolsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import {
  monthLabel,
  SESSION_STATUS_CONFIG,
  nextStatus,
} from "@/lib/session-utils";
import type {
  SessionWithDetails,
  ClassWithDetails,
  SessionExemptionWithDetails,
} from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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

// Niveaux d'exemption possibles (Approche A — exemptions par niveau)
const EXEMPT_LEVELS = ["CP", "CE", "CM"] as const;
type ExemptLevel = (typeof EXEMPT_LEVELS)[number];

interface FormData {
  scope: "all" | "school";
  school_code: string; // identifiant de l'école (son code unique)
  month: string;
  year: string;
  eval_type: "composition" | "exam_blanc";
  eval_number: string;
  open_at: string;
  close_at: string;
  auto_open: boolean;
  // Exemptions rapides par niveau (uniquement pertinentes en scope=school)
  exemptLevels: ExemptLevel[];
  exemptReason: string;
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
  exemptLevels: [],
  exemptReason: "",
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
  // Gestion des exemptions (dialog dédié par session)
  const [exemptionTarget, setExemptionTarget] = useState<SessionWithDetails | null>(null);
  // === Filtre de vue : "active" (draft+open+closed, défaut), "validated"
  // (validated uniquement), "archived" (archived uniquement). Aligné sur le
  // workflow : En cours → Validées → Archives. Plus de "Tout" (source de
  // confusion — mélangeait validées + en cours).
  const [statusFilter, setStatusFilter] = useState<"active" | "validated" | "archived">("active");
  // === Annulation (dialog avec raison obligatoire + option delete_grades) ===
  const [cancelTarget, setCancelTarget] = useState<SessionWithDetails | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelDeleteGrades, setCancelDeleteGrades] = useState(false);
  // === Archivage (confirm dialog simple) ===
  const [archiveTarget, setArchiveTarget] = useState<SessionWithDetails | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["sessions", statusFilter],
    queryFn: () =>
      sessionsApi.list({ view: statusFilter }),
  });
  const { data: classesData } = useQuery({
    queryKey: ["classes"],
    queryFn: () => classesApi.list(),
    enabled: canManage,
  });
  // Liste des écoles pour le Select du formulaire (scope=school)
  const { data: schoolsData } = useQuery({
    queryKey: ["schools", "sessions-view"],
    queryFn: () => schoolsApi.list(),
    enabled: canManage,
  });

  const createMut = useMutation({
    mutationFn: async (data: FormData) => {
      const result = await sessionsApi.bulkCreate({
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
      // Approche A — après création, si des exemptions rapides par niveau
      // ont été sélectionnées (scope=school uniquement), on les applique
      // sur la session fraîchement créée pour cette école.
      if (
        data.scope === "school" &&
        data.exemptLevels.length > 0 &&
        result.created > 0 &&
        data.school_code
      ) {
        // Récupère le school_id à partir du code (lookup dans la liste déjà chargée)
        const school = schoolsData?.schools.find((s) => s.code === data.school_code);
        if (school) {
          // Récupère la session fraîchement créée via filtre school_id
          const fresh = await sessionsApi.list({
            school_id: school.id,
            month: parseInt(data.month, 10),
            year: parseInt(data.year, 10),
          });
          const session = fresh.sessions.find(
            (s) =>
              s.eval_type === data.eval_type &&
              s.eval_number === (parseInt(data.eval_number, 10) || 1),
          );
          if (session) {
            const reason = data.exemptReason.trim() || "Exemption rapide (niveau)";
            for (const level of data.exemptLevels) {
              try {
                await sessionsApi.createExemption(session.id, {
                  level,
                  reason,
                });
              } catch {
                // doublon potentiel — ignoré (déjà toasté en cas d'erreur réelle)
              }
            }
          }
        }
      }
      return result;
    },
    onSuccess: async (result, vars) => {
      const exMsg =
        vars.scope === "school" && vars.exemptLevels.length > 0
          ? ` · ${vars.exemptLevels.length} exemption(s) appliquée(s)`
          : "";
      toast.success("Sessions créées", {
        description: `${result.created} session(s) créée(s)${
          result.skipped.length > 0 ? ` · ${result.skipped.length} ignorée(s)` : ""
        }${exMsg}`,
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

  // === Suppression de session (hard delete — la session + notes sont supprimées) ===
  const cancelMut = useMutation({
    mutationFn: ({ id, reason, deleteGrades }: { id: string; reason: string; deleteGrades: boolean }) =>
      sessionsApi.cancel(id, reason, deleteGrades),
    onSuccess: async (_, vars) => {
      toast.success("Session supprimée", {
        description: "La session et ses notes ont été supprimées définitivement.",
      });
      setCancelTarget(null);
      setCancelReason("");
      setCancelDeleteGrades(false);
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (e) => {
      toast.error("Suppression échouée", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      });
    },
  });

  // === Archivage de session (soft archive — notes conservées) ===
  const archiveMut = useMutation({
    mutationFn: (id: string) => sessionsApi.archive(id),
    onSuccess: async () => {
      toast.success("Session archivée", {
        description: "Les notes sont conservées pour le bilan annuel.",
      });
      // Après archivage, la session disparaît de la vue "active". On bascule
      // sur "archived" pour montrer le résultat.
      setStatusFilter("archived");
      setArchiveTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (e) => {
      toast.error("Archivage échoué", {
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

  async function onCancel() {
    if (!cancelTarget) return;
    try {
      await cancelMut.mutateAsync({
        id: cancelTarget.id,
        reason: "",
        deleteGrades: true,
      });
    } catch {
      /* toastée */
    }
  }

  async function onArchive() {
    if (!archiveTarget) return;
    try {
      await archiveMut.mutateAsync(archiveTarget.id);
    } catch {
      /* toastée */
    }
  }

  function openCancel(s: SessionWithDetails) {
    setCancelTarget(s);
    setCancelReason("");
    setCancelDeleteGrades(s.status === "open" && s.graded_count > 0);
  }

  function openArchive(s: SessionWithDetails) {
    setArchiveTarget(s);
  }

  function openCreate() {
    setForm({
      ...EMPTY,
      // Director : scope forcé à "school" (son école)
      scope: user?.role === "director" ? "school" : "all",
      // Director : on pré-remplit le code de son école s'il est chargé
      school_code:
        user?.role === "director"
          ? (schoolsData?.schools.find((s) => s.id === user.school_id)?.code ?? "")
          : "",
    });
    setDialogOpen(true);
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;

  const sessions = data?.sessions ?? [];
  const classes = classesData?.classes ?? [];
  const schools = schoolsData?.schools ?? [];

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
                {sessions.length} session(s) · cycles mensuels par école
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Filtre de vue : En cours / Validées / Archives
                Aligné sur le workflow : draft+open+closed / validated / archived.
                Chaque vue = une étape du cycle de vie de la session. */}
            <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5 text-xs">
              {([
                { key: "active", label: "En cours", icon: Calendar },
                { key: "validated", label: "Validées", icon: CheckCircle2 },
                { key: "archived", label: "Archives", icon: History },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded transition-colors ${
                    statusFilter === key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span className="font-medium">{label}</span>
                </button>
              ))}
            </div>
            {canManage && (
              <Button onClick={openCreate} size="sm" className="shadow-sm">
                <Plus className="w-4 h-4 mr-1.5" />
                Programmer une session
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {sessions.length === 0 ? (
        <EmptyState view={statusFilter} onCreate={canManage ? openCreate : undefined} />
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
                    <div className="min-w-0">
                      <p className="font-semibold text-base">
                        {s.eval_type === "exam_blanc" ? "Examen Blanc" : "Composition"} N°{s.eval_number}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {monthLabel(s.month)} {s.year} · {s.school_name ?? "École inconnue"}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {s.class_count > 0
                          ? `${s.class_count} classe(s) participante(s)`
                          : "Aucune classe active"}
                      </p>
                      {s.open_at && s.close_at && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          📅 {new Date(s.open_at).toLocaleDateString("fr-FR")} → {new Date(s.close_at).toLocaleDateString("fr-FR")}
                          {s.auto_open && " · ⏰ ouverture auto"}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${cfg.color}`}>
                      {cfg.label}
                    </Badge>
                  </div>

                  {/* Bandeau d'annulation — affiché si la session est annulée.
                      Montre la raison (obligatoire) + la date d'annulation.
                      Les notes ont été supprimées à l'annulation, donc pas de
                      stats ni de barre de complétion affichées plus bas. */}
                  {s.status === "cancelled" && (
                    <div className="mb-2 rounded-md border border-rose-200 bg-rose-50 p-2 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-rose-700">
                        <Ban className="w-3 h-3" />
                        Session annulée
                        {s.cancelled_at && (
                          <span className="text-rose-500 font-normal">
                            · {new Date(s.cancelled_at).toLocaleDateString("fr-FR")}
                          </span>
                        )}
                      </div>
                      {s.cancel_reason && (
                        <p className="text-[11px] text-rose-700/90 italic line-clamp-2">
                          « {s.cancel_reason} »
                        </p>
                      )}
                    </div>
                  )}

                  {/* Bandeau d'archivage — affiché si la session est archivée.
                      Indique que les notes sont conservées pour le bilan annuel. */}
                  {s.status === "archived" && (
                    <div className="mb-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 flex items-center gap-1.5 text-[11px] text-zinc-600">
                      <Archive className="w-3 h-3 shrink-0" />
                      <span>
                        Archivée
                        {s.archived_at && (
                          <> le {new Date(s.archived_at).toLocaleDateString("fr-FR")}</>
                        )}
                        {s.archived_by === "system-cron" ? " (auto fin d'année)" : " (manuel)"}
                        {" — notes conservées pour le bilan annuel"}
                      </span>
                    </div>
                  )}

                  {/* Badge exemption si présent */}
                  {s.exemption_count > 0 && (
                    <div
                      className="mb-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 cursor-pointer hover:bg-amber-100 transition-colors"
                      onClick={() => canManage && setExemptionTarget(s)}
                      title={canManage ? "Gérer les exemptions" : "Exemptions appliquées"}
                    >
                      <ShieldOff className="w-3 h-3" />
                      {s.exemption_count} exemption(s)
                    </div>
                  )}

                  {/* Stats + complétion — masquées pour les sessions annulées
                      (les notes ont été supprimées à l'annulation, donc les
                      compteurs sont à 0 et n'ont pas de sens). Conservées
                      pour les sessions archivées (les notes sont préservées). */}
                  {s.status !== "cancelled" && (
                    <>
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
                    </>
                  )}

                  {/* === Actions de gestion (masquées pour les statuts terminaux) ===
                      Les sessions cancelled et archived sont lecture seule :
                      plus de changement de statut, plus de prolongation, plus
                      d'exemption. Les actions dédiées (Annuler / Archiver)
                      sont affichées plus bas selon le statut courant. */}
                  {canManage && s.status !== "cancelled" && s.status !== "archived" && (
                    <>
                      {/* Action de changement de statut */}
                      {next.status && (
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
                      {(s.status === "open" || s.status === "closed") && (
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

                      {/* Gestion des exemptions (Approche A — par session) */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full mt-1 text-xs"
                        onClick={() => setExemptionTarget(s)}
                      >
                        <ShieldOff className="w-3.5 h-3.5 mr-1.5" />
                        {s.exemption_count > 0
                          ? `Gérer les exemptions (${s.exemption_count})`
                          : "Exempter des classes/niveaux"}
                      </Button>
                    </>
                  )}

                  {/* === Annulation — visible pour draft et open ===
                      Soft cancel : la session passe en statut « Annulée » avec
                      une raison obligatoire. Les notes saisies (si open) sont
                      supprimées après confirmation (checkbox delete_grades). */}
                  {canManage && (s.status === "draft" || s.status === "open") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                      onClick={() => openCancel(s)}
                      disabled={cancelMut.isPending}
                    >
                      <Ban className="w-3.5 h-3.5 mr-1.5" />
                      Supprimer la session
                    </Button>
                  )}

                  {/* === Archivage — visible pour validated ===
                      Soft archive : les notes sont CONSERVÉES et continuent
                      de nourrir le bilan annuel + la comparaison inter-annuelle.
                      La session disparaît de la vue « Actives » (filtre par défaut). */}
                  {canManage && s.status === "validated" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-1 text-xs text-zinc-600 hover:text-zinc-700 hover:bg-zinc-50"
                      onClick={() => openArchive(s)}
                      disabled={archiveMut.isPending}
                    >
                      <Archive className="w-3.5 h-3.5 mr-1.5" />
                      Archiver la session
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
          // Le formulaire contient plusieurs grilles 2 colonnes (mois/année,
          // type/numéro, dates) + la section exemptions — on élargit le dialog
          // pour que les champs ne se tassent pas, et le corps défile si besoin
          // (géré par EntityDialog : flex column + overflow-y-auto sur le corps).
          maxWidth="sm:max-w-lg"
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
                  <Label htmlFor="school-select">École</Label>
                  {user?.role === "director" ? (
                    <>
                      <Input
                        id="school-select"
                        value={
                          schools.find((s) => s.code === form.school_code)?.name ?? form.school_code
                        }
                        disabled
                      />
                      <p className="text-[11px] text-muted-foreground">
                        En tant que directeur, les sessions seront créées pour votre école uniquement.
                      </p>
                    </>
                  ) : (
                    <Select
                      value={form.school_code}
                      onValueChange={(v) => setForm({ ...form, school_code: v })}
                    >
                      <SelectTrigger id="school-select">
                        <SelectValue placeholder="Choisir une école…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {schools.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            Aucune école enregistrée
                          </div>
                        ) : (
                          schools.map((s) => (
                            <SelectItem key={s.id} value={s.code}>
                              <span className="font-medium">{s.name}</span>
                              <span className="text-muted-foreground ml-2 font-mono text-[10px]">
                                {s.code}
                              </span>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
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

            {/* Section Exemptions (Approche A) — checkboxes par niveau.
                Uniquement pertinent en scope=school : on ne peut exempter
                que pour une école précise (sinon trop large). */}
            {form.scope === "school" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2.5">
                <div className="flex items-center gap-1.5">
                  <ShieldOff className="w-3.5 h-3.5 text-amber-600" />
                  <Label className="text-xs font-medium text-amber-800">
                    Exemptions rapides (par niveau)
                  </Label>
                </div>
                <p className="text-[11px] text-amber-700 -mt-1">
                  Cochez les niveaux à exempter de cette session (CP1+CP2 pour
                  « CP », etc.). Pour exempter une classe précise, utilisez le
                  bouton « Exempter » après création.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {EXEMPT_LEVELS.map((lvl) => {
                    const checked = form.exemptLevels.includes(lvl);
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            exemptLevels: checked
                              ? form.exemptLevels.filter((l) => l !== lvl)
                              : [...form.exemptLevels, lvl],
                          })
                        }
                        className={`flex flex-col items-center gap-1 p-2 rounded-md border text-xs transition-colors ${
                          checked
                            ? "border-amber-500 bg-amber-100 text-amber-800"
                            : "border-amber-200 bg-card text-muted-foreground hover:bg-amber-50"
                        }`}
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span className="font-medium">Niveau {lvl}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="exempt-reason" className="text-[11px]">
                    Motif (optionnel)
                  </Label>
                  <Input
                    id="exempt-reason"
                    value={form.exemptReason}
                    onChange={(e) => setForm({ ...form, exemptReason: e.target.value })}
                    placeholder="Ex : Examen Blanc réservé au CM2"
                    className="text-xs h-8"
                  />
                </div>
              </div>
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
            ? `${monthLabel(statusTarget.month)} ${statusTarget.year} — école ${statusTarget.school_name ?? "inconnue"}. ` +
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
                {extendTarget.school_name ?? "École inconnue"}
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

      {/* Dialog de gestion des exemptions (Approche A) */}
      {exemptionTarget && (
        <ExemptionDialog
          session={exemptionTarget}
          classesOfSchool={classes.filter((c) => c.school_id === exemptionTarget.school_id)}
          onClose={() => setExemptionTarget(null)}
        />
      )}

      {/* === Dialog de suppression (hard delete) ===
          La session + ses notes + exemptions + moyennes sont supprimées
          DÉFINITIVEMENT de la base. Action irréversible. */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <CardContent className="py-6 space-y-4">
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-rose-100 text-rose-600">
                  <Ban className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-base">Supprimer la session</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {cancelTarget.eval_type === "exam_blanc" ? "Examen Blanc" : "Composition"} N°{cancelTarget.eval_number}
                    {" — "}
                    {monthLabel(cancelTarget.month)} {cancelTarget.year} · {cancelTarget.school_name ?? "École inconnue"}
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-700 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Cette action supprimera <strong>DÉFINITIVEMENT</strong> la session
                  {cancelTarget.graded_count > 0 && (
                    <> et ses <strong>{cancelTarget.graded_count} note(s)</strong></>
                  )}
                  {" "}de la base de données. <strong>Action irréversible.</strong>
                </span>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCancelTarget(null)}
                  disabled={cancelMut.isPending}
                >
                  Retour
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={onCancel}
                  disabled={cancelMut.isPending}
                >
                  {cancelMut.isPending ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Ban className="w-4 h-4 mr-1.5" />
                  )}
                  Supprimer définitivement
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* === Dialog d'archivage (confirmation simple) ===
          Soft archive : les notes sont CONSERVÉES. La session disparaît de la
          vue « Actives » mais reste disponible dans « Archives » et continue de
          nourrir le bilan annuel élève + la comparaison inter-annuelle. */}
      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
        title="Archiver la session ?"
        description={
          archiveTarget
            ? `${monthLabel(archiveTarget.month)} ${archiveTarget.year} — ${archiveTarget.school_name ?? "École inconnue"}. ` +
              "La session sera marquée « Archivée » et masquée de la liste active. " +
              "Les notes sont CONSERVÉES et resteront utilisées pour le bilan annuel élève " +
              "et la comparaison inter-annuelle."
            : ""
        }
        confirmLabel="Archiver"
        icon={Archive}
        onConfirm={onArchive}
        loading={archiveMut.isPending}
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

function EmptyState({ view, onCreate }: { view: "active" | "validated" | "archived"; onCreate?: () => void }) {
  // Message adapté à chaque vue (aligné sur le workflow).
  const config = {
    active: {
      icon: Calendar,
      title: "Aucune session en cours",
      desc: onCreate
        ? "Ouvrez une session mensuelle pour permettre la saisie des notes."
        : "Les sessions apparaîtront ici une fois ouvertes par le directeur.",
      showButton: true,
    },
    validated: {
      icon: CheckCircle2,
      title: "Aucune session validée",
      desc: "Les sessions validées apparaîtront ici une fois les notes saisies et validées.",
      showButton: false,
    },
    archived: {
      icon: History,
      title: "Aucune session archivée",
      desc: "Aucune session archivée pour cette année scolaire.",
      showButton: false,
    },
  }[view];
  const Icon = config.icon;
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 text-center">
        <Icon className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm font-medium">{config.title}</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4">{config.desc}</p>
        {config.showButton && onCreate && (
          <Button onClick={onCreate} size="sm">
            <Plus className="w-4 h-4 mr-1.5" />
            Ouvrir une session
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// === Dialog de gestion des exemptions (Approche A — par session) ===
//
// Affiche la liste des exemptions existantes (avec suppression) et un
// formulaire d'ajout. Permet d'exempter soit une classe précise (class_id),
// soit un niveau entier (level = CP|CE|CM). Au moins un des deux doit être
// renseigné (validé côté backend).

interface ExemptionDialogProps {
  session: SessionWithDetails;
  classesOfSchool: ClassWithDetails[];
  onClose: () => void;
}

function ExemptionDialog({ session, classesOfSchool, onClose }: ExemptionDialogProps) {
  const queryClient = useQueryClient();
  // "level" | "class" : type d'exemption en cours d'ajout
  const [addMode, setAddMode] = useState<"level" | "class">("level");
  const [levelValue, setLevelValue] = useState<string>("");
  const [classValue, setClassValue] = useState<string>("");
  const [reason, setReason] = useState("");

  // Charge les exemptions de la session
  const { data, isLoading, error } = useQuery({
    queryKey: ["session-exemptions", session.id],
    queryFn: () => sessionsApi.listExemptions(session.id),
  });

  const exemptions = data?.exemptions ?? [];

  const addMut = useMutation({
    mutationFn: async () => {
      const payload: { class_id?: string | null; level?: string | null; reason: string } = {
        reason: reason.trim(),
      };
      if (addMode === "level") {
        if (!levelValue) throw new Error("Niveau requis");
        payload.level = levelValue;
      } else {
        if (!classValue) throw new Error("Classe requise");
        payload.class_id = classValue;
      }
      return sessionsApi.createExemption(session.id, payload);
    },
    onSuccess: async () => {
      toast.success("Exemption ajoutée");
      setReason("");
      // Reset selections
      if (addMode === "level") setLevelValue("");
      else setClassValue("");
      await queryClient.invalidateQueries({ queryKey: ["session-exemptions", session.id] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (e) => {
      toast.error("Exemption échouée", {
        description: e instanceof Error ? e.message : "Erreur",
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (exemptionId: string) =>
      sessionsApi.deleteExemption(session.id, exemptionId),
    onSuccess: async () => {
      toast.success("Exemption supprimée");
      await queryClient.invalidateQueries({ queryKey: ["session-exemptions", session.id] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (e) => {
      toast.error("Suppression échouée", {
        description: e instanceof Error ? e.message : "Erreur",
      });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <CardContent className="py-6 flex flex-col gap-4 overflow-y-auto scroll-sygren">
          {/* En-tête */}
          <div>
            <h3 className="font-semibold text-base flex items-center gap-2">
              <ShieldOff className="w-4 h-4 text-amber-600" />
              Exemptions — session {session.school_name ?? "École inconnue"}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {session.eval_type === "exam_blanc" ? "Examen Blanc" : "Composition"} N°{session.eval_number} · {monthLabel(session.month)} {session.year}
            </p>
          </div>

          <p className="text-[11px] text-muted-foreground -mt-2">
            Exemptez une classe précise ou un niveau entier (CP = CP1+CP2, etc.).
            Les élèves exemptés n&apos;apparaîtront ni dans la saisie des notes ni dans les résultats.
          </p>

          {/* Liste des exemptions existantes */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {exemptions.length} exemption(s) actuelle(s)
            </p>
            {isLoading ? (
              <div className="py-4 flex items-center justify-center">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <p className="text-xs text-destructive">Erreur de chargement</p>
            ) : exemptions.length === 0 ? (
              <div className="rounded-lg border border-dashed py-4 text-center">
                <p className="text-xs text-muted-foreground">
                  Aucune exemption — toutes les classes de l&apos;école participent.
                </p>
              </div>
            ) : (
              <div className="space-y-1 max-h-44 overflow-y-auto scroll-sygren">
                {exemptions.map((ex: SessionExemptionWithDetails) => (
                  <div
                    key={ex.id}
                    className="flex items-start justify-between gap-2 p-2 rounded-md border bg-card text-xs"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      {ex.class_id ? (
                        <GraduationCap className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                      ) : (
                        <Layers className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium">
                          {ex.class_id
                            ? `Classe ${ex.class_name ?? "—"}`
                            : `Niveau ${ex.level ?? "—"}`}
                        </p>
                        {ex.reason && (
                          <p className="text-muted-foreground text-[11px] truncate">
                            {ex.reason}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMut.mutate(ex.id)}
                      disabled={deleteMut.isPending}
                      title="Supprimer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Formulaire d'ajout */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/30 p-3 space-y-2.5">
            <p className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
              <Plus className="w-3 h-3" />
              Ajouter une exemption
            </p>
            {/* Type d'exemption */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAddMode("level")}
                className={`flex items-center justify-center gap-1.5 p-2 rounded-md border text-xs transition-colors ${
                  addMode === "level"
                    ? "border-amber-500 bg-amber-100 text-amber-800"
                    : "border-amber-200 bg-card text-muted-foreground hover:bg-amber-50"
                }`}
              >
                <Layers className="w-3 h-3" />
                Niveau entier
              </button>
              <button
                type="button"
                onClick={() => setAddMode("class")}
                className={`flex items-center justify-center gap-1.5 p-2 rounded-md border text-xs transition-colors ${
                  addMode === "class"
                    ? "border-amber-500 bg-amber-100 text-amber-800"
                    : "border-amber-200 bg-card text-muted-foreground hover:bg-amber-50"
                }`}
              >
                <GraduationCap className="w-3 h-3" />
                Classe précise
              </button>
            </div>

            {addMode === "level" ? (
              <div className="space-y-1">
                <Label className="text-[11px]">Niveau à exempter</Label>
                <Select value={levelValue} onValueChange={setLevelValue}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="CP / CE / CM" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXEMPT_LEVELS.map((lvl) => (
                      <SelectItem key={lvl} value={lvl}>
                        Niveau {lvl}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-[11px]">Classe à exempter</Label>
                {classesOfSchool.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Aucune classe active dans cette école.
                  </p>
                ) : (
                  <Select value={classValue} onValueChange={setClassValue}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Choisir une classe…" />
                    </SelectTrigger>
                    <SelectContent>
                      {classesOfSchool.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.level})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="exemption-reason" className="text-[11px]">
                Motif (optionnel)
              </Label>
              <Input
                id="exemption-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex : Niveau non concerné par cette évaluation"
                className="h-8 text-xs"
              />
            </div>

            <Button
              size="sm"
              className="w-full"
              onClick={() => addMut.mutate()}
              disabled={
                addMut.isPending ||
                (addMode === "level" ? !levelValue : !classValue)
              }
            >
              {addMut.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5 mr-1.5" />
              )}
              Exempter
            </Button>
          </div>

          {/* Fermer */}
          <div className="flex justify-end pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              Fermer
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
