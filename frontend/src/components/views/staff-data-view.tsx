"use client";

// === Module « Fichier du personnel » (Task 55) ===
//
// Fichier administratif EXCEL à compléter à tout moment dans SYGREN :
// chaque ligne porte les 14 colonnes demandées — N° (ordre du fichier),
// SECTEUR, NOM ET PRÉNOM, SEXE, DATE DE NAISSANCE, LIEU DE NAISSANCE,
// CATÉGORIE, MATRICULE, DATE D'ENTREE FP, ANCIENNETÉ, COURS, FONCTION,
// CONTACT, EFFECTIF — et s'exporte en classeur Excel (exceljs).
//
// Le fichier est PRÉ-REMPLI (seed backend) depuis les dossiers
// personnels des directeurs et adjoints au directeur actifs ; il reste
// librement complétalbe : ajouter, modifier, supprimer une ligne à tout
// moment. L'ancienneté est calculée automatiquement depuis la date
// d'entrée FP (le champ « Ancienneté » du formulaire sert aux cas
// particuliers : reprise, stage, etc.).
//
// Accès (matrice RBAC — module "staff-data") : admin + inspector.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IdCard,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Search,
  FileSpreadsheet,
  ChevronDown,
} from "lucide-react";

import { staffDataApi, sectorsApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useCrudMutation } from "@/lib/use-crud-mutation";
import type { StaffRecord } from "@/lib/types";
import { computeAnciennete, formatDossierDate } from "@/lib/types";
import { COURS_OPTIONS } from "@/components/personnel-dossier-fields";
import { saveBlob, XLSX_MIME, slugFile } from "@/lib/doc-export";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EntityDialog } from "@/components/entity-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Sentinelle des listes déroulantes « non renseigné » (pattern du
// dossier personnel — personnel-dossier-fields.tsx).
const UNSET = "?";

const SEXE_OPTIONS = ["F", "G"] as const;
const CATEGORIE_OPTIONS = ["IO", "IA", "IS", "IAS"] as const;
const FONCTION_OPTIONS = ["DIRECTEUR", "ADJOINT(E)"] as const;

interface FormData {
  sector_id: string; // UNSET = aucun secteur
  full_name: string;
  sexe: string; // UNSET = non renseigné
  date_naissance: string; // YYYY-MM-DD (input date) — "" = non renseigné
  lieu_naissance: string;
  categorie: string; // UNSET = non renseigné
  matricule: string;
  date_entree_fp: string; // YYYY-MM-DD — "" = non renseigné
  anciennete: string; // saisie libre — "" = calculée depuis l'entrée FP
  cours: string; // UNSET = non renseigné
  fonction: string; // UNSET = non renseigné
  contact: string;
  effectif: string; // "" = non renseigné
}

const EMPTY: FormData = {
  sector_id: UNSET,
  full_name: "",
  sexe: UNSET,
  date_naissance: "",
  lieu_naissance: "",
  categorie: UNSET,
  matricule: "",
  date_entree_fp: "",
  anciennete: "",
  cours: UNSET,
  fonction: UNSET,
  contact: "",
  effectif: "",
};

