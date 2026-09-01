"use client";

// === Dossier personnel — section de formulaire partagée (module Utilisateurs) ===
//
// Champs administratifs du document officiel « ÉTAT NOMINATIF DU
// PERSONNEL », avec les LISTES DÉROULANTES demandées :
//   - Matricule (saisie libre)
//   - Date et lieu de naissance — listes déroulantes JOUR / MOIS / ANNÉE + lieu
//   - Catégorie — liste déroulante IO | IA | IS | IAS
//   - Classe — liste déroulante « Classe 1 | Classe 2 | Classe 3 | Classe 4 »
//     (libellés EXPLICITES dans le popup — l'utilisateur a signalé lire
//     « 1 ; 2 ; P ; E » sur des items en chiffres nus trop étroits/ambigus ;
//     la valeur stockée reste le nombre 1..4)
//   - Date d'entrée à la F.P — listes déroulantes JOUR / MOIS / ANNÉE
//   - Fonction — liste déroulante DIRECTEUR | ADJOINT(E)
//   - Date d'entrée DREN — listes déroulantes JOUR / MOIS / ANNÉE
//   - Entrée à l'IEP — listes déroulantes JOUR / MOIS / ANNÉE
//   - Effectif — F | G | T (saisies numériques, comme les colonnes du document)
//   - Redoublants — F | G | T
//   - Sexe — liste déroulante F | G
//
// Le dossier part entier à chaque enregistrement (sémantique « mise à
// jour complète » du backend — un champ vide efface la valeur stockée).

import { useState } from "react";
import { type LucideIcon, IdCard } from "lucide-react";

import type { PersonnelDossier } from "@/lib/types";
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

// NB : SelectLabel DOIT être enveloppé dans SelectGroup (exigence Radix —
// sans groupe : « SelectLabel must be used within SelectGroup » et
// plantage du dialog entier à l'ouverture).

// Valeur sentinelle des listes « non renseigné » (Radix refuse value="")
const UNSET = "?";

const MONTHS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const GRADES = [1, 2, 3, 4];

/** Bornes d'années des listes :
 *  - naissance : 1940 → l'année courante ;
 *  - entrées (F.P / DREN / IEP) : 1960 → l'année courante. */
function yearRange(from: number): number[] {
  const to = new Date().getFullYear();
  const out: number[] = [];
  for (let y = to; y >= from; y--) out.push(y);
  return out;
}

type IsoParts = { y: string; m: string; d: string };

function parseIsoParts(iso: string | null | undefined): IsoParts {
  if (!iso || iso.length < 10) return { y: "", m: "", d: "" };
  const [y, m, d] = iso.slice(0, 10).split("-");
  // L'ISO est zéro-padé ("05") mais les items des listes portent les valeurs
  // simples ("5") : dé-pader pour que la valeur retrouve son item à l'édition.
  const unpad = (s: string) => (s ? String(Number(s)) : "");
  return { y: y || "", m: unpad(m), d: unpad(d) };
}

/** Sélecteur de date en 3 listes déroulantes (Jour / Mois / Année).
 *  ISO vaut "YYYY-MM-DD…" (API) ou null ; la date n'est posée que si les
 *  3 parties sont choisies.
 *
 *  ⚠ Les 3 parties vivent dans un ÉTAT LOCAL initialisé depuis l'ISO :
 *  chaque liste garde sa sélection pendant qu'on complète les deux autres.
 *  (Version initiale : les parties dérivées directement de la prop iso —
 *  la sélection partielle était écrasée par le re-render parent dès la
 *  première liste choisie, les listes semblaient « ne pas fonctionner ».)
 *  L'ISO n'est émis au dossier que lorsque les 3 parties sont réunies.
 *  Le dialog démonte son contenu à la fermeture : chaque ouverture
 *  réinitialise proprement les parties depuis la valeur enregistrée. */
