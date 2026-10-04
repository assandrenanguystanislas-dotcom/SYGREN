"use client";

// === Onglet « Palmarès » du module Résultats (Task 70) ===
//
// « Tableau des 10 meilleurs élèves par niveau (CP1, CP2, CE1, CE2,
// CM1, CM2) après chaque composition et examen blanc, en termes de
// filles et garçons — 1 tableau filles et 1 tableau garçons. »
//
// Source : /api/computation/palmares — moyennes PRÉCALCULÉES de
// student_session_results agrégées sur toutes les sessions terminées
// (closed/validated/archived) de l'événement choisi (type + numéro +
// année), classées par niveau fin (nom de classe) et par sexe, toutes
// écoles du périmètre confondues (RBAC backend : admin/inspector = DREN,
// conseiller = son secteur, directeur/enseignant = son école).
//
// En-tête défini par SYGREN :
//   - bandeau de niveau vert (NIVEAU CP1 — barème) ;
//   - bandeau FILLES (rose — écho « noms des filles en rouge ») et
//     bandeau GARÇONS (bleu) ;
//   - colonnes DEMANDÉES dans l'ordre : MATRICULE, ÉCOLE, SECTEUR,
//     NOM ET PRÉNOMS, MOYENNE, RANG ;
//   - rangs partagés (1, 2, 2, 4...) — les ex-æquo de la 10e place
//     sont retenus ; rang 1 sur fond doré pâle, top 3 médaillé.
//
// Exports : PDF paysage (impression navigateur) + Excel (1 classeur,
// 2 feuilles FILLES / GARÇONS) — lib/palmares-exports.ts.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Trophy,
  Medal,
  Loader2,
  Printer,
  FileSpreadsheet,
  School,
  Users,
  Info,
} from "lucide-react";
import { toast } from "sonner";

import { computationApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { canExportFiles, ExportLockBadge } from "@/lib/doc-export";
import { canPrintInternal } from "@/lib/print-guard";
import {
  EVAL_TYPE_LABELS,
  type PalmaresData,
  type PalmaresEntry,
} from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  exportPalmaresExcel,
  palmaresEventLabel,
  printPalmaresToPdf,
} from "@/lib/palmares-exports";

/** Moyenne « 9,01 / 10 » (virgule française, barème par niveau). */
function fmtAvg(e: PalmaresEntry): string {
  return `${e.average.toFixed(2).replace(".", ",")} / ${e.average_scale}`;
}

const RANK_BADGE: Record<number, string> = {
  1: "bg-[#FFF7E6] text-[#92600A] border-[#E9C46A]",
  2: "bg-muted text-foreground border-border",
  3: "bg-[#FDEBDA] text-[#9A4B0E] border-[#F4A261]",
};

