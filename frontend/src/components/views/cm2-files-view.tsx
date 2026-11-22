"use client";

// === Vue « Fichiers CM2 » — module Résultats (Task 84) ===
//
// Demande (Task 83) : « les fichiers concernent uniquement les élèves de
// CM2 ; ces fichiers doivent être dans le module Résultats ».
// Précision (Task 84) : « le fichier CM2 du module résultat n'est pas
// différent de celui de l'évaluation — ils ont les mêmes caractéristiques
// mais dans le fichier CM2 du module résultat, les notes ne sont pas
// saisies : les notes du module évaluations sont générées directement dans
// le module résultat ».
//
// Fonctionnement :
//   - LECTURE SEULE : aucune saisie ici — les notes (exploitation, eveil,
//     orthographe, math) sont saisies par les écoles dans le MODULE
//     ÉVALUATIONS (compositions) et apparaissent ici AUTOMATIQUEMENT ;
//   - Le sélecteur liste les ROUNDS de composition (année, N°) détectés
//     dans les sessions d'évaluation réelles — « N°1 — 2026 » agrège toutes
//     les écoles, quel que soit leur mois de composition (sept./oct./nov.) ;
//   - Total = Σ notes (dès 1 note) et C1 = Σ / 8,5 (dès les 4 notes —
//     barèmes CM réels 2–50 / 2–20 : 170/20 = 8,5, soit la moyenne /20)
//     calculés par le serveur, rafraîchis en continu ;
//   - Périmètre par rôle : admin/inspector = tout, conseiller = son
//     secteur, director = son école, teacher = ses classes CM2 ;
//   - Table écran : entête EXACTEMENT celle de la demande (13 colonnes,
//     mêmes libellés et même ordre que l'export Excel) — matricule, nom,
//     prenoms, libecole, codeecole, libiep, iep, exploitation, eveil,
//     orthographe, math, Total, C1 ; iep = 000045, libiep = DABOU 1 ;
//   - Export Excel PAR SECTEUR (Super Admin) — les 13 colonnes exactes de
//     la demande (lib/cm2-export.ts), notes péremplies + formules.

