"use client";

/**
 * Niveaux SANS enseignant titulaire (v12 — module Utilisateurs).
 *
 * Demande utilisateur : « il y a des écoles qui n'ont pas d'enseignants
 * pour tous les niveaux — permettre de faire spécialement pour ces
 * écoles : je remplirai seulement les effectifs et les redoublants ».
 *
 * Une ligne = un cours (PS MS GS · CP1..CM2 · RPL · MAC) sans agent
 * titulaire. Seuls l'EFFECTIF (F/G) et les REDOUBLANTS (F/G) se
 * saisissent — le TOTAL T est calculé automatiquement (T = F + G, même
 * convention que le dossier personnel v9). La ligne apparaît ensuite
 * automatiquement dans l'ÉTAT NOMINATIF (nom vide, cours + effectifs),
 * PDF / Word / Excel, totaux compris.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Layers, Loader2, Plus, Trash2 } from "lucide-react";

import { levelReportsApi } from "@/lib/api";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type { LevelReportInput, StaffLevelReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityDialog } from "@/components/entity-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { COURS_OPTIONS, fgtTotal } from "@/components/personnel-dossier-fields";

interface LevelReportsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** École cible (directeur : son école ; admin : école du filtre). */
  schoolId: string;
  schoolName?: string;
}

/** Saisie numérique F/G bornée 0..999 (vide = non renseigné). */
function clampCell(raw: string): number | null {
  if (raw === "") return null;
  return Math.max(0, Math.min(999, Number(raw)));
}

export function LevelReportsDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
}: LevelReportsDialogProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["level-reports", schoolId],
    queryFn: () => levelReportsApi.list(schoolId),
    enabled: open && !!schoolId,
  });

  const upsertMut = useCrudMutation(
    (payload: LevelReportInput) => levelReportsApi.upsert(schoolId, payload),
    {
      invalidateKeys: [["level-reports", schoolId]],
      successMessage: "Niveau enregistré — il apparaît dans l'état nominatif",
      actionLabel: "Enregistrement",
    },
  );
  const deleteMut = useCrudMutation(
    (id: string) => levelReportsApi.remove(id),
    {
      invalidateKeys: [["level-reports", schoolId]],
      successMessage: "Niveau retiré",
      actionLabel: "Suppression",
    },
  );

  const [deleteTarget, setDeleteTarget] = useState<StaffLevelReport | null>(
    null,
  );

  const reports = data?.level_reports ?? [];
  // Cours pas encore saisis (une seule ligne par école + cours).
  const remaining = COURS_OPTIONS.filter(
    (c) => !reports.some((r) => String(r.cours).toUpperCase() === c),
  );

  async function onDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync([deleteTarget.id]);
      setDeleteTarget(null);
    } catch {
      /* toastée */
    }
  }

  return (
    <>
      <EntityDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Niveaux sans enseignant"
        description={
          schoolName
            ? `${schoolName} — effectifs et redoublants des cours sans titulaire`
            : "Effectifs et redoublants des cours sans titulaire"
        }
        icon={Layers}
        loading={upsertMut.isPending || deleteMut.isPending}
        maxWidth="sm:max-w-lg"
      >
        <div className="space-y-3 pt-2">
          <p className="text-[11px] text-muted-foreground">
            Pour les écoles qui n&apos;ont pas d&apos;enseignant à tous les
            niveaux : saisissez ici SEULEMENT l&apos;effectif et les
            redoublants du cours. La ligne s&apos;ajoute automatiquement à
            l&apos;État nominatif (colonne COURS remplie, nom vide), totaux
            compris — impression PDF, Word et Excel.
          </p>

          {/* === Ajout d'un niveau sans titulaire === */}
          {remaining.length > 0 ? (
            <AddLevelForm
              remaining={remaining}
              pending={upsertMut.isPending}
              onAdd={(payload) => upsertMut.mutateAsync([payload])}
            />
          ) : (
            <p className="text-[11px] text-muted-foreground border border-dashed rounded-md p-2.5 text-center">
              Tous les cours ont déjà une ligne (ou sont tenus par un agent).
            </p>
          )}

          {/* === Lignes existantes === */}
          {isLoading ? (
            <div className="py-8 flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <p className="text-sm">Chargement…</p>
            </div>
          ) : error ? (
            <p className="text-sm text-destructive text-center py-4">
              {(error as Error).message}
            </p>
          ) : reports.length === 0 ? (
            <p className="text-[11px] text-muted-foreground border border-dashed rounded-md p-3 text-center">
              Aucun niveau sans enseignant enregistré pour cette école.
              Ajoutez ci-dessus les cours que personne ne tient.
            </p>
          ) : (
            <div className="space-y-2">
              {reports.map((r) => (
                <LevelReportRow
                  key={r.id}
                  report={r}
                  pending={upsertMut.isPending}
                  onSave={(payload) => upsertMut.mutateAsync([payload])}
                  onDelete={() => setDeleteTarget(r)}
                />
              ))}
            </div>
          )}
        </div>
      </EntityDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Retirer ce niveau ?"
        description={
          deleteTarget
            ? `La ligne « ${deleteTarget.cours} » disparaîtra de l'état nominatif de l'école.`
            : ""
        }
        confirmLabel="Retirer"
        destructive
        icon={Trash2}
        onConfirm={onDelete}
        loading={deleteMut.isPending}
      />
    </>
  );
}

