"use client";

// === PDA IEPP — Suivi pluriannuel (matrice élève × évaluations) ===
// 3e onglet du module Résultats. Cœur de l'objectif « pluriannuel » :
// pour une classe CE/CM et une année, la matrice affiche le niveau d'étude
// de CHAQUE élève dans les 3 matières désignées (Exploitation de texte,
// Mathématiques, Dictée) à CHAQUE évaluation du plan — compositions
// mensuelles (notes dérivées du module Notes) ET examens blancs (saisie
// manuelle). Agrégats calculés côté serveur (/api/pda/timeline).
// Impression A4 paysage 100 % navigateur :
//   - « Imprimer / PDF » : matrice à l'écran (isolement #pda-timeline)
//   - « Document officiel » : page dédiée /pda-timeline-doc (en-tête
//     ministériel — pattern /synthese, isolement #pda-tl-doc)

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarRange,
  FileText,
  Loader2,
  Printer,
  Table2,
  TriangleAlert,
} from "lucide-react";

import { classesApi, pdaApi, schoolsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { PdaTimelineCell } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

/** Une cellule évaluation d'un élève : ✓ admis / ✕ non admis / – non noté / abs. */
function TimelineCellView({ cell }: { cell?: PdaTimelineCell }) {
  if (!cell || !cell.present) {
    return <span className="text-[10px] text-muted-foreground/70">abs</span>;
  }
  return (
    <div className="flex items-center justify-center gap-1.5 tabular-nums">
      {[0, 1, 2].map((i) => {
        const note = cell.notes[i];
        if (note == null) {
          return (
            <span key={i} className="text-[11px] text-muted-foreground/60">
              –
            </span>
          );
        }
        return cell.admis[i] ? (
          <span
            key={i}
            className="text-[11px] font-bold text-emerald-700"
            title={`${note} — Admis`}
          >
            ✓
          </span>
        ) : (
          <span
            key={i}
            className="text-[11px] font-bold text-red-600"
            title={`${note} — Non admis`}
          >
            ✕
          </span>
        );
      })}
    </div>
  );
}

export function PdaTimelineView() {
  const user = useAuthStore((s) => s.user);
  const needsSchoolSelect = user?.role === "admin" || user?.role === "inspector";
  const [schoolFilter, setSchoolFilter] = useState<string>(
    needsSchoolSelect ? "" : (user?.school_id ?? ""),
  );
  const [classId, setClassId] = useState<string>("");
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));

  const hasSchool = schoolFilter !== "" && schoolFilter !== "all";
  const yearNum = Number(year);

  // Écoles (admin/inspector seulement — cascade stricte)
  const { data: schoolsData } = useQuery({
    queryKey: ["schools", "pda-timeline-filter"],
    queryFn: () => schoolsApi.list(),
    enabled: needsSchoolSelect,
  });

  // Classes CE/CM de l'école (le plan d'action exclut le CP)
  const { data: classesData } = useQuery({
    queryKey: ["classes", "pda-timeline", schoolFilter],
    queryFn: () =>
      classesApi.list(hasSchool ? { schoolId: schoolFilter } : undefined),
    enabled: hasSchool,
  });
  const ceCmClasses = useMemo(
    () =>
      (classesData?.classes ?? []).filter(
        (c) => c.active && (c.level === "CE" || c.level === "CM"),
      ),
    [classesData],
  );

  // Matrice pluriannuelle (serveur = source unique de vérité)
  const { data, isLoading } = useQuery({
    queryKey: ["pda-timeline", classId, yearNum],
    queryFn: () => pdaApi.getTimeline(classId, yearNum),
    enabled: !!classId && Number.isFinite(yearNum) && yearNum >= 2000 && yearNum <= 2100,
  });

  const evaluations = data?.evaluations ?? [];
  const students = data?.students ?? [];
  const subjects = data?.subjects ?? [];

  return (
    <div className="space-y-4">
      {/* === Barre de cascade === */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-primary" />
            Suivi pluriannuel des niveaux
            <span className="text-xs font-normal text-muted-foreground">
              Élève × évaluations — compositions mensuelles &amp; examens blancs
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-end gap-3">
            {needsSchoolSelect ? (
              <div className="space-y-1.5 w-full sm:w-auto sm:flex-1 sm:max-w-[280px]">
                <Label className="text-xs text-muted-foreground">École</Label>
                <Select
                  value={schoolFilter}
                  onValueChange={(v) => {
                    setSchoolFilter(v);
                    setClassId("");
                  }}
                >
                  <SelectTrigger className="w-full overflow-hidden">
                    <SelectValue placeholder="Choisir une école…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(schoolsData?.schools ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5 w-full sm:w-auto sm:flex-1 sm:max-w-[240px]">
              <Label className="text-xs text-muted-foreground">Classe (CE / CM)</Label>
              <Select
                value={classId}
                onValueChange={setClassId}
                disabled={!hasSchool || ceCmClasses.length === 0}
              >
                <SelectTrigger className="w-full overflow-hidden">
                  <SelectValue
                    placeholder={
                      !hasSchool
                        ? "Choisir une école d'abord"
                        : ceCmClasses.length === 0
                          ? "Aucune classe CE/CM"
                          : "Choisir une classe…"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {ceCmClasses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 w-full sm:w-auto sm:max-w-[140px]">
              <Label className="text-xs text-muted-foreground">Année scolaire</Label>
              <Input
                value={year}
                inputMode="numeric"
                onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                placeholder={String(new Date().getFullYear())}
                aria-label="Année scolaire"
              />
            </div>

            <div className="flex items-center gap-2 sm:ml-auto">
              <Button
                size="sm"
                variant="outline"
                disabled={!data || evaluations.length === 0}
                onClick={() =>
                  window.open(
                    `/pda-timeline-doc?class_id=${encodeURIComponent(classId)}&year=${yearNum}`,
                    "_blank",
                  )
                }
              >
                <FileText className="w-4 h-4 mr-1.5" />
                Document officiel
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!data || evaluations.length === 0}
                onClick={() => window.print()}
              >
                <Printer className="w-4 h-4 mr-1.5" />
                Imprimer / PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === Matrice === */}
      {!classId || !Number.isFinite(yearNum) ? (
        <Card className="border-dashed border-primary/30 bg-primary/5">
          <CardContent className="py-12 text-center">
            <Table2 className="w-8 h-8 mx-auto mb-3 text-primary/50" />
            <p className="text-sm font-medium">
              Sélectionnez une classe CE/CM et une année
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              La matrice pluriannuelle affichera le niveau de chaque élève dans
              les 3 matières désignées, évaluation après évaluation.
            </p>
          </CardContent>
        </Card>
      ) : isLoading || !data ? (
        <Card>
          <CardContent className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Chargement de la matrice…
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60 overflow-hidden" id="pda-timeline">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">
              Classe {data.class.name} — année {data.year} ·{" "}
              {evaluations.length} évaluation(s) · {students.length} élève(s)
            </CardTitle>
            {/* Légende + barèmes (masquée à l'impression, la version imprimée
                porte sa propre légende compacte) */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground print:hidden">
              <span>
                <span className="font-bold text-emerald-700">✓</span> Admis ·{" "}
                <span className="font-bold text-red-600">✕</span> Non admis ·{" "}
                <span>–</span> non noté · <span>abs</span> absent
              </span>
              <span>
                Colonnes : <span className="font-medium">C1, C2…</span> =
                compositions mensuelles · <span className="font-medium">EB1, EB2…</span>{" "}
                = examens blancs
              </span>
              <span>
                Matières (E/M/D) :{" "}
                {subjects.map((s, i) => (
                  <span key={s.key}>
                    {i > 0 && " · "}
                    {s.label}{" "}
                    {s.matched
                      ? `(/${s.max_composition} compositions, /${s.max_blanc} blancs)`
                      : "(non notée)"}
                  </span>
                ))}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0 space-y-0">
            {/* Avertissements (matières non notées / compositions sans notes) */}
            {data.warnings.length > 0 && (
              <div className="px-4 pt-3 print:hidden">
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
                  {data.warnings.map((w, i) => (
                    <p key={i} className="flex items-start gap-2">
                      <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}

            {evaluations.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm font-medium">
                  Aucune évaluation dans le plan d&apos;action pour cette année
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Ajoutez des compositions mensuelles ou des examens blancs
                  dans l&apos;onglet « Plan d&apos;action IEPP ».
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto scroll-sygren">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[36px]">#</TableHead>
                      <TableHead className="min-w-[150px]">Élève</TableHead>
                      {evaluations.map((e) => (
                        <TableHead
                          key={e.id}
                          className="text-center w-[64px]"
                          title={`${e.label} — seuil ${e.threshold} % du barème`}
                        >
                          <span
                            className={
                              e.kind === "composition"
                                ? "text-orange-700"
                                : "text-primary"
                            }
                          >
                            {e.short_label}
                          </span>
                        </TableHead>
                      ))}
                      <TableHead className="text-center w-[70px]">
                        % Admis
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((st, idx) => (
                      <TableRow key={st.student_id}>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {idx + 1}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm font-medium whitespace-nowrap">
                            {st.last_name} {st.first_name}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {st.matricule} · {st.gender === "F" ? "Fille" : "Garçon"}
                          </div>
                        </TableCell>
                        {evaluations.map((e) => (
                          <TableCell key={e.id} className="text-center py-1.5">
                            <TimelineCellView cell={st.cells[e.id]} />
                          </TableCell>
                        ))}
                        <TableCell className="text-center tabular-nums text-sm font-medium">
                          {st.pct_admis > 0 ? `${st.pct_admis} %` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {students.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={evaluations.length + 3}
                          className="py-8 text-center text-sm text-muted-foreground"
                        >
                          Aucun élève dans cette classe.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pied de document imprimé : légende compacte + signatures */}
            {evaluations.length > 0 && (
              <div className="hidden print:block px-4 pb-3 pt-1 text-[9px] text-gray-700">
                <p>
                  ✓ Admis (note ≥ seuil) · ✕ Non admis · – note absente · abs
                  absent — Matières (E/M/D) :{" "}
                  {subjects.map((s, i) => (
                    <span key={s.key}>
                      {i > 0 && " · "}
                      <span className="font-semibold">{s.label}</span> (
                      {s.matched
                        ? `compositions /${s.max_composition}, blancs /${s.max_blanc}`
                        : "non notée dans les compositions"}
                      )
                    </span>
                  ))}
                </p>
                <p className="mt-1">
                  E = Exploitation de texte · M = Mathématiques · D = Dictée —
                  C = composition mensuelle · EB = examen blanc. Seuil de
                  maîtrise : % du barème de chaque évaluation.
                </p>
                <div className="flex justify-between mt-5 font-semibold underline">
                  <span>Le Directeur</span>
                  <span>L&apos;Inspecteur</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Badge d'aide en bas de page (masqué à l'impression) */}
      {data && evaluations.length > 0 && (
        <p className="text-center text-[11px] text-muted-foreground print:hidden">
          Le pourcentage d&apos;admission (3 matières réunies) est calculé sur
          toutes les évaluations du plan de l&apos;année — le niveau d&apos;étude de
          chaque élève se lit colonne par colonne.
        </p>
      )}
    </div>
  );
}