function DateSelects({
  id,
  label,
  iso,
  years,
  onChange,
}: {
  id: string;
  label: string;
  iso: string | null | undefined;
  years: number[];
  onChange: (iso: string | null) => void;
}) {
  const [parts, setParts] = useState<IsoParts>(() => parseIsoParts(iso));

  const set = (part: keyof IsoParts, raw: string) => {
    const v = raw === UNSET ? "" : raw;
    const next = { ...parts, [part]: v };
    setParts(next);
    onChange(
      next.y && next.m && next.d
        ? `${next.y}-${next.m.padStart(2, "0")}-${next.d.padStart(2, "0")}`
        : null,
    );
  };
  const trigger = "h-8 w-full text-xs px-2";
  return (
    <div className="space-y-1 min-w-0">
      <Label htmlFor={id} className="text-[11px] leading-tight block">
        {label}
      </Label>
      <div className="flex gap-1.5" id={id}>
        <Select value={parts.d || UNSET} onValueChange={(v) => set("d", v)}>
          <SelectTrigger className={trigger} aria-label={`${label} — jour`}>
            <SelectValue placeholder="Jour" />
          </SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectGroup>
              <SelectLabel>Jour (01 → 31)</SelectLabel>
              <SelectItem value={UNSET}>—</SelectItem>
              {DAYS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {String(d).padStart(2, "0")}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={parts.m || UNSET} onValueChange={(v) => set("m", v)}>
          <SelectTrigger className={trigger} aria-label={`${label} — mois`}>
            <SelectValue placeholder="Mois" />
          </SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectGroup>
              <SelectLabel>Mois (Janvier → Décembre)</SelectLabel>
              <SelectItem value={UNSET}>—</SelectItem>
              {MONTHS.map((name, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={parts.y || UNSET} onValueChange={(v) => set("y", v)}>
          <SelectTrigger className={trigger} aria-label={`${label} — année`}>
            <SelectValue placeholder="Année" />
          </SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectGroup>
              <SelectLabel>Année</SelectLabel>
              <SelectItem value={UNSET}>—</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/** Trois saisies numériques F / G / T (effectif ou redoublants du cours). */
function FGTInputs({
  label,
  f,
  g,
  t,
  onF,
  onG,
  onT,
}: {
  label: string;
  f: number | null | undefined;
  g: number | null | undefined;
  t: number | null | undefined;
  onF: (v: number | null) => void;
  onG: (v: number | null) => void;
  onT: (v: number | null) => void;
}) {
  const cell = (v: number | null | undefined, on: (v: number | null) => void, cap: string) => (
    <div className="flex-1 min-w-0">
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={999}
        aria-label={`${label} ${cap}`}
        value={v ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          on(raw === "" ? null : Math.max(0, Math.min(999, Number(raw))));
        }}
        placeholder="—"
        className="h-8 text-xs px-2 w-full"
      />
    </div>
  );
  return (
    <div className="space-y-1 min-w-0">
      <span className="text-[11px] leading-tight font-medium">{label}</span>
      <div className="flex gap-1.5">
        {cell(f, onF, "F")}
        {cell(g, onG, "G")}
        {cell(t, onT, "T")}
      </div>
      <div className="flex gap-1.5 text-[10px] text-muted-foreground text-center">
        <span className="flex-1">F</span>
        <span className="flex-1">G</span>
        <span className="flex-1">T</span>
      </div>
    </div>
  );
}

export function PersonnelDossierFields({
  value,
  onChange,
}: {
  value: PersonnelDossier;
  onChange: (v: PersonnelDossier) => void;
}) {
  const birthYears = yearRange(1940);
  const entryYears = yearRange(1960);

  const small = "h-8 w-full text-xs px-2";
  const field = "space-y-1 min-w-0";

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <IdCard className="w-3.5 h-3.5" />
        Dossier personnel — État nominatif du personnel
      </div>

      {/* Identité administrative */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <div className={field}>
          <Label htmlFor="pers-matricule" className="text-[11px]">
            Matricule
          </Label>
          <Input
            id="pers-matricule"
            value={value.matricule ?? ""}
            onChange={(e) => onChange({ ...value, matricule: e.target.value || null })}
            placeholder="Ex : 1234567"
            className={small}
          />
        </div>
        <div className={field}>
          <Label className="text-[11px]">Sexe</Label>
          <Select
            value={value.sexe ?? UNSET}
            onValueChange={(v) => onChange({ ...value, sexe: v === UNSET ? null : (v as "F" | "G") })}
          >
            <SelectTrigger className={small} aria-label="Sexe">
              <SelectValue placeholder="Choisir…" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Sexe (F · G)</SelectLabel>
                <SelectItem value={UNSET}>—</SelectItem>
                <SelectItem value="F">F</SelectItem>
                <SelectItem value="G">G</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className={field}>
          <Label className="text-[11px]">Catégorie</Label>
          <Select
            value={value.categorie ?? UNSET}
            onValueChange={(v) =>
              onChange({ ...value, categorie: v === UNSET ? null : (v as "IO" | "IA" | "IS" | "IAS") })
            }
          >
            <SelectTrigger className={small} aria-label="Catégorie IO IA IS IAS">
              <SelectValue placeholder="Choisir…" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Catégorie (IO · IA · IS · IAS)</SelectLabel>
                <SelectItem value={UNSET}>—</SelectItem>
                <SelectItem value="IO">IO</SelectItem>
                <SelectItem value="IA">IA</SelectItem>
                <SelectItem value="IS">IS</SelectItem>
                <SelectItem value="IAS">IAS</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Date et lieu de naissance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <DateSelects
          id="pers-naissance"
          label="Date de naissance (Jour · Mois · Année)"
          iso={value.date_naissance}
          years={birthYears}
          onChange={(iso) => onChange({ ...value, date_naissance: iso })}
        />
        <div className={field}>
          <Label htmlFor="pers-lieu" className="text-[11px]">
            Lieu de naissance
          </Label>
          <Input
            id="pers-lieu"
            value={value.lieu_naissance ?? ""}
            onChange={(e) => onChange({ ...value, lieu_naissance: e.target.value || null })}
            placeholder="Ex : Dabou"
            className={small}
          />
        </div>
      </div>

      {/* Classe administrative + Échelon + Fonction */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className={field}>
          <Label className="text-[11px]">Classe</Label>
          <Select
            value={value.classe_grade ? String(value.classe_grade) : UNSET}
            onValueChange={(v) =>
              onChange({ ...value, classe_grade: v === UNSET ? null : Number(v) })
            }
          >
            <SelectTrigger className={small} aria-label="Classe administrative">
              <SelectValue placeholder="Choisir…" />
            </SelectTrigger>
            <SelectContent className="min-w-[8.5rem]">
              <SelectGroup>
                <SelectLabel>Classe administrative (1 · 2 · 3 · 4)</SelectLabel>
                <SelectItem value={UNSET}>—</SelectItem>
                {GRADES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {`Classe ${n}`}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className={field}>
          <Label className="text-[11px]">Échelon</Label>
          <Select
            value={value.echelon ? String(value.echelon) : UNSET}
            onValueChange={(v) => onChange({ ...value, echelon: v === UNSET ? null : Number(v) })}
          >
            <SelectTrigger className={small} aria-label="Échelon">
              <SelectValue placeholder="Choisir…" />
            </SelectTrigger>
            <SelectContent className="min-w-[8.5rem]">
              <SelectGroup>
                <SelectLabel>Échelon (1 · 2 · 3 · 4)</SelectLabel>
                <SelectItem value={UNSET}>—</SelectItem>
                {GRADES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {`Échelon ${n}`}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className={field}>
          <Label className="text-[11px]">Fonction</Label>
          <Select
            value={value.fonction ?? UNSET}
            onValueChange={(v) =>
              onChange({
                ...value,
                fonction:
                  v === UNSET ? null : v === "ADJOINT(E)" ? "ADJOINT(E)" : "DIRECTEUR",
              })
            }
          >
            <SelectTrigger className={small} aria-label="Fonction">
              <SelectValue placeholder="Choisir…" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Fonction (Directeur · Adjoint(e))</SelectLabel>
                <SelectItem value={UNSET}>—</SelectItem>
                <SelectItem value="DIRECTEUR">Directeur</SelectItem>
                <SelectItem value="ADJOINT(E)">Adjoint(e)</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Dates d'entrée */}
      <DateSelects
        id="pers-fp"
        label="Date d'entrée à la F.P (Jour · Mois · Année)"
        iso={value.date_entree_fp}
        years={entryYears}
        onChange={(iso) => onChange({ ...value, date_entree_fp: iso })}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <DateSelects
          id="pers-dren"
          label="Date d'entrée DREN (Jour · Mois · Année)"
          iso={value.date_entree_dren}
          years={entryYears}
          onChange={(iso) => onChange({ ...value, date_entree_dren: iso })}
        />
        <DateSelects
          id="pers-iep"
          label="Entrée à l'IEP (Jour · Mois · Année)"
          iso={value.date_entree_iep}
          years={entryYears}
          onChange={(iso) => onChange({ ...value, date_entree_iep: iso })}
        />
      </div>

      {/* Effectif + Redoublants (F / G / T du document) */}
      <div className="grid grid-cols-2 gap-2.5">
        <FGTInputs
          label="Effectif"
          f={value.effectif_f}
          g={value.effectif_g}
          t={value.effectif_t}
          onF={(v) => onChange({ ...value, effectif_f: v })}
          onG={(v) => onChange({ ...value, effectif_g: v })}
          onT={(v) => onChange({ ...value, effectif_t: v })}
        />
        <FGTInputs
          label="Redoublants"
          f={value.redoublant_f}
          g={value.redoublant_g}
          t={value.redoublant_t}
          onF={(v) => onChange({ ...value, redoublant_f: v })}
          onG={(v) => onChange({ ...value, redoublant_g: v })}
          onT={(v) => onChange({ ...value, redoublant_t: v })}
        />
      </div>

      <p className="text-[10px] text-muted-foreground">
        Ces champs alimentent le document « État nominatif du personnel » de
        l&apos;école (impression A4 paysage depuis l&apos;onglet Enseignants).
      </p>
    </div>
  );
}

/** Icône réutilisée par les vues (bouton impression, cartes…). */
export const PersonnelIcon: LucideIcon = IdCard;

/** Extrait le dossier personnel d'un utilisateur renvoyé par l'API
 *  (les champs sont sérialisés à plat sur l'objet User). */
export function personnelOf(u: {
  matricule?: string | null;
  sexe?: "F" | "G" | null;
  date_naissance?: string | null;
  lieu_naissance?: string | null;
  categorie?: "IO" | "IA" | "IS" | "IAS" | null;
  classe_grade?: number | null;
  echelon?: number | null;
  date_entree_fp?: string | null;
  fonction?: "DIRECTEUR" | "ADJOINT(E)" | null;
  date_entree_dren?: string | null;
  date_entree_iep?: string | null;
  effectif_f?: number | null;
  effectif_g?: number | null;
  effectif_t?: number | null;
  redoublant_f?: number | null;
  redoublant_g?: number | null;
  redoublant_t?: number | null;
}): PersonnelDossier {
  return {
    matricule: u.matricule ?? null,
    sexe: u.sexe ?? null,
    date_naissance: u.date_naissance ?? null,
    lieu_naissance: u.lieu_naissance ?? null,
    categorie: u.categorie ?? null,
    classe_grade: u.classe_grade ?? null,
    echelon: u.echelon ?? null,
    date_entree_fp: u.date_entree_fp ?? null,
    fonction: u.fonction ?? null,
    date_entree_dren: u.date_entree_dren ?? null,
    date_entree_iep: u.date_entree_iep ?? null,
    effectif_f: u.effectif_f ?? null,
    effectif_g: u.effectif_g ?? null,
    effectif_t: u.effectif_t ?? null,
    redoublant_f: u.redoublant_f ?? null,
    redoublant_g: u.redoublant_g ?? null,
    redoublant_t: u.redoublant_t ?? null,
  };
}

/** Le dossier contient-il au moins un champ renseigné ? */
export function hasPersonnelData(d: PersonnelDossier | null | undefined): boolean {
  if (!d) return false;
  return Object.values(d).some((v) => v !== null && v !== undefined && v !== "");
}