/** Groupe Effectif ou Redoublants : F / G saisies + TOTAL T calculé. */
function FGGroup({
  label,
  f,
  g,
  onF,
  onG,
}: {
  label: string;
  f: number | null;
  g: number | null;
  onF: (v: number | null) => void;
  onG: (v: number | null) => void;
}) {
  const t = fgtTotal(f, g);
  return (
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-medium text-muted-foreground mb-1">
        {label}
      </p>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={999}
          aria-label={`${label} — Filles`}
          value={f ?? ""}
          onChange={(e) => onF(clampCell(e.target.value))}
          placeholder="F"
          className="h-8 text-xs px-2 w-full min-w-0"
        />
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={999}
          aria-label={`${label} — Garçons`}
          value={g ?? ""}
          onChange={(e) => onG(clampCell(e.target.value))}
          placeholder="G"
          className="h-8 text-xs px-2 w-full min-w-0"
        />
        <div
          aria-label={`${label} — Total calculé`}
          title="Total calculé automatiquement (T = F + G)"
          className="h-8 px-2 flex items-center justify-center rounded-md border bg-muted/40 text-xs font-mono min-w-[36px]"
        >
          {t ?? "—"}
        </div>
      </div>
    </div>
  );
}

/** Une ligne existante : cours + effectif/redoublants éditables + actions. */
function LevelReportRow({
  report,
  pending,
  onSave,
  onDelete,
}: {
  report: StaffLevelReport;
  pending: boolean;
  onSave: (payload: LevelReportInput) => Promise<unknown>;
  onDelete: () => void;
}) {
  const [f, setF] = useState<number | null>(report.effectif_f ?? null);
  const [g, setG] = useState<number | null>(report.effectif_g ?? null);
  const [rf, setRf] = useState<number | null>(report.redoublant_f ?? null);
  const [rg, setRg] = useState<number | null>(report.redoublant_g ?? null);

  return (
    <div className="rounded-md border border-border/60 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="secondary" className="text-[10px]">
          Cours : {report.cours}
        </Badge>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={pending}
            title="Enregistrer ce niveau"
            aria-label="Enregistrer ce niveau"
            onClick={() =>
              onSave({
                cours: String(report.cours),
                effectif_f: f,
                effectif_g: g,
                effectif_t: fgtTotal(f, g),
                redoublant_f: rf,
                redoublant_g: rg,
                redoublant_t: fgtTotal(rf, rg),
              })
            }
          >
            <Check className="w-4 h-4 text-emerald-600" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            title="Retirer ce niveau"
            aria-label="Retirer ce niveau"
            onClick={onDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <FGGroup
          label="Effectif"
          f={f}
          g={g}
          onF={setF}
          onG={setG}
        />
        <FGGroup
          label="Redoublants"
          f={rf}
          g={rg}
          onF={setRf}
          onG={setRg}
        />
      </div>
    </div>
  );
}

/** Formulaire d'ajout : cours libre + effectif/redoublants (T auto). */
function AddLevelForm({
  remaining,
  pending,
  onAdd,
}: {
  remaining: string[];
  pending: boolean;
  onAdd: (payload: LevelReportInput) => Promise<unknown>;
}) {
  const [cours, setCours] = useState<string>("");
  const [f, setF] = useState<number | null>(null);
  const [g, setG] = useState<number | null>(null);
  const [rf, setRf] = useState<number | null>(null);
  const [rg, setRg] = useState<number | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!cours) return;
    try {
      await onAdd({
        cours,
        effectif_f: f,
        effectif_g: g,
        effectif_t: fgtTotal(f, g),
        redoublant_f: rf,
        redoublant_g: rg,
        redoublant_t: fgtTotal(rf, rg),
      });
      // Reset pour la saisie suivante
      setCours("");
      setF(null);
      setG(null);
      setRf(null);
      setRg(null);
    } catch {
      /* toastée */
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-primary/30 bg-primary/5 p-2.5 space-y-2"
    >
      <div className="flex items-center gap-2">
        <Select value={cours} onValueChange={setCours}>
          <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
            <SelectValue placeholder="Cours sans enseignant…" />
          </SelectTrigger>
          <SelectContent>
            {remaining.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="submit"
          size="sm"
          className="h-8 shrink-0"
          disabled={!cours || pending}
        >
          <Plus className="w-4 h-4 mr-1" />
          Ajouter
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <FGGroup
          label="Effectif"
          f={f}
          g={g}
          onF={setF}
          onG={setG}
        />
        <FGGroup
          label="Redoublants"
          f={rf}
          g={rg}
          onF={setRf}
          onG={setRg}
        />
      </div>
    </form>
  );
}