function PalmaresGenderTable({
  title,
  bandClass,
  entries,
}: {
  title: string;
  bandClass: string;
  entries: PalmaresEntry[];
}) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div
        className={cn(
          "px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white",
          bandClass,
        )}
      >
        {title}
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="h-8 text-[10px] px-2">Matricule</TableHead>
            <TableHead className="h-8 text-[10px] px-2">École</TableHead>
            <TableHead className="h-8 text-[10px] px-2">Secteur</TableHead>
            <TableHead className="h-8 text-[10px] px-2">Nom et Prénoms</TableHead>
            <TableHead className="h-8 text-[10px] px-2 text-center">
              Moyenne
            </TableHead>
            <TableHead className="h-8 text-[10px] px-2 text-center">
              Rang
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-xs text-muted-foreground py-4"
              >
                Aucun élève classé.
              </TableCell>
            </TableRow>
          ) : (
            entries.map((e) => (
              <TableRow
                key={`${e.matricule}-${e.rank}`}
                className={cn(e.rank === 1 && "bg-[#FFF7E6]")}
              >
                <TableCell className="text-[11px] font-mono px-2 py-1.5">
                  {e.matricule}
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5">
                  {e.school || "—"}
                </TableCell>
                <TableCell className="text-[11px] px-2 py-1.5 text-center">
                  {e.sector || "—"}
                </TableCell>
                <TableCell className="text-[11px] font-medium px-2 py-1.5">
                  {e.full_name}
                </TableCell>
                <TableCell className="text-[11px] font-semibold px-2 py-1.5 text-center whitespace-nowrap">
                  {fmtAvg(e)}
                </TableCell>
                <TableCell className="px-2 py-1.5 text-center">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold",
                      RANK_BADGE[e.rank] ?? "bg-background text-muted-foreground border-transparent",
                    )}
                  >
                    {e.rank <= 3 && <Medal className="w-3 h-3" />}
                    {e.rank}
                  </span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export function PalmaresView() {
  // Événements classables du périmètre de l'utilisateur (sessions
  // terminées groupées par type + numéro + année).
  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ["palmares-events"],
    queryFn: () => computationApi.getPalmaresEvents(),
  });
  const events = eventsData?.events ?? [];

  // Sélection « type|numéro|année » — le 1er événement est proposé par
  // défaut (la liste est triée année DESC côté backend).
  const [selected, setSelected] = useState<string>("");
  const effective =
    selected ||
    (events[0]
      ? `${events[0].eval_type}|${events[0].eval_number}|${events[0].year}`
      : "");
  const [evalType, evalNumber, evalYear] = effective
    ? effective.split("|")
    : ["", "", ""];

  const palmaresQuery = useQuery({
    queryKey: ["palmares", effective],
    queryFn: () =>
      computationApi.getPalmares(evalType!, Number(evalNumber!), Number(evalYear!)),
    enabled: !!effective,
  });
  const data: PalmaresData | undefined = palmaresQuery.data;

  const eventLabel = effective
    ? palmaresEventLabel(
        EVAL_TYPE_LABELS[evalType as keyof typeof EVAL_TYPE_LABELS] ?? "Évaluation",
        Number(evalNumber),
        Number(evalYear),
      )
    : "";

  // Exports (spinner par format — convention doc/xlsx du module).
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  // Task 71 — production/transfert de FICHIERS (Excel) réservée au Super
  // Admin (anti-fuite WhatsApp) ; le bouton PDF (impression papier via le
  // dialogue navigateur) suit la politique print-guard (admin + admin IEP).
  const user = useAuthStore((s) => s.user);
  const canExport = canExportFiles(user?.role);
  const canPrintDoc = canPrintInternal(user?.role);

  async function handleExcel() {
    if (!data) return;
    setExporting("xlsx");
    try {
      await exportPalmaresExcel(data, eventLabel);
    } catch {
      toast.error("Échec de l'export Excel");
    } finally {
      setExporting(null);
    }
  }

  function handlePdf() {
    if (!data) return;
    setExporting("pdf");
    try {
      printPalmaresToPdf(data, eventLabel);
    } catch {
      toast.error("Échec de l'impression PDF");
    } finally {
      setExporting(null);
    }
  }

  const hasData = !!data && (data.levels?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* === En-tête + sélecteur d'évaluation + exports === */}
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Trophy className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">
                  Palmarès — les 10 meilleurs élèves par niveau
                </h2>
                <p className="text-xs text-muted-foreground">
                  Après chaque composition et examen blanc — 1 tableau filles,
                  1 tableau garçons — classement inter-écoles de votre
                  périmètre (rangs partagés en cas d&apos;égalité).
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canPrintDoc && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePdf}
                  disabled={!hasData || exporting !== null}
                  title="Imprimer ou enregistrer en PDF (boîte d'impression du navigateur)"
                >
                  {exporting === "pdf" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Printer className="w-4 h-4" />
                  )}
                  PDF
                </Button>
              )}
              {canExport && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExcel}
                  disabled={!hasData || exporting !== null}
                  title="Classeur Excel — 2 feuilles FILLES / GARÇONS"
                >
                  {exporting === "xlsx" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileSpreadsheet className="w-4 h-4" />
                  )}
                  Excel
                </Button>
              )}
              {!canPrintDoc && !canExport && <ExportLockBadge />}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="w-[320px] max-w-full">
              <Select value={effective} onValueChange={setSelected}>
                <SelectTrigger aria-label="Évaluation">
                  <SelectValue
                    placeholder={eventsLoading ? "Chargement…" : "Choisir une évaluation"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {events.map((ev) => (
                    <SelectItem
                      key={`${ev.eval_type}|${ev.eval_number}|${ev.year}`}
                      value={`${ev.eval_type}|${ev.eval_number}|${ev.year}`}
                    >
                      {EVAL_TYPE_LABELS[ev.eval_type]} N°{ev.eval_number} —{" "}
                      {ev.year} ({ev.schools} école{ev.schools > 1 ? "s" : ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {effective && evalType === "exam_blanc" && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="w-3.5 h-3.5" />
                L&apos;examen blanc concerne le CM2 (barème incluant l&apos;EPS).
              </div>
            )}
            {data?.event && (
              <div className="flex items-center gap-2 ml-auto">
                <Badge variant="outline" className="gap-1">
                  <School className="w-3 h-3" />
                  {data.event.schools} école{data.event.schools > 1 ? "s" : ""}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Users className="w-3 h-3" />
                  {data.event.students} élève{data.event.students > 1 ? "s" : ""}{" "}
                  classé{data.event.students > 1 ? "s" : ""}
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* === Contenu === */}
      {palmaresQuery.isLoading || eventsLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Chargement du palmarès…
        </div>
      ) : !effective ? (
        <div className="text-center py-12 text-muted-foreground">
          Aucune évaluation terminée pour le moment — le palmarès sera
          disponible dès la première clôture de composition ou d&apos;examen
          blanc.
        </div>
      ) : data?.message ? (
        <div className="text-center py-12 text-muted-foreground">{data.message}</div>
      ) : !hasData || !data ? (
        <div className="text-center py-12 text-muted-foreground">
          Aucune donnée de classement pour cet événement.
        </div>
      ) : (
        <div className="space-y-4">
          {data.levels.map((lv) => (
            <Card key={lv.level} className="border-border/60 overflow-hidden">
              <div className="bg-[#009E60] text-white px-4 py-2 flex items-center justify-between">
                <span className="text-sm font-bold uppercase tracking-wider">
                  Niveau {lv.level}
                </span>
                <span className="text-xs text-white/85">
                  {lv.filles.length} fille{lv.filles.length > 1 ? "s" : ""} ·{" "}
                  {lv.garcons.length} garçon{lv.garcons.length > 1 ? "s" : ""}
                </span>
              </div>
              <CardContent className="pt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <PalmaresGenderTable
                  title={`Les 10 meilleures filles — ${lv.level}`}
                  bandClass="bg-[#BE185D]"
                  entries={lv.filles}
                />
                <PalmaresGenderTable
                  title={`Les 10 meilleurs garçons — ${lv.level}`}
                  bandClass="bg-[#1D4ED8]"
                  entries={lv.garcons}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