export function StaffDataView() {
  const user = useAuthStore((s) => s.user);
  const canManage = user?.role === "admin" || user?.role === "inspector";

  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState(UNSET);
  // Classement du fichier par secteur : un simple CLIC sur l'en-tête
  // SECTEUR du tableau bascule (re-clic = ordre initial du fichier).
  const [bySector, setBySector] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StaffRecord | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [deleteTarget, setDeleteTarget] = useState<StaffRecord | null>(null);
  const [exporting, setExporting] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["staff-records", search, sectorFilter],
    queryFn: () =>
      staffDataApi.list(
        search.trim() || undefined,
        sectorFilter !== UNSET ? sectorFilter : undefined,
      ),
  });

  // Secteurs (filtre + résolution des noms de la colonne SECTEUR).
  const { data: sectorsData } = useQuery({
    queryKey: ["sectors"],
    queryFn: () => sectorsApi.list(),
  });
  const sectorNames = useMemo(() => {
    const map = new Map<string, string>();
    (sectorsData?.sectors ?? []).forEach((s) => map.set(s.id, s.name));
    return map;
  }, [sectorsData]);

  const createMut = useCrudMutation(staffDataApi.create, {
    invalidateKeys: [["staff-records"]],
    successMessage: "Ligne ajoutée au fichier du personnel",
    actionLabel: "Ajout",
  });
  const updateMut = useCrudMutation(
    (id: string, payload: FormData) =>
      staffDataApi.update(id, formToPayload(payload)),
    {
      invalidateKeys: [["staff-records"]],
      successMessage: "Ligne du fichier du personnel mise à jour",
      actionLabel: "Mise à jour",
    },
  );
  const deleteMut = useCrudMutation((id: string) => staffDataApi.delete(id), {
    invalidateKeys: [["staff-records"]],
    successMessage: "Ligne supprimée du fichier du personnel",
    actionLabel: "Suppression",
  });

  const records = useMemo(() => data?.staff_records ?? [], [data]);

  // Effectif TOTAL du fichier (somme des colonnes EFFECTIF renseignées).
  const totalEffectif = useMemo(
    () =>
      records.reduce(
        (sum, r) => sum + (typeof r.effectif === "number" ? r.effectif : 0),
        0,
      ),
    [records],
  );

  // Affichage : ordre du fichier (défaut) ou classé par secteur (clic sur
  // l'en-tête SECTEUR). Tri STABLE : au sein d'un même secteur, l'ordre
  // initial de saisie est conservé ; les lignes sans secteur passent à la
  // fin, sous le bandeau « SANS SECTEUR ».
  const visibleRecords = useMemo(() => {
    if (!bySector) return records;
    const sectorName = (r: StaffRecord) =>
      r.sector_id ? (sectorNames.get(r.sector_id) ?? null) : null;
    return [...records].sort((a, b) => {
      const na = sectorName(a);
      const nb = sectorName(b);
      if (!na && !nb) return 0;
      if (!na) return 1;
      if (!nb) return -1;
      return na.localeCompare(nb, "fr");
    });
  }, [records, bySector, sectorNames]);

  // Stats par secteur des lignes AFFICHÉES (bandeaux de groupe) :
  // nombre d'agents + effectif cumulé du secteur.
  const groupStats = useMemo(() => {
    const m = new Map<string, { count: number; effectif: number }>();
    for (const r of visibleRecords) {
      const k = r.sector_id ?? "__none__";
      const cur = m.get(k) ?? { count: 0, effectif: 0 };
      cur.count += 1;
      cur.effectif += typeof r.effectif === "number" ? r.effectif : 0;
      m.set(k, cur);
    }
    return m;
  }, [visibleRecords]);

  // Alternance visuelle des BLOCS de secteurs : parité du bloc pour chaque
  // ligne affichée (les blocs consécutifs s'alternent fond blanc / fond
  // vert très pâle — chaque secteur forme un bloc distinct).
  const blockParity = useMemo(() => {
    const parity = new Map<string, boolean>();
    let idx = -1;
    let prev: string | null = null;
    for (const r of visibleRecords) {
      const k = r.sector_id ?? "__none__";
      if (k !== prev) {
        idx += 1;
        prev = k;
      }
      parity.set(r.id, idx % 2 === 1);
    }
    return parity;
  }, [visibleRecords]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(rec: StaffRecord) {
    setEditing(rec);
    setForm({
      sector_id: rec.sector_id ?? UNSET,
      full_name: rec.full_name ?? "",
      sexe: rec.sexe ?? UNSET,
      date_naissance: rec.date_naissance ? rec.date_naissance.slice(0, 10) : "",
      lieu_naissance: rec.lieu_naissance ?? "",
      categorie: rec.categorie ?? UNSET,
      matricule: rec.matricule ?? "",
      date_entree_fp: rec.date_entree_fp ? rec.date_entree_fp.slice(0, 10) : "",
      anciennete: rec.anciennete ?? "",
      cours: rec.cours ?? UNSET,
      fonction: rec.fonction ?? UNSET,
      contact: rec.contact ?? "",
      effectif: typeof rec.effectif === "number" ? String(rec.effectif) : "",
    });
    setDialogOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    try {
      if (editing) {
        await updateMut.mutateAsync([editing.id, form]);
      } else {
        await createMut.mutateAsync([formToPayload(form)]);
      }
      setDialogOpen(false);
    } catch {
      /* toastée */
    }
  }

  async function onDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync([deleteTarget.id]);
      setDeleteTarget(null);
    } catch {
      /* toastée */
    }
  }

  async function handleExcel() {
    setExporting(true);
    try {
      // Export dans l'ordre AFFICHÉ : si le fichier est classé par
      // secteur, le classeur reproduit les BLOCS par secteur (bandeau
      // + alternance de fond) secteur par secteur.
      await exportExcelAsync(visibleRecords, totalEffectif, sectorNames, bySector);
    } finally {
      setExporting(false);
    }
  }

  const busy = createMut.isPending || updateMut.isPending;

  // Nombre de colonnes du tableau (colSpan des bandeaux de groupe).
  const colCount = 14 + (canManage ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* === En-tête + actions === */}
      <Card className="border-border/60">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <IdCard className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-semibold text-base">
                  Fichier du personnel
                </h2>
                <p className="text-xs text-muted-foreground">
                  Fichier Excel à compléter à tout moment — secteur, identité,
                  catégorie, matricule, entrée FP, ancienneté, cours, fonction,
                  contact, effectif
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleExcel}
                disabled={exporting || records.length === 0}
                className="shadow-sm"
              >
                {exporting ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="w-4 h-4 mr-1.5" />
                )}
                Exporter Excel
              </Button>
              {canManage && (
                <Button onClick={openCreate} className="shadow-sm">
                  <Plus className="w-4 h-4 mr-1.5" />
                  Nouvel agent
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher (nom, matricule, contact, lieu de naissance)…"
                className="pl-8"
              />
            </div>
            <Select
              value={sectorFilter}
              onValueChange={(v) => setSectorFilter(v)}
            >
              <SelectTrigger className="w-[220px] h-9" aria-label="Secteur">
                <SelectValue placeholder="Tous les secteurs" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Secteur</SelectLabel>
                  <SelectItem value={UNSET}>Tous les secteurs</SelectItem>
                  {(sectorsData?.sectors ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* === Liste === */}
      <Card className="border-border/60 overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-sm">Chargement du fichier du personnel…</p>
            </div>
          ) : error ? (
            <div className="py-12 text-center text-sm text-destructive">
              Erreur de chargement — {(error as Error).message}
            </div>
          ) : records.length === 0 ? (
            <div className="py-12 text-center">
              <IdCard className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {search || sectorFilter !== UNSET
                  ? "Aucune ligne ne correspond à ces critères."
                  : "Le fichier du personnel est vide. Ajoutez le premier agent."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto scroll-sygren">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center w-[44px]">N°</TableHead>
                    <TableHead>
                      {/* En-tête SECTEUR interactif : surbrillance au survol,
                          un simple clic CLASSE tout le fichier par secteur
                          (re-clic = retour à l'ordre initial du fichier). */}
                      <button
                        type="button"
                        onClick={() => setBySector((v) => !v)}
                        title={
                          bySector
                            ? "Revenir à l'ordre initial du fichier"
                            : "Classer tout le fichier par secteur"
                        }
                        className={cn(
                          "-mx-2 -my-1 inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-primary/10 hover:text-primary",
                          bySector && "bg-primary/10 text-primary",
                        )}
                      >
                        Secteur
                        <ChevronDown
                          className={cn(
                            "h-3 w-3 opacity-60 transition-transform",
                            bySector && "rotate-180",
                          )}
                        />
                      </button>
                    </TableHead>
                    <TableHead>Nom et prénom</TableHead>
                    <TableHead className="text-center">Sexe</TableHead>
                    <TableHead>Date de naissance</TableHead>
                    <TableHead>Lieu de naissance</TableHead>
                    <TableHead className="text-center">Catégorie</TableHead>
                    <TableHead>Matricule</TableHead>
                    <TableHead>Date d&apos;entrée FP</TableHead>
                    <TableHead>Ancienneté</TableHead>
                    <TableHead className="text-center">Cours</TableHead>
                    <TableHead>Fonction</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-center">Effectif</TableHead>
                    {canManage && (
                      <TableHead className="w-[92px] text-center">
                        Actions
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRecords.flatMap((rec, i) => {
                    const isFemale = rec.sexe === "F";
                    // Bandeau de groupe : inséré avant la 1re ligne de
                    // chaque secteur quand le fichier est classé par
                    // secteur (clic sur l'en-tête SECTEUR).
                    const sectorKey = rec.sector_id ?? "__none__";
                    const prevSectorKey =
                      i > 0
                        ? (visibleRecords[i - 1].sector_id ?? "__none__")
                        : null;
                    const row = (
                      <TableRow
                        key={rec.id}
                        className={cn(
                          "hover:bg-muted/40",
                          // Blocs consécutifs : alternance de fond
                          // BLANC / VERT TRÈS PÂLE — chaque secteur
                          // reste un bloc distinct sous son bandeau.
                          bySector &&
                            blockParity.get(rec.id) &&
                            "bg-[#E6F4EB]",
                        )}
                      >
                        <TableCell className="text-center text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell className="text-xs">
                          {rec.sector_id
                            ? (sectorNames.get(rec.sector_id) ?? "—")
                            : "—"}
                        </TableCell>
                        <TableCell
                          className={
                            "font-medium" +
                            (isFemale ? " text-red-600" : "")
                          }
                        >
                          {rec.full_name}
                        </TableCell>
                        <TableCell className="text-center">
                          {rec.sexe ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDossierDate(rec.date_naissance) || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {rec.lieu_naissance || "—"}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          {rec.categorie ?? "—"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {rec.matricule || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDossierDate(rec.date_entree_fp) || "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {displayAnciennete(rec)}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          {rec.cours ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {rec.fonction ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {rec.contact || "—"}
                        </TableCell>
                        <TableCell className="text-center text-xs font-medium">
                          {typeof rec.effectif === "number" ? rec.effectif : "—"}
                        </TableCell>
                        {canManage && (
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openEdit(rec)}
                                aria-label={`Modifier ${rec.full_name}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(rec)}
                                aria-label={`Supprimer ${rec.full_name}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                    // Bandeaux + blocs UNIQUEMENT quand le classement
                    // par secteur est actif (clic sur l'en-tête
                    // SECTEUR) ; vue par défaut = fichier intact.
                    if (!bySector || sectorKey === prevSectorKey)
                      return [row];
                    const st = groupStats.get(sectorKey);
                    const label = rec.sector_id
                      ? (sectorNames.get(rec.sector_id) ?? "SECTEUR")
                      : "SANS SECTEUR — À COMPLÉTER";
                    return [
                      // Bandeau VERT du secteur : fond vert franc
                      // (vert drapeau ivoirien, identique à l'export
                      // Excel), texte blanc — chaque secteur forme un
                      // bloc immédiatement identifiable.
                      <TableRow
                        key={`sec-${sectorKey}`}
                        className="bg-[#009E60] hover:bg-[#009E60]"
                      >
                        <TableCell colSpan={colCount} className="py-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-white">
                            {label}
                          </span>
                          <span className="ml-2 text-xs text-white/85">
                            {st?.count ?? 1} agent{(st?.count ?? 1) > 1 ? "s" : ""}
                            {st && st.effectif > 0
                              ? ` · effectif ${st.effectif}`
                              : ""}
                          </span>
                        </TableCell>
                      </TableRow>,
                      row,
                    ];
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* === Dialog création/édition === */}
      <EntityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Modifier la ligne du fichier" : "Nouvel agent"}
        description="Les 14 colonnes du fichier du personnel — completables à tout moment."
        icon={IdCard}
        loading={busy}
        maxWidth="sm:max-w-2xl"
      >
        <form onSubmit={submit} className="space-y-3 pt-2">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="staff-full-name">Nom et prénom *</Label>
              <Input
                id="staff-full-name"
                value={form.full_name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, full_name: e.target.value }))
                }
                placeholder="Ex : KOFFI Aya Marie"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="staff-sector">Secteur</Label>
                <Select
                  value={form.sector_id}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      sector_id: v === UNSET ? UNSET : v,
                    }))
                  }
                >
                  <SelectTrigger id="staff-sector" aria-label="Secteur">
                    <SelectValue placeholder="Choisir…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Secteur d&apos;affectation</SelectLabel>
                      <SelectItem value={UNSET}>—</SelectItem>
                      {(sectorsData?.sectors ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Sexe</Label>
                <Select
                  value={form.sexe}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, sexe: v === UNSET ? UNSET : v }))
                  }
                >
                  <SelectTrigger aria-label="Sexe">
                    <SelectValue placeholder="Choisir…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Sexe (F · G)</SelectLabel>
                      <SelectItem value={UNSET}>—</SelectItem>
                      {SEXE_OPTIONS.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="staff-birth-date">Date de naissance</Label>
                <Input
                  id="staff-birth-date"
                  type="date"
                  value={form.date_naissance}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, date_naissance: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-birth-place">Lieu de naissance</Label>
                <Input
                  id="staff-birth-place"
                  value={form.lieu_naissance}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, lieu_naissance: e.target.value }))
                  }
                  placeholder="Ex : BOUAKÉ"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Catégorie</Label>
                <Select
                  value={form.categorie}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      categorie: v === UNSET ? UNSET : v,
                    }))
                  }
                >
                  <SelectTrigger aria-label="Catégorie">
                    <SelectValue placeholder="Choisir…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Catégorie</SelectLabel>
                      <SelectItem value={UNSET}>—</SelectItem>
                      {CATEGORIE_OPTIONS.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-matricule">Matricule</Label>
                <Input
                  id="staff-matricule"
                  value={form.matricule}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, matricule: e.target.value }))
                  }
                  placeholder="Ex : 281789B"
                  className="font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="staff-fp-date">Date d&apos;entrée FP</Label>
                <Input
                  id="staff-fp-date"
                  type="date"
                  value={form.date_entree_fp}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, date_entree_fp: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-anciennete">Ancienneté</Label>
                <Input
                  id="staff-anciennete"
                  value={form.anciennete}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, anciennete: e.target.value }))
                  }
                  placeholder="Auto depuis l'entrée FP si vide"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cours</Label>
                <Select
                  value={form.cours}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, cours: v === UNSET ? UNSET : v }))
                  }
                >
                  <SelectTrigger aria-label="Cours">
                    <SelectValue placeholder="Choisir…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Cours tenu</SelectLabel>
                      <SelectItem value={UNSET}>—</SelectItem>
                      {COURS_OPTIONS.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Fonction</Label>
                <Select
                  value={form.fonction}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      fonction: v === UNSET ? UNSET : v,
                    }))
                  }
                >
                  <SelectTrigger aria-label="Fonction">
                    <SelectValue placeholder="Choisir…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Fonction</SelectLabel>
                      <SelectItem value={UNSET}>—</SelectItem>
                      {FONCTION_OPTIONS.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v === "DIRECTEUR" ? "Directeur" : "Adjoint(e)"}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="staff-contact">Contact</Label>
                <Input
                  id="staff-contact"
                  type="tel"
                  value={form.contact}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, contact: e.target.value }))
                  }
                  placeholder="Ex : 0700000000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-effectif">Effectif</Label>
                <Input
                  id="staff-effectif"
                  type="number"
                  min={0}
                  value={form.effectif}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, effectif: e.target.value }))
                  }
                  placeholder="Effectif du cours"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              L&apos;ancienneté est calculée automatiquement à partir de la
              date d&apos;entrée FP (années révolues). Le champ Ancienneté
              sert aux cas particuliers : reprise de service, stage, etc.
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
            <Button type="submit" disabled={!form.full_name.trim()}>
              {editing ? "Enregistrer" : "Ajouter au fichier"}
            </Button>
          </div>
        </form>
      </EntityDialog>

      {/* === Confirmation de suppression === */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Supprimer cette ligne du fichier ?"
        description={
          deleteTarget
            ? `La ligne de "${deleteTarget.full_name}" sera retirée du fichier du personnel.`
            : ""
        }
        confirmLabel="Supprimer"
        destructive
        icon={Trash2}
        onConfirm={onDelete}
        loading={deleteMut.isPending}
      />
    </div>
  );
}