import { memo, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Database,
  FileDown,
  FileSpreadsheet,
  Loader2,
  School,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { cm2Api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import {
  cm2SecteurFileBase,
  CM2_IEP_CODE,
  CM2_IEP_LIB,
  exportCm2SecteurExcel,
} from "@/lib/cm2-export";
import type { Cm2StudentRow, Cm2SubjectInfo } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const NOTE_KEYS = ["exploitation", "eveil", "orthographe", "math"] as const;

const fmt = (n: number | null | undefined) =>
  n == null
    ? "—"
    : Number.isInteger(n)
      ? String(n)
      : String(Math.round(n * 100) / 100);

export function Cm2FilesView() {
  const user = useAuthStore((s) => s.user);
  // Export fichiers = Super Admin — déduit du RÔLE (pas de la réponse du
  // fichier) : le bouton doit être visible AVANT le premier chargement.
  const canExport = user?.role === "admin";
  const [roundKey, setRoundKey] = useState<string>(""); // « année-N° »
  const [secteurFilter, setSecteurFilter] = useState<string>("all");
  const [exporting, setExporting] = useState(false);

  // Rounds de composition détectés dans le module Évaluations — les
  // comptes « noté(s) » suivent les saisies des écoles en continu.
  const { data: roundsData, isLoading: roundsLoading } = useQuery({
    queryKey: ["cm2", "rounds"],
    queryFn: () => cm2Api.listRounds(),
    refetchInterval: 60_000,
  });
  const rounds = roundsData?.rounds ?? [];

  // Round par défaut : la composition la plus récente AVEC notes, sinon la
  // plus récente tout court (rounds triés année DESC, N° DESC par l'API).
  useEffect(() => {
    if (roundKey || rounds.length === 0) return;
    const best = rounds.find((r) => r.notated > 0) ?? rounds[0];
    setRoundKey(`${best.year}-${best.number}`);
  }, [rounds, roundKey]);

  const [year, number] = useMemo(() => {
    const m = roundKey.match(/^(\d+)-(\d+)$/);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [undefined, undefined];
  }, [roundKey]);

  const {
    data: file,
    isLoading: fileLoading,
    error: fileError,
  } = useQuery({
    queryKey: ["cm2", "file", year, number],
    queryFn: () => cm2Api.getFile(year!, number!),
    enabled: year !== undefined && number !== undefined,
    refetchInterval: 120_000, // notes générées en direct depuis les évaluations
  });

  const subjects = file?.subjects ?? [];
  const notated =
    rounds.find((r) => r.year === year && r.number === number)?.notated ?? 0;

  // === Export Excel par secteur ===
  const selectedSectorName =
    secteurFilter === "all" ? null : secteurFilter === "hors" ? "HORS SECTEUR" : secteurFilter;
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
        { round: file.round, secteurName: group.secteur_name, schools: group.schools },
        `${cm2SecteurFileBase(file.round, group.secteur_name)}.xlsx`,
      );
      toast.success(
        `Fichier Excel « ${group.secteur_name} » généré (${group.schools.length} école(s))`,
      );
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

  const noRounds = !roundsLoading && rounds.length === 0;

  return (
    <div className="space-y-4">
      {/* === En-tête : titre + sélecteurs === */}
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
                  {noRounds
                    ? "Aucune composition d'évaluation — les fichiers apparaissent dès que les écoles ouvrent leurs compositions dans le module Évaluations"
                    : !file
                      ? "Choisissez une composition pour consulter le fichier"
                      : "Notes générées automatiquement depuis le module Évaluations — aucune saisie ici"}
                </p>
              </div>
            </div>
            {file && (
              <Badge
                variant="outline"
                className="text-xs gap-1 text-emerald-600 border-emerald-300"
              >
                <Database className="w-3 h-3" />
                Source : module Évaluations
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {/* Composition (round du module Évaluations) */}
            <div className="space-y-1.5 flex-1 max-w-[340px] min-w-[220px] min-w-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Database className="w-3 h-3" /> Composition (module Évaluations)
              </label>
              <Select
                value={roundKey}
                onValueChange={(v) => {
                  setRoundKey(v);
                  setSecteurFilter("all");
                }}
                disabled={roundsLoading || rounds.length === 0}
              >
                <SelectTrigger className="w-full overflow-hidden">
                  <SelectValue
                    placeholder={
                      rounds.length === 0 ? "Aucune composition" : "Choisir une composition…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {rounds.map((r) => (
                    <SelectItem key={`${r.year}-${r.number}`} value={`${r.year}-${r.number}`}>
                      N°{r.number} — {r.year}
                      {r.notated > 0 ? ` (${r.notated} noté(s))` : " (aucune note)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filtre secteur */}
            <div className="space-y-1.5 flex-1 max-w-[280px] min-w-[200px] min-w-0">
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

          {/* Barème + formule + compteur */}
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
                soit la moyenne sur /20 dès que les 4 notes sont présentes
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" />
                {totalVisible} élève(s) CM2 affiché(s)
              </span>
              {notated === 0 && (
                <span className="text-amber-600 font-medium">
                  Aucune note dans le module Évaluations pour cette composition
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* === Contenu === */}
      {roundsLoading || (roundKey && fileLoading && !file) ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm">Chargement…</p>
          </CardContent>
        </Card>
      ) : noRounds ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Database className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              Aucune composition disponible — ouvrez le module Évaluations et
              saisissez les notes d&apos;une composition pour voir le fichier CM2
              se remplir automatiquement.
            </p>
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
      ) : !file ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Sélectionnez une composition dans la liste</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {visibleGroups.map((g) => (
            <SectorCard key={g.secteur_id ?? "hors"} group={g} subjects={subjects} />
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
    </div>
  );
}

// === Carte d'un secteur : bandeau + écoles + lignes élèves (lecture seule) ===
interface SectorCardProps {
  group: { secteur_id: string | null; secteur_name: string; schools: {
    school_id: string; school_name: string; school_code: string; students: Cm2StudentRow[];
  }[] };
  subjects: Cm2SubjectInfo[];
}

function SectorCard({ group, subjects }: SectorCardProps) {
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
                      {/* Entête = les 13 libellés EXACTS de la demande, dans
                          l'ordre demandé (identique à l'export Excel) */}
                      <TableHead className="h-8 w-[110px]">matricule</TableHead>
                      <TableHead className="h-8 min-w-[130px]">nom</TableHead>
                      <TableHead className="h-8 min-w-[130px]">prenoms</TableHead>
                      <TableHead className="h-8 min-w-[150px]">libecole</TableHead>
                      <TableHead className="h-8 text-center w-[80px]">codeecole</TableHead>
                      <TableHead className="h-8 text-center w-[90px]">libiep</TableHead>
                      <TableHead className="h-8 text-center w-[80px]">iep</TableHead>
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
                      <Cm2Row key={row.student_id} row={row} />
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

// === Ligne élève (mémoïsée — lecture seule, notes du module Évaluations).
// Les 13 colonnes de la demande : identité + libecole/codeecole (école de
// l'élève), libiep/iep (constantes 000045 / DABOU 1), 4 notes, Total, C1 ===
const Cm2Row = memo(function Cm2Row({ row }: { row: Cm2StudentRow }) {
  return (
    <TableRow>
      <TableCell className="py-1.5 font-mono text-xs text-muted-foreground">
        {row.matricule ?? "—"}
      </TableCell>
      <TableCell className="py-1.5 font-medium text-sm">{row.nom}</TableCell>
      <TableCell className="py-1.5 text-sm">{row.prenoms}</TableCell>
      <TableCell className="py-1.5 text-sm">{row.school_name}</TableCell>
      <TableCell className="py-1.5 text-center font-mono text-xs">
        {row.school_code}
      </TableCell>
      <TableCell className="py-1.5 text-center text-sm">{CM2_IEP_LIB}</TableCell>
      <TableCell className="py-1.5 text-center font-mono text-xs">
        {CM2_IEP_CODE}
      </TableCell>
      {NOTE_KEYS.map((k) => (
        <TableCell key={k} className="py-1.5 text-center text-sm font-medium">
          {fmt(row[`note_${k}` as keyof Cm2StudentRow] as number | null)}
        </TableCell>
      ))}
      <TableCell className="py-1.5 text-center font-semibold text-sm">
        {fmt(row.total)}
      </TableCell>
      <TableCell className="py-1.5 text-center font-bold text-sm">
        {row.c1 != null ? (
          <span className={cn(row.c1 >= 10 ? "text-emerald-600" : "text-amber-600")}>
            {row.c1.toFixed(2)}
          </span>
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );
});
