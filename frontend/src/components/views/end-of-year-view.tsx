"use client";

// === Onglet « Fin d'année » du module Résultats ===
// Document officiel « RESULTATS DE FIN D'ANNEE » (modèle IEPP) :
//   - sélection École → Classe (Cours) → Année de référence ;
//   - saisie des compteurs MANUELS du tableau récapitulatif :
//     Exclus et Abandons (listes 1..15, colonnes Garçons / Filles —
//     Total = G+F calculé) — Admis et Redoublants sont CALCULÉS
//     automatiquement depuis la décision du conseil des maîtres
//     (A / R / ABD) saisie dans le dossier de chaque élève ;
//   - aperçu du tableau par élève : âge (déduit de l'année de naissance),
//     scolarités (1..10), moyenne des compositions, moyenne de la
//     composition de passage, moyenne annuelle = (MC + 2 × MCP)/3, décision ;
//   - bouton « Document officiel » → /resultats-fin-annee-doc (A4 portrait,
//     impression 100 % navigateur — discipline du projet : zéro PDF serveur).

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import {
  CalendarDays,
  FileText,
  Loader2,
  School as SchoolIcon,
  UserRound,
} from "lucide-react";

import { classesApi, reportsApi, schoolsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { SchoolWithStats } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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

const YEARS = [2024, 2025, 2026, 2027, 2028];

/** Moyenne au format du document : virgule française, 2 décimales. */
function fmtMoy(v: number | null | undefined, has: boolean | undefined): string {
  if (!has || v == null) return "—";
  return v.toFixed(2).replace(".", ",");
}

/** Compteur manuel : valeur Select ("" = non saisi → NULL). */
function counterValue(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}

/** Options 1..N partagées des compteurs (Exclus / Abandons : 1..15). */
function CounterSelect({
  id,
  value,
  onChange,
  label,
  max,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  max: number;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5 min-w-0">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent className="max-h-56">
          <SelectGroup>
            <SelectLabel>{label} (1 → {max})</SelectLabel>
            {Array.from({ length: max }, (_, k) => (
              <SelectItem key={k + 1} value={String(k + 1)}>
                {k + 1}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

export function EndOfYearView() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";
  const isInspector = user?.role === "inspector";
  const isDirector = user?.role === "director";
  const isTeacher = user?.role === "teacher";
  // Écriture des compteurs de classe = mêmes droits que le module Classes.
  const canEdit = isAdmin || isDirector || isInspector;

  const needsSchoolSelect = isAdmin || isInspector;
  const [schoolFilter, setSchoolFilter] = useState<string>(
    isDirector || isTeacher ? (user?.school_id ?? "") : "",
  );
  const [classId, setClassId] = useState<string>("");
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));

  const hasSchoolSelected = schoolFilter !== "" && schoolFilter !== "all";

  const { data: schoolsData } = useQuery({
    queryKey: ["schools", "end-of-year"],
    queryFn: () => schoolsApi.list(),
    enabled: needsSchoolSelect || isDirector,
  });
  // Nom de l'école du directeur (affiché en champ figé)
  const directorSchoolName = isDirector
    ? (schoolsData?.schools ?? []).find((s) => s.id === user?.school_id)?.name ??
      "Mon école"
    : "";

  const { data: classesData, isLoading: classesLoading } = useQuery({
    queryKey: ["classes", "end-of-year", schoolFilter],
    queryFn: () => classesApi.list({ schoolId: schoolFilter || undefined }),
    // teacher : pas de filtre école — le backend renvoie sa classe (RBAC).
    enabled: hasSchoolSelected || isTeacher,
  });
  const classes = classesData?.classes ?? [];
  const selectedClass = classes.find((c) => c.id === classId);
  // École effective pour l'API (teacher sans school_id → celle de sa classe).
  const effectiveSchoolId = schoolFilter || selectedClass?.school_id || "";

  const { data: sheet, isLoading: sheetLoading, error: sheetError } = useQuery({
    queryKey: ["end-of-year", effectiveSchoolId, classId, year],
    queryFn: () =>
      reportsApi.endOfYearSheet(effectiveSchoolId, classId, parseInt(year, 10)),
    enabled: !!effectiveSchoolId && !!classId,
  });

  const queryClient = useQueryClient();
  // Compteurs manuels (Exclus / Abandons) — un champ à la fois, l'API
  // traite chaque compteur indépendamment (absent = inchangé).
  const counterMut = useMutation({
    mutationFn: ({
      field,
      value,
    }: {
      field:
        | "exclus_garcons"
        | "exclus_filles"
        | "abandons_garcons"
        | "abandons_filles";
      value: number;
    }) => classesApi.update(classId, { [field]: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["end-of-year"] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
    },
  });

  function openDocument() {
    if (!effectiveSchoolId || !classId) return;
    let token = "";
    try {
      const raw = localStorage.getItem("sygren-auth");
      if (raw) token = JSON.parse(raw)?.state?.token ?? "";
    } catch {
      /* token absent — l'API refusera, la page l'affichera */
    }
    const url = `${window.location.origin}/resultats-fin-annee-doc?school=${encodeURIComponent(effectiveSchoolId)}&class=${encodeURIComponent(classId)}&year=${encodeURIComponent(year)}&t=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
  }

  // Bulletins individuels « RESULTATS DE FIN D'ANNEE » (modèle du module
  // « bulletins ») : feuille A4 paysage reconvertie en 2 demi-pages B5 —
  // 2 ÉLÈVES DIFFÉRENTS par feuille (ordre de mérite), trait discontinu
  // de découpe, drapeau ivoirien ; moyennes, rang/effectif, décision
  // OUI/NON entourée, Fait à… le [date du jour], signatures Maître +
  // Directeur.
  function openBulletins() {
    if (!effectiveSchoolId || !classId) return;
    let token = "";
    try {
      const raw = localStorage.getItem("sygren-auth");
      if (raw) token = JSON.parse(raw)?.state?.token ?? "";
    } catch {
      /* token absent — l'API refusera, la page l'affichera */
    }
    const url = `${window.location.origin}/bulletin-fin-annee?school=${encodeURIComponent(effectiveSchoolId)}&class=${encodeURIComponent(classId)}&year=${encodeURIComponent(year)}&t=${encodeURIComponent(token)}`;
    window.open(url, "_blank");
  }

  return (
    <div className="space-y-4">
      {/* === Sélections === */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="w-4 h-4 text-primary" />
            Résultats de fin d&apos;année
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            {needsSchoolSelect && (
              <div className="space-y-1.5 min-w-[200px] flex-1 max-w-[300px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <SchoolIcon className="w-3 h-3" /> École
                </label>
                <Select
                  value={schoolFilter}
                  onValueChange={(v) => {
                    setSchoolFilter(v);
                    setClassId(""); // reset classe quand école change
                  }}
                >
                  <SelectTrigger className="w-full overflow-hidden">
                    <SelectValue placeholder="Choisir une école…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(schoolsData?.schools ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {(s as SchoolWithStats).name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isDirector && (
              <div className="space-y-1.5 min-w-[200px] flex-1 max-w-[300px] min-w-0">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <SchoolIcon className="w-3 h-3" /> École
                </label>
                <Input
                  value={directorSchoolName}
                  disabled
                  readOnly
                  className="bg-muted/50 text-muted-foreground"
                />
              </div>
            )}
            <div className="space-y-1.5 min-w-[150px] flex-1 max-w-[220px] min-w-0">
              <label className="text-xs font-medium text-muted-foreground">
                Cours (classe)
              </label>
              <Select
                value={classId}
                onValueChange={setClassId}
                disabled={!hasSchoolSelected || classesLoading || classes.length === 0}
              >
                <SelectTrigger className="w-full overflow-hidden">
                  <SelectValue
                    placeholder={
                      hasSchoolSelected ? "Choisir un cours…" : "Choisir une école d'abord"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {classes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 min-w-[110px] max-w-[140px]">
              <label className="text-xs font-medium text-muted-foreground">
                Année
              </label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={openDocument}
              disabled={!effectiveSchoolId || !classId}
              className="shadow-sm"
            >
              <FileText className="w-4 h-4 mr-1.5" />
              Document officiel
            </Button>
            <Button
              onClick={openBulletins}
              disabled={!effectiveSchoolId || !classId}
              variant="outline"
              className="shadow-sm"
            >
              <UserRound className="w-4 h-4 mr-1.5" />
              Bulletins individuels
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Moyenne annuelle = (moyenne des compositions + 2 × moyenne de la
            composition de passage) ÷ 3 — la composition de passage (créée
            dans Évaluations → Sessions) compte double.
          </p>
        </CardContent>
      </Card>

      {/* === Saisies du conseil des maîtres (compteurs manuels) === */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">
            Tableau récapitulatif — saisies du conseil des maîtres
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <CounterSelect
              id="eoy-exclus-g"
              label="Exclus — Garçons"
              max={15}
              value={counterValue(selectedClass?.exclus_garcons)}
              disabled={!canEdit || !classId}
              onChange={(v) =>
                counterMut.mutate({ field: "exclus_garcons", value: parseInt(v, 10) })
              }
            />
            <CounterSelect
              id="eoy-exclus-f"
              label="Exclus — Filles"
              max={15}
              value={counterValue(selectedClass?.exclus_filles)}
              disabled={!canEdit || !classId}
              onChange={(v) =>
                counterMut.mutate({ field: "exclus_filles", value: parseInt(v, 10) })
              }
            />
            <CounterSelect
              id="eoy-abandons-g"
              label="Abandons — Garçons"
              max={15}
              value={counterValue(selectedClass?.abandons_garcons)}
              disabled={!canEdit || !classId}
              onChange={(v) =>
                counterMut.mutate({ field: "abandons_garcons", value: parseInt(v, 10) })
              }
            />
            <CounterSelect
              id="eoy-abandons-f"
              label="Abandons — Filles"
              max={15}
              value={counterValue(selectedClass?.abandons_filles)}
              disabled={!canEdit || !classId}
              onChange={(v) =>
                counterMut.mutate({ field: "abandons_filles", value: parseInt(v, 10) })
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Effectif, Admis (décision « A ») et Redoublants (décision « R »)
            sont calculés automatiquement depuis la décision saisie dans le
            dossier de chaque élève — ils se répercutent seuls sur le tableau.
          </p>
        </CardContent>
      </Card>

      {/* === Aperçu du tableau par élève === */}
      {!effectiveSchoolId || !classId ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-12 text-center">
            <p className="text-sm font-medium">
              Sélectionnez une école puis un cours pour afficher les résultats
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Les moyennes proviennent des compositions mensuelles et de la
              composition de passage (module Évaluations).
            </p>
          </CardContent>
        </Card>
      ) : sheetLoading ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm">Calcul des moyennes…</p>
          </CardContent>
        </Card>
      ) : sheetError || !sheet ? (
        <Card className="border-destructive/40">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-destructive font-medium">
              Impossible de calculer les résultats de fin d&apos;année
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {(sheetError as Error)?.message}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-border/60">
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-96 overflow-y-auto scroll-sygren">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="w-10">N°</TableHead>
                      <TableHead>Nom et Prénoms</TableHead>
                      <TableHead>Âge</TableHead>
                      <TableHead>Scol. cours</TableHead>
                      <TableHead>Scol. totale</TableHead>
                      <TableHead>Moy. compositions</TableHead>
                      <TableHead>Moy. passage</TableHead>
                      <TableHead>Moy. annuelle</TableHead>
                      <TableHead>Décision</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sheet.rows.map((r, i) => (
                      <TableRow key={r.student_id} className="hover:bg-muted/40">
                        <TableCell className="tabular-nums text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "font-medium",
                            // Noms des FILLES en rouge (comme le document).
                            r.gender === "F" && "text-red-600 dark:text-red-400",
                          )}
                        >
                          {r.full_name}
                        </TableCell>
                        <TableCell className="tabular-nums">{r.age ?? "—"}</TableCell>
                        <TableCell className="tabular-nums">
                          {r.scolarite_cours ?? "—"}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {r.scolarite_totale ?? "—"}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {fmtMoy(r.moyenne_compositions, r.has_moyenne_compositions)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {fmtMoy(r.moyenne_passage, r.has_moyenne_passage)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "tabular-nums font-semibold",
                            r.has_moyenne_annuelle && "text-primary",
                          )}
                        >
                          {fmtMoy(r.moyenne_annuelle, r.has_moyenne_annuelle)}
                        </TableCell>
                        <TableCell>
                          {r.decision_conseil ? (
                            <Badge
                              variant="outline"
                              className={
                                r.decision_conseil === "A"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : r.decision_conseil === "R"
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : "border-rose-200 bg-rose-50 text-rose-700"
                              }
                            >
                              {r.decision_conseil}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {sheet.rows.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={9}
                          className="text-center text-muted-foreground py-8"
                        >
                          Aucun élève inscrit dans ce cours.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Petit tableau récapitulatif (aperçu du bas du document) */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">
                Récapitulatif — {sheet.class.name} · Année {sheet.year}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table className="max-w-md">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">&nbsp;</TableHead>
                      <TableHead className="text-center">Garçons</TableHead>
                      <TableHead className="text-center">Filles</TableHead>
                      <TableHead className="text-center">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(
                      [
                        ["Effectif", sheet.summary.effectif],
                        ["Admis", sheet.summary.admis],
                        ["Redoublants", sheet.summary.redoublants],
                        ["Exclus", sheet.summary.exclus],
                        ["Abandons", sheet.summary.abandons],
                      ] as const
                    ).map(([label, row]) => (
                      <TableRow key={label}>
                        <TableCell className="font-medium">{label}</TableCell>
                        <TableCell className="text-center tabular-nums">
                          {row.garcons ?? ""}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {row.filles ?? ""}
                        </TableCell>
                        <TableCell className="text-center tabular-nums font-semibold">
                          {row.total ?? ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