/** Ancienneté affichée : saisie libre, sinon calculée depuis l'entrée FP. */
function displayAnciennete(rec: StaffRecord): string {
  const manual = rec.anciennete?.trim();
  if (manual) return manual;
  return computeAnciennete(rec.date_entree_fp) || "—";
}

/** FormData → payload API (les listes UNSET et chaînes vides = null). */
function formToPayload(form: FormData) {
  return {
    sector_id: form.sector_id !== UNSET ? form.sector_id : null,
    full_name: form.full_name.trim(),
    sexe: form.sexe !== UNSET && form.sexe !== "" ? form.sexe : null,
    date_naissance: form.date_naissance || null,
    lieu_naissance: form.lieu_naissance.trim() || null,
    categorie:
      form.categorie !== UNSET && form.categorie !== "" ? form.categorie : null,
    matricule: form.matricule.trim() || null,
    date_entree_fp: form.date_entree_fp || null,
    anciennete: form.anciennete.trim() || null,
    cours: form.cours !== UNSET && form.cours !== "" ? form.cours : null,
    fonction:
      form.fonction !== UNSET && form.fonction !== "" ? form.fonction : null,
    contact: form.contact.trim() || null,
    effectif: form.effectif !== "" ? Number(form.effectif) : null,
  };
}

