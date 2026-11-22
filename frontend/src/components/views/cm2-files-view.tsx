"use client";

// === Vue « Fichiers CM2 » — module Résultats (Task 83) ===
//
// Demande : « les fichiers concernent uniquement les élèves de CM2 ; ces
// fichiers doivent être dans le module Résultats de sorte que les élèves
// soient notés à l'ouverture d'une session ».
//
// Fonctionnement :
//   - Une SESSION CM2 à l'échelle de l'IEP (création/ouverture/clôture/
//     validation réservées au Super Admin et à l'Admin IEP) — même cycle
//     de vie que les sessions de notes : draft → open → closed → validated ;
//   - À l'OUVERTURE de la session, les élèves de CM2 (toutes les écoles de
//     l'IEP, groupées secteur → école comme les fichiers papier) sont notés
//     dans les 4 matières : exploitation, eveil, orthographe, math — saisie
//     possible en open ET closed (modifiables jusqu'à la validation,
//     verrouillées ensuite) — périmètre par rôle (director = son école,
//     teacher = sa classe, contrôles backend identiques au module Notes) ;
//   - Total = Σ notes (dès 1 note) et C1 = Σ / 8,5 (dès les 4 notes —
//     barèmes CM réels 2–50 / 2–20 : 170/20 = 8,5, soit la moyenne /20)
//     recalculés À CHAQUE FRAPPE ;
//   - Export Excel PAR SECTEUR (Super Admin) — les 13 colonnes exactes de
//     la demande (lib/cm2-export.ts), notes péremplies + formules.

