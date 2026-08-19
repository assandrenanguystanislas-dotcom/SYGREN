"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge, Plus, Trash2, Loader2, BookOpen } from "lucide-react";
import { toast } from "sonner";

import { gradeScalesApi, subjectsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import type { GradeScaleWithSubject, Subject } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/confirm-dialog";

const LEVELS = ["CP", "CE", "CM"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_COLORS: Record<Level, string> = {
  CP: "border-blue-200 bg-blue-50 text-blue-700",
  CE: "border-amber-200 bg-amber-50 text-amber-700",
  CM: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export function GradeScalesView() {
  const user = useAuthStore((s) => s.user);
  const canEdit = user?.role === "admin" || user?.role === "director";
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["grade-scales"],
    queryFn: () => gradeScalesApi.list(),
  });
  const { data: subjectsData } = useQuery({
    queryKey: ["subjects"],
    queryFn: () => subjectsApi.list(),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    level: "CP" as Level,
    subject_id: "__default__",
    max_score: "10",
  });
  const [deleteTarget, setDeleteTarget] = useState<GradeScaleWithSubject | null>(null);

  const scales = data?.grade_scales ?? [];
  const subjects = subjectsData?.subjects ?? [];

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const maxScore = parseInt(form.max_score, 10);
    if (isNaN(maxScore) || maxScore <= 0) {
      toast.error("Max score invalide");
      return;
    }
    try {
      await gradeScalesApi.create({
        level: form.level,
        subject_id: form.subject_id === "__default__" ? null : form.subject_id,
        max_score: maxScore,
      });
      toast.success("Barème créé");
      await queryClient.invalidateQueries({ queryKey: ["grade-scales"] });
      setDialogOpen(false);
      setForm({ level: "CP", subject_id: "__default__", max_score: "10" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur";
      toast.error("Création échouée", { description: msg });
    }
  }

  async function onUpdateMaxScore(gs: GradeScaleWithSubject, newMax: string) {
    const maxScore = parseInt(newMax, 10);
    if (isNaN(maxScore) || maxScore <= 0) return;
    try {
      await gradeScalesApi.update(gs.id, { max_score: maxScore });
      toast.success("Barème modifié", {
        description: `${gs.level} · ${gs.subject_name ?? "Toutes matières"} → /${maxScore}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["grade-scales"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur";
      toast.error("Modification échouée", { description: msg });
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    try {
      await gradeScalesApi.delete(deleteTarget.id);
      toast.success("Barème supprimé");
      await queryClient.invalidateQueries({ queryKey: ["grade-scales"] });
      setDeleteTarget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur";
      toast.error("Suppression échouée", { description: msg });
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm">Chargement des barèmes…</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-destructive font-medium">
            Impossible de charger les barèmes
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {(error as Error).message}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Grouper par niveau
  const byLevel: Record<Level, GradeScaleWithSubject[]> = {
    CP: [],
    CE: [],
    CM: [],
  };
  for (const s of scales) {
    if (s.level in byLevel) {
      byLevel[s.level as Level].push(s);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Gauge className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-base">Barèmes de notation</h2>
              <p className="text-xs text-muted-foreground">
                {scales.length} barème(s) · CP /10 · CE /30 (Dictée /20) · CM /50 (Dictée /20)
              </p>
            </div>
          </div>
          {canEdit && (
            <Button onClick={() => setDialogOpen(true)} size="sm" className="shadow-sm">
              <Plus className="w-4 h-4 mr-1.5" />
              Nouveau barème
            </Button>
          )}
        </CardContent>
      </Card>

      {LEVELS.map((level) => (
        <Card key={level} className="border-border/60">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className={`text-xs font-mono ${LEVEL_COLORS[level]}`}>
                Niveau {level}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {byLevel[level].length} règle(s)
              </span>
            </div>
            {byLevel[level].length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-4">
                Aucun barème pour ce niveau.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Matière</TableHead>
                    <TableHead className="w-32">Barème</TableHead>
                    {canEdit && <TableHead className="w-16 text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byLevel[level].map((gs) => (
                    <TableRow key={gs.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {gs.subject_name ? (
                            <>
                              <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="font-medium">{gs.subject_name}</span>
                              <Badge variant="secondary" className="text-[9px]">
                                Exception
                              </Badge>
                            </>
                          ) : (
                            <span className="text-muted-foreground italic">
                              Toutes les matières (défaut)
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {canEdit ? (
                          <Input
                            type="number"
                            defaultValue={gs.max_score}
                            onBlur={(e) => {
                              if (parseInt(e.target.value, 10) !== gs.max_score) {
                                onUpdateMaxScore(gs, e.target.value);
                              }
                            }}
                            className="w-20 h-8 font-mono"
                          />
                        ) : (
                          <span className="font-mono font-semibold">/{gs.max_score}</span>
                        )}
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          {gs.subject_name && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(gs)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Dialog de création */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <CardContent className="py-6 space-y-4">
              <h3 className="font-semibold text-base">Nouveau barème</h3>
              <form onSubmit={onCreate} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Niveau</Label>
                  <Select
                    value={form.level}
                    onValueChange={(v) => setForm({ ...form, level: v as Level })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CP">CP (CP1, CP2)</SelectItem>
                      <SelectItem value="CE">CE (CE1, CE2)</SelectItem>
                      <SelectItem value="CM">CM (CM1, CM2)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Matière</Label>
                  <Select
                    value={form.subject_id}
                    onValueChange={(v) => setForm({ ...form, subject_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">
                        Toutes les matières (défaut du niveau)
                      </SelectItem>
                      {subjects.map((s: Subject) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Choisir une matière = exception au barème par défaut du niveau.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="max-score">Barème (note maximale)</Label>
                  <Input
                    id="max-score"
                    type="number"
                    min="1"
                    value={form.max_score}
                    onChange={(e) => setForm({ ...form, max_score: e.target.value })}
                    required
                    className="font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Ex: 10 pour /10, 20 pour /20, 30 pour /30, 50 pour /50.
                  </p>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                  >
                    Annuler
                  </Button>
                  <Button type="submit">Créer le barème</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Supprimer le barème ?"
        description={
          deleteTarget
            ? `Supprimer le barème ${deleteTarget.level} /${deleteTarget.max_score} (${deleteTarget.subject_name ?? "défaut"}) ?`
            : ""
        }
        confirmLabel="Supprimer"
        destructive
        icon={Trash2}
        onConfirm={onDelete}
      />
    </div>
  );
}