// === Export Excel (exceljs) — les 14 colonnes du fichier ===

async function exportExcelAsync(
  records: StaffRecord[],
  totalEffectif: number,
  sectorNames?: Map<string, string>,
  grouped = false, // classement par secteur actif → bandeaux + blocs
): Promise<void> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "SYGREN";
  const ws = wb.addWorksheet("Fichier du personnel", {
    views: [{ state: "frozen", ySplit: 3, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.3,
        right: 0.3,
        top: 0.45,
        bottom: 0.45,
        header: 0.2,
        footer: 0.2,
      },
      printTitlesRow: "3:3",
    },
  });

  // 14 colonnes — dans l'ordre exact demandé.
  ws.columns = [
    { width: 5 }, // N°
    { width: 22 }, // SECTEUR
    { width: 30 }, // NOM ET PRÉNOM
    { width: 7 }, // SEXE
    { width: 15 }, // DATE DE NAISSANCE
    { width: 20 }, // LIEU DE NAISSANCE
    { width: 11 }, // CATÉGORIE
    { width: 13 }, // MATRICULE
    { width: 15 }, // DATE D'ENTREE FP
    { width: 12 }, // ANCIENNETÉ
    { width: 9 }, // COURS
    { width: 13 }, // FONCTION
    { width: 15 }, // CONTACT
    { width: 10 }, // EFFECTIF
  ];

  const font = (size: number, bold = false, argb?: string) => ({
    name: "Arial",
    size,
    bold,
    ...(argb ? { color: { argb } } : {}),
  });
  const GREEN = { argb: "FF009E60" };
  const WHITE = { argb: "FFFFFFFF" };
  // Blocs de secteurs (classement actif) : BANDEAU VERT par secteur
  // (même vert que l'en-tête du classeur) + alternance de fond
  // blanc / vert très pâle entre blocs consécutifs — visuel identique
  // au tableau de l'appli.
  const BANNER_BG = { argb: "FF009E60" };
  const BANNER_TEXT = { argb: "FFFFFFFF" };
  const BLOCK_BG = { argb: "FFE6F4EB" };
  const border = { style: "thin" as const, color: GREEN };
  const BOX = { top: border, left: border, bottom: border, right: border };
  const HEADERS = [
    "N°",
    "SECTEUR",
    "NOM ET PRÉNOM",
    "SEXE",
    "DATE DE NAISSANCE",
    "LIEU DE NAISSANCE",
    "CATÉGORIE",
    "MATRICULE",
    "DATE D'ENTREE FP",
    "ANCIENNETÉ",
    "COURS",
    "FONCTION",
    "CONTACT",
    "EFFECTIF",
  ];

  // Titre + date du jour.
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2, "0")}/${String(
    today.getMonth() + 1,
  ).padStart(2, "0")}/${today.getFullYear()}`;

  let row = 1;
  ws.mergeCells(row, 1, row, 14);
  let c = ws.getCell(row, 1);
  c.value = "FICHIER DU PERSONNEL";
  c.font = font(14, true);
  c.alignment = { horizontal: "center", vertical: "middle" };
  row += 1;
  ws.mergeCells(row, 1, row, 14);
  c = ws.getCell(row, 1);
  c.value = `${records.length} agent(s) — édité le ${todayStr}`;
  c.font = font(10, false, "FF666666");
  c.alignment = { horizontal: "center", vertical: "middle" };
  row += 1;

  // Ligne d'en-têtes (fond vert, texte blanc).
  const headRow = ws.getRow(row);
  headRow.values = HEADERS;
  headRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: GREEN };
    cell.font = font(10, true, WHITE.argb);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BOX;
  });
  headRow.height = 22;

  // Lignes du fichier — N° = ordre d'affichage, femmes en rouge
  // (convention de l'État nominatif du personnel). Classement par
  // secteur actif : un BANDEAU VERT s'insère devant chaque secteur et
  // les blocs consécutifs alternent leur fond blanc / vert très pâle
  // (visuel identique au tableau de l'appli).
  let rIdx = row + 1;
  let agentNo = 0;
  let blockIdx = -1;
  let prevKey: string | null = null;
  for (const rec of records) {
    const sectorKey = rec.sector_id ?? "__none__";
    if (grouped && sectorKey !== prevKey) {
      blockIdx += 1;
      prevKey = sectorKey;
      const bannerRow = ws.getRow(rIdx);
      ws.mergeCells(rIdx, 1, rIdx, 14);
      const bannerCell = ws.getCell(rIdx, 1);
      const label = rec.sector_id
        ? (sectorNames?.get(rec.sector_id) ?? "SECTEUR").toUpperCase()
        : "SANS SECTEUR — À COMPLÉTER";
      bannerCell.value = label;
      bannerCell.font = font(10, true, BANNER_TEXT.argb);
      bannerCell.alignment = { horizontal: "left", vertical: "middle" };
      for (let col = 1; col <= 14; col++) {
        const c = ws.getCell(rIdx, col);
        c.border = BOX;
        c.fill = { type: "pattern", pattern: "solid", fgColor: BANNER_BG };
      }
      bannerRow.height = 20;
      rIdx += 1;
    }
    agentNo += 1;
    const shade =
      grouped && blockIdx % 2 === 1 ? BLOCK_BG : undefined;
    const dataRow = ws.getRow(rIdx);
    dataRow.values = [
      agentNo,
      rec.sector_id ? (sectorNames?.get(rec.sector_id) ?? "") : "",
      rec.full_name.toUpperCase(),
      rec.sexe ?? "",
      formatDossierDate(rec.date_naissance),
      rec.lieu_naissance ?? "",
      rec.categorie ?? "",
      rec.matricule ?? "",
      formatDossierDate(rec.date_entree_fp),
      displayAnciennete(rec) === "—" ? "" : displayAnciennete(rec),
      rec.cours ?? "",
      rec.fonction ?? "",
      rec.contact ?? "",
      typeof rec.effectif === "number" ? rec.effectif : "",
    ];
    dataRow.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BOX;
      const isNameCol = col === 3;
      const femaleName = isNameCol && rec.sexe === "F";
      cell.font = font(10, isNameCol, femaleName ? "FFE00000" : undefined);
      cell.alignment = {
        // NOM ET PRÉNOM + LIEU DE NAISSANCE à gauche ; le reste centré.
        horizontal: isNameCol || col === 6 ? "left" : "center",
        vertical: "middle",
      };
      if (shade) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: shade };
      }
    });
    dataRow.height = 18;
    rIdx += 1;
  }

  // Ligne TOTAL (effectif).
  const totalRowIdx = rIdx;
  ws.mergeCells(totalRowIdx, 1, totalRowIdx, 13);
  const totalCell = ws.getCell(totalRowIdx, 1);
  totalCell.value = "TOTAL EFFECTIF";
  totalCell.font = font(10, true);
  totalCell.alignment = { horizontal: "right", vertical: "middle" };
  const totalVal = ws.getCell(totalRowIdx, 14);
  totalVal.value = totalEffectif;
  totalVal.font = font(10, true);
  totalVal.alignment = { horizontal: "center", vertical: "middle" };
  for (let col = 1; col <= 14; col++) {
    ws.getCell(totalRowIdx, col).border = BOX;
  }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buf], { type: XLSX_MIME }),
    `fichier-du-personnel-${slugFile(todayStr)}.xlsx`,
  );
}