import { memo, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileDown,
  FileSpreadsheet,
  Loader2,
  Lock,
  Play,
  Plus,
  Save,
  School,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { cm2Api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { nextStatus, SESSION_STATUS_CONFIG } from "@/lib/session-utils";
import { cm2SecteurFileBase, exportCm2SecteurExcel } from "@/lib/cm2-export";
import type {
  Cm2FileData,
  Cm2ResultInput,
  Cm2StudentRow,
  Cm2SubjectInfo,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Valeurs éditées d'une ligne (chaînes des inputs — "" = cellule vidée).
type RowEdits = Partial<Record<"exploitation" | "eveil" | "orthographe" | "math", string>>;
type EditsMap = Record<string, RowEdits>;

const NOTE_KEYS = ["exploitation", "eveil", "orthographe", "math"] as const;
type NoteKey = (typeof NOTE_KEYS)[number];

export function Cm2FilesView() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  // Gestion (créer/ouvrir/clôturer/valider/supprimer) = admin + inspector ;
  // export fichiers = Super Admin — déduits du RÔLE (pas de la réponse du
  // fichier) : ils doivent être visibles AVANT la première session.
  const canManage = user?.role === "admin" || user?.role === "inspector";
  const canExport = user?.role === "admin";
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [secteurFilter, setSecteurFilter] = useState<string>("all");
  const [edits, setEdits] = useState<EditsMap>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newYear, setNewYear] = useState<string>(String(new Date().getFullYear()));
  const [newNumber, setNewNumber] = useState<string>("1");
  // Confirmation de transition de statut : open | closed | validated | delete
  const [confirmAction, setConfirmAction] = useState<null | {
    kind: "open" | "closed" | "validated" | "delete";
  }>(null);
  const [exporting, setExporting] = useState(false);

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["cm2", "sessions"],
    queryFn: () => cm2Api.listSessions(),
  });
  const sessions = sessionsData?.sessions ?? [];

  const { data: file, isLoading: fileLoading, error: fileError } = useQuery({
    queryKey: ["cm2", "file", selectedSessionId],
    queryFn: () => cm2Api.getFile(selectedSessionId!),
    enabled: !!selectedSessionId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["cm2", "sessions"] });
    queryClient.invalidateQueries({ queryKey: ["cm2", "file", selectedSessionId] });
  };

  // === Mutations ===
  const createMutation = useMutation({
    mutationFn: () =>
      cm2Api.createSession({ year: parseInt(newYear, 10), number: parseInt(newNumber, 10) || 1 }),
    onSuccess: (session) => {
      toast.success(`Session CM2 N°${session.number} créée — brouillon`);
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ["cm2", "sessions"] });
      setSelectedSessionId(session.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      cm2Api.updateStatus(id, status),
    onSuccess: (session) => {
      const cfg = SESSION_STATUS_CONFIG[session.status as keyof typeof SESSION_STATUS_CONFIG];
      toast.success(`Session CM2 : ${cfg?.label ?? session.status}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => cm2Api.deleteSession(id),
    onSuccess: () => {
      toast.success("Session CM2 supprimée");
      setSelectedSessionId(undefined);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Cm2ResultInput[]) =>
      cm2Api.saveResults(selectedSessionId!, payload),
    onSuccess: (res) => {
      toast.success(`${res.count} élève(s) enregistré(s)`);
      setEdits({});
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const session = sessions.find((s) => s.id === selectedSessionId);
  const sessionCfg = session
    ? SESSION_STATUS_CONFIG[session.status as keyof typeof SESSION_STATUS_CONFIG]
    : null;
  const next = session ? nextStatus(session.status) : null;

  const perms = file?.permissions;
  const canEdit = !!perms?.can_grade && !!perms?.writable;
  const subjects = file?.subjects ?? [];

  // === Édition : valeur effective (édit en cours sinon note en base) ===
  const effectiveValue = (row: Cm2StudentRow, key: NoteKey): string => {
    const edit = edits[row.student_id]?.[key];
    if (edit !== undefined) return edit;
    const v = row[`note_${key}` as keyof Cm2StudentRow];
    return v == null ? "" : String(v);
  };

  const parseNote = (raw: string): number | null => {
    const t = raw.trim().replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const setEdit = (studentId: string, key: NoteKey, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], [key]: value },
    }));
  };

  // Lignes modifiées → payload ÉTAT COMPLET (base + éditions, "" → null).
  const dirtyRows = useMemo(() => {
    if (!file) return [];
    const out: { row: Cm2StudentRow; changed: boolean }[] = [];
    for (const g of file.groups) {
      for (const sch of g.schools) {
        for (const row of sch.students) {
          const e = edits[row.student_id];
          if (!e) continue;
          const changed = NOTE_KEYS.some((k) => e[k] !== undefined);
          if (changed) out.push({ row, changed });
        }
      }
    }
    return out;
  }, [file, edits]);

  const buildPayload = (): Cm2ResultInput[] => {
    const payload: Cm2ResultInput[] = [];
    for (const { row } of dirtyRows) {
      const e = edits[row.student_id];
      const item: Cm2ResultInput = {
        student_id: row.student_id,
        note_exploitation: null,
        note_eveil: null,
        note_orthographe: null,
        note_math: null,
      };
      for (const k of NOTE_KEYS) {
        const raw = e?.[k] !== undefined ? e[k] : effectiveValue(row, k);
        item[`note_${k}`] = parseNote(raw ?? "");
      }
      payload.push(item);
    }
    return payload;
  };

  const invalidCount = useMemo(() => {
    let n = 0;
    for (const { row } of dirtyRows) {
      for (const k of NOTE_KEYS) {
        const raw = edits[row.student_id]?.[k];
        if (raw === undefined) continue;
        const v = parseNote(raw);
        if (v == null) {
          n++;
          continue;
        }
        const subj = subjects.find((s) => s.key === k);
        if (subj && (v < subj.min_score || v > subj.max_score)) n++;
      }
    }
    return n;
  }, [dirtyRows, edits, subjects]);

  const handleSave = () => {
    if (invalidCount > 0) {
      toast.error(
        `${invalidCount} note(s) hors barème — corrigez les cellules en rouge avant d'enregistrer`,
      );
      return;
    }
    const payload = buildPayload();
    if (payload.length === 0) return;
    saveMutation.mutate(payload);
  };

  // === Export Excel par secteur ===
  const selectedSectorName = secteurFilter === "all" ? null : secteurFilter === "hors" ? "HORS SECTEUR" : secteurFilter;
  const handleExport = async () => {
    if (!file || !selectedSectorName) return;
    const group =
      secteurFilter === "hors"
        ? file.groups.find((g) => g.secteur_id === null)
        : file.groups.find((g) => g.secteur_id === secteurFilter);
    if (!group || group.schools.length === 0) {
      toast.error("Aucune école dans ce secteur");
      return;
    }
    setExporting(true);
    try {
      await exportCm2SecteurExcel(
        { session: file.session, secteurName: group.secteur_name, schools: group.schools },
        `${cm2SecteurFileBase(file.session, group.secteur_name)}.xlsx`,
      );
      toast.success(`Fichier Excel « ${group.secteur_name} » généré (${group.schools.length} école(s))`);
    } catch {
      toast.error("Échec de la génération du fichier Excel");
    } finally {
      setExporting(false);
    }
  };

  // Groupes visibles selon le filtre secteur.
  const visibleGroups = useMemo(() => {
    if (!file) return [];
    if (secteurFilter === "all") return file.groups;
    return file.groups.filter((g) =>
      secteurFilter === "hors" ? g.secteur_id === null : g.secteur_id === secteurFilter,
    );
  }, [file, secteurFilter]);

  const totalVisible = visibleGroups.reduce(
    (n, g) => n + g.schools.reduce((m, s) => m + s.students.length, 0),
    0,
  );

  const waitSession = sessions.length === 0;

  return (
    <div className="space-y-4">
      {/* === En-tête : titre + sélecteurs + gestion de session === */}
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">Fichiers CM2 — par secteur</h2>
                <p className="text-xs text-muted-foreground">
                  {waitSession
                    ? "Aucune session CM2 — créez puis ouvrez une session pour noter les élèves"
                    : !selectedSessionId
                      ? "Sélectionnez une session pour voir le fichier"
                      : "Notation à l'ouverture de la session — exploitation, eveil, orthographe, math"}
                </p>
              </div>
            </div>
            {session && sessionCfg && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn("text-xs", sessionCfg.color)}>
                  {sessionCfg.label}
                </Badge>
                {perms?.can_manage && next?.status && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={statusMutation.isPending}
                    onClick={() => setConfirmAction({ kind: next.status! })}
                  >
                    <Play className="w-3.5 h-3.5 mr-1.5" />
                    {next.label}
                  </Button>
                )}
                {perms?.can_manage && session.status !== "validated" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => setConfirmAction({ kind: "delete" })}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Supprimer
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {/* Session CM2 */}
            <div className="space-y-1.5 min-w-[220px] flex-1 max-w-[340px] min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Session CM2
              </label>
              <Select
                value={selectedSessionId ?? ""}
                onValueChange={(v) => {
                  setSelectedSessionId(v);
                  setEdits({});
                  setSecteurFilter("all");
                }}
                disabled={sessionsLoading || sessions.length === 0}
              >
                <SelectTrigger className="w-full overflow-hidden">
                  <SelectValue
                    placeholder={
                      sessions.length === 0 ? "Aucune session CM2" : "Choisir une session…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => {
                    const c = SESSION_STATUS_CONFIG[s.status as keyof typeof SESSION_STATUS_CONFIG];
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        Session N°{s.number} — {s.year} ({c?.label ?? s.status}
                        {s.results_count ? ` — ${s.results_count} noté(s)` : ""})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {/* Filtre secteur */}
            <div className="space-y-1.5 min-w-[200px] flex-1 max-w-[280px] min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <School className="w-3 h-3" /> Secteur
              </label>
              <Select
                value={secteurFilter}
                onValueChange={setSecteurFilter}
                disabled={!file || file.groups.length === 0}
              >
                <SelectTrigger className="w-full overflow-hidden">
                  <SelectValue placeholder="Tous les secteurs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les secteurs</SelectItem>
                  {file?.groups.map((g) => (
                    <SelectItem key={g.secteur_id ?? "hors"} value={g.secteur_id ?? "hors"}>
                      {g.secteur_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Créer une session (admin/inspector) */}
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4 mr-1.5" />
                Nouvelle session
              </Button>
            )}

            {/* Export Excel par secteur (Super Admin) */}
            {canExport && (
              <Button
                size="sm"
                variant="outline"
                disabled={!selectedSectorName || exporting || !file}
                onClick={handleExport}
                title={
                  selectedSectorName
                    ? "Générer le fichier Excel du secteur (13 colonnes)"
                    : "Choisissez un secteur pour exporter son fichier"
                }
              >
                {exporting ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <FileDown className="w-4 h-4 mr-1.5" />
                )}
                {selectedSectorName
                  ? `Exporter Excel — ${selectedSectorName}`
                  : "Exporter Excel (choisir un secteur)"}
              </Button>
            )}
          </div>

          {/* Barème + formule */}
          {file && (
            <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 items-center">
              <span className="font-medium text-foreground">
                Barèmes CM :{" "}
                {subjects
                  .map((s) => `${s.label} ${s.min_score}–${s.max_score}`)
                  .join(" · ")}
              </span>
              <span>
                C1 = (exploitation + eveil + orthographe + math) / {file.c1_divisor} —
                soit la moyenne sur /20 dès que les 4 notes sont saisies
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" />
                {totalVisible} élève(s) CM2 affiché(s)
              </span>
              {canEdit ? (
                <span className="text-emerald-600 font-medium">Saisie ouverte</span>
              ) : perms?.can_grade && !perms.writable ? (
                <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                  <Lock className="w-3 h-3" />
                  {session?.status === "draft"
                    ? "Saisie verrouillée — la session n'est pas encore ouverte"
                    : "Notes verrouillées — session validée"}
                </span>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* === Contenu === */}
      {sessionsLoading || (selectedSessionId && fileLoading) ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm">Chargement…</p>
          </CardContent>
        </Card>
      ) : fileError ? (
        <Card className="border-destructive/40">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-destructive font-medium">
              Impossible de charger le fichier CM2
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {(fileError as Error).message}
            </p>
          </CardContent>
        </Card>
      ) : !selectedSessionId || !file ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              {waitSession
                ? canManage
                  ? "Créez une session CM2 pour commencer (bouton « Nouvelle session »)"
                  : "Aucune session CM2 — contactez l'inspection pour l'ouverture d'une session"
                : "Sélectionnez une session dans la liste"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {visibleGroups.map((g) => (
            <SectorCard
              key={g.secteur_id ?? "hors"}
              group={g}
              subjects={subjects}
              canEdit={canEdit}
              edits={edits}
              effectiveValue={effectiveValue}
              setEdit={setEdit}
            />
          ))}
          {visibleGroups.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Aucun élève de CM2 dans ce périmètre.
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* === Barre d'enregistrement (sticky) === */}
      {canEdit && dirtyRows.length > 0 && (
        <div className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-background/95 backdrop-blur px-4 py-2.5 shadow-lg">
            <span className="text-sm">
              <span className="font-semibold">{dirtyRows.length}</span> élève(s)
              modifié(s)
              {invalidCount > 0 && (
                <span className="text-destructive font-medium ml-2">
                  {invalidCount} note(s) hors barème
                </span>
              )}
            </span>
            <Button
              size="sm"
              disabled={saveMutation.isPending || invalidCount > 0}
              onClick={handleSave}
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-1.5" />
              )}
              Enregistrer
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdits({})}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* === Dialogue de création de session === */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>Nouvelle session CM2</DialogTitle>
            <DialogDescription>
              La session est créée en brouillon — ouvrez-la pour autoriser la saisie
              des notes des élèves de CM2.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cm2-year">Année scolaire</Label>
              <Input
                id="cm2-year"
                type="number"
                min={2000}
                max={2100}
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm2-number">Numéro</Label>
              <Input
                id="cm2-number"
                type="number"
                min={1}
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Annuler
            </Button>
            <Button
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              )}
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === Confirmation de transition / suppression === */}
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        destructive={confirmAction?.kind === "delete"}
        title={
          confirmAction?.kind === "open"
            ? "Ouvrir la saisie des notes ?"
            : confirmAction?.kind === "closed"
              ? "Clôturer la saisie ?"
              : confirmAction?.kind === "validated"
                ? "Valider les notes ?"
                : "Supprimer la session CM2 ?"
        }
        description={
          confirmAction?.kind === "open"
            ? "Les adjoint(e)s au directeur et les directeurs pourront saisir les notes des élèves de CM2 (exploitation, eveil, orthographe, math) jusqu'à la validation."
            : confirmAction?.kind === "closed"
              ? "La saisie est clôturée — les notes restent modifiables jusqu'à la validation."
              : confirmAction?.kind === "validated"
                ? "Les notes seront verrouillées définitivement et les fichiers CM2 figés."
                : "La session et les notes déjà saisies seront supprimées. Cette action est irréversible."
        }
        confirmLabel={
          confirmAction?.kind === "delete"
            ? "Supprimer"
            : confirmAction?.kind === "validated"
              ? "Valider"
              : "Confirmer"
        }
        icon={confirmAction?.kind === "validated" ? CheckCircle2 : undefined}
        loading={statusMutation.isPending || deleteMutation.isPending}
        onConfirm={() => {
          if (!confirmAction || !session) return;
          if (confirmAction.kind === "delete") {
            deleteMutation.mutate(session.id);
          } else {
            statusMutation.mutate({ id: session.id, status: confirmAction.kind });
          }
          setConfirmAction(null);
        }}
      />
    </div>
  );
}

// === Carte d'un secteur : bandeau + écoles + lignes élèves ===
interface SectorCardProps {
  group: Cm2FileData["groups"][number];
  subjects: Cm2SubjectInfo[];
  canEdit: boolean;
  edits: EditsMap;
  effectiveValue: (row: Cm2StudentRow, key: NoteKey) => string;
  setEdit: (studentId: string, key: NoteKey, value: string) => void;
}

function SectorCard({ group, subjects, canEdit, edits, effectiveValue, setEdit }: SectorCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const nSchools = group.schools.length;
  const nStudents = group.schools.reduce((n, s) => n + s.students.length, 0);
  const nGraded = group.schools.reduce(
    (n, s) =>
      n +
      s.students.filter((st) =>
        NOTE_KEYS.some((k) => st[`note_${k}` as keyof Cm2StudentRow] != null),
      ).length,
    0,
  );

  return (
    <Card className="border-border/60">
      <CardHeader className="py-3 cursor-pointer select-none" onClick={() => setCollapsed((c) => !c)}>
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            {collapsed ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            )}
            <School className="w-4 h-4 text-primary shrink-0" />
            <span className="truncate font-semibold">{group.secteur_name}</span>
          </span>
          <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground shrink-0">
            <Badge variant="outline" className="text-[11px]">
              {nSchools} école(s)
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {nStudents} élève(s)
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {nGraded} noté(s)
            </Badge>
          </span>
        </CardTitle>
      </CardHeader>
      {!collapsed && (
        <CardContent className="p-0">
          {group.schools.map((sch) => (
            <div key={sch.school_id}>
              <div className="bg-muted/60 border-y px-4 py-1.5 text-xs font-semibold flex items-center gap-2">
                <School className="w-3 h-3 text-muted-foreground" />
                ECOLE : {sch.school_name} — CODE : {sch.school_code} —{" "}
                {sch.students.length} élève(s)
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8 w-[110px]">matricule</TableHead>
                      <TableHead className="h-8 min-w-[140px]">nom</TableHead>
                      <TableHead className="h-8 min-w-[140px]">prenoms</TableHead>
                      <TableHead className="h-8 w-[70px]">classe</TableHead>
                      {NOTE_KEYS.map((k) => {
                        const subj = subjects.find((s) => s.key === k);
                        return (
                          <TableHead key={k} className="h-8 text-center w-[86px]">
                            <span title={subj ? `barème CM : ${subj.min_score}–${subj.max_score} (${subj.subject_name ?? "?"})` : undefined}>
                              {k}
                              {subj && (
                                <span className="block text-[9px] font-normal text-muted-foreground">
                                  {subj.min_score}–{subj.max_score}
                                </span>
                              )}
                            </span>
                          </TableHead>
                        );
                      })}
                      <TableHead className="h-8 text-center w-[70px]">Total</TableHead>
                      <TableHead className="h-8 text-center w-[70px]">C1</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sch.students.map((row) => (
                      <Cm2Row
                        key={row.student_id}
                        row={row}
                        subjects={subjects}
                        canEdit={canEdit}
                        edited={edits[row.student_id] !== undefined}
                        value={(k) => effectiveValue(row, k)}
                        onChange={(k, v) => setEdit(row.student_id, k, v)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

// === Ligne élève (mémoïsée — la frappe ne re-rend que la ligne modifiée) ===
interface Cm2RowProps {
  row: Cm2StudentRow;
  subjects: Cm2SubjectInfo[];
  canEdit: boolean;
  edited: boolean;
  value: (key: NoteKey) => string;
  onChange: (key: NoteKey, value: string) => void;
}

const Cm2Row = memo(function Cm2Row({ row, subjects, canEdit, edited, value, onChange }: Cm2RowProps) {
  const totals = useMemo(() => {
    let sum = 0;
    let cnt = 0;
    for (const k of NOTE_KEYS) {
      const raw = value(k).trim().replace(",", ".");
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      sum += n;
      cnt++;
    }
    return { sum, cnt, c1: cnt === 4 ? sum / 8.5 : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [NOTE_KEYS.map((k) => value(k)).join("|")]);

  const fmt = (n: number | null) =>
    n == null ? "—" : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);

  return (
    <TableRow className={cn(edited && "bg-amber-50/60 dark:bg-amber-950/20")}>
      <TableCell className="py-1.5 font-mono text-xs text-muted-foreground">
        {row.matricule ?? "—"}
      </TableCell>
      <TableCell className="py-1.5 font-medium text-sm">{row.nom}</TableCell>
      <TableCell className="py-1.5 text-sm">{row.prenoms}</TableCell>
      <TableCell className="py-1.5">
        <Badge variant="outline" className="text-[10px] px-1.5">
          {row.class_name}
        </Badge>
      </TableCell>
      {NOTE_KEYS.map((k) => {
        const raw = value(k);
        const subj = subjects.find((s) => s.key === k);
        const parsed = raw.trim() === "" ? null : Number(raw.trim().replace(",", "."));
        const invalid =
          parsed != null && subj && (parsed < subj.min_score || parsed > subj.max_score);
        return (
          <TableCell key={k} className="py-1.5 px-1">
            <Input
              inputMode="decimal"
              disabled={!canEdit}
              value={raw}
              onChange={(e) => onChange(k, e.target.value)}
              placeholder="—"
              className={cn(
                "h-7 w-[72px] text-center text-sm px-1",
                invalid && "border-destructive ring-1 ring-destructive",
              )}
            />
          </TableCell>
        );
      })}
      <TableCell className="py-1.5 text-center font-semibold text-sm">
        {totals.cnt > 0 ? fmt(totals.sum) : "—"}
      </TableCell>
      <TableCell className="py-1.5 text-center font-bold text-sm">
        {totals.c1 != null ? (
          <span className={totals.c1 >= 10 ? "text-emerald-600" : "text-amber-600"}>
            {totals.c1.toFixed(2)}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );
});
