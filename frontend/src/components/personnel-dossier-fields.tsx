"use client";

// === Dossier personnel — section de formulaire partagée (module Utilisateurs) ===
//
// Champs administratifs du document officiel « ÉTAT NOMINATIF DU
// PERSONNEL », avec les LISTES DÉROULANTES demandées :
//   - Matricule (saisie libre)
//   - Date et lieu de naissance — JJ / MM / AAAA avec LES DEUX MODES
//     (v11) : on TAPE les chiffres AU CLAVIER, OU on ouvre la LISTE
//     DÉROULANTE du segment (chevron) et on clique la valeur —
//     « je souhaite que les bandes déroulantes restent ; permettre
//     aussi qu'on puisse utiliser la bande déroulante ». La liste du
//     jour s'adapte au mois choisi (février = 28/29), celle de l'année
//     respecte la plage du champ ; + lieu de naissance (texte)
//   - Catégorie — liste déroulante IO | IA | IS | IAS
//   - Classe — liste déroulante des 4 valeurs administratives du
//     fonctionnaire (précisions utilisateur, sessions 12-13) :
//     « 1 », « 2 », « E » (Exceptionnelle notée E), « P » (Principale
//     notée P). Consigne session 13 : ÉCRIRE SEULEMENT 1 · 2 · E · P
//     dans la liste. Stockage inchangé : classe_grade 1..4 (1=1, 2=2,
//     3=E, 4=P) — backend, validation 1..4 et base Neon préservés ;
//     le libellé court est restitué à l'écran ET dans l'État nominatif
//     via CLASSE_GRADE_LABELS.
//   - Date d'entrée à la F.P — JJ / MM / AAAA clavier OU liste déroulante (v11)
//   - Fonction — liste déroulante DIRECTEUR | ADJOINT(E)
//   - COURS — liste déroulante PS | MS | GS | CP1 | CP2 | CE1 | CE2 |
//     CM1 | CM2 | RPL | MAC (plage « COURS » à 11 items demandée —
//     maternelle ajoutée à la demande utilisateur pour les directeurs
//     et adjoints des écoles maternelles ; prime sur la classe affectée
//     du module Classes dans la colonne COURS de l'État nominatif)
//   - Date d'entrée DREN — JJ / MM / AAAA clavier OU liste déroulante (v11)
//   - Entrée à l'IEP — JJ / MM / AAAA clavier OU liste déroulante (v11)
//   - DATE D'ARRIVÉE AU POSTE — JJ / MM / AAAA clavier OU liste déroulante (v11)
//     (en dessous de l'entrée DREN — DISTINCTE des entrées F.P / DREN /
//     IEP : jour d'arrivée sur le poste actuel, colonne « Arrivée au
//     poste » de l'État nominatif — demande utilisateur)
//   - Effectif — F | G (T = F + G CALCULÉ automatiquement — v9)
//   - Redoublants — F | G (T = F + G calculé — v9)
//   - Sexe — liste déroulante F | G
//
// CONFUSION DES DATES (demande utilisateur) : la date de NAISSANCE et
// les dates D'ENTRÉE (F.P / DREN / IEP) sont des dates DIFFÉRENTES —
// le formulaire les isole visuellement en DEUX groupes titrés (boxed),
// chaque date restant explicitement libellée, avec la plage d'années
// en précision sous le trio. Un duo jour/mois impossible (ex : 31/02)
// n'est jamais émis — un message local le signale au lieu de laisser
// le backend rejeter la sauvegarde entière (« date invalide »).
//
// Le dossier part entier à chaque enregistrement (sémantique « mise à
// jour complète » du backend — un champ vide efface la valeur stockée).

import { useState } from "react";
import {
  type LucideIcon,
  Cake,
  CalendarDays,
  IdCard,
  ChevronsUpDown,
} from "lucide-react";

import type { PersonnelDossier } from "@/lib/types";
import type { CoursCode } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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

const GRADES = [1, 2, 3, 4];

/** Les 4 valeurs administratives de la CLASSE du fonctionnaire :
 *  1 | 2 | E (Exceptionnelle notée E) | P (Principale notée P).
 *  Consigne utilisateur (session 13) : la liste déroulante porte
 *  SEULEMENT « 1 », « 2 », « E », « P ». La clé reste l'entier stocké
 *  en base (classe_grade 1..4) ; le libellé court figure dans la
 *  liste déroulante ET dans la colonne CLASSE de l'État nominatif. */
export const CLASSE_GRADE_LABELS: Record<number, string> = {
  1: "1",
  2: "2",
  3: "E",
  4: "P",
};

/** Les 11 items de la plage « COURS » (bande déroulante demandée —
 *  ordre pédagogique : maternelle PS · MS · GS puis classes CP1 → CM2
 *  et les deux affectations particulières RPL et MAC).
 *  Clé = valeur stockée en base. */
export const COURS_OPTIONS: CoursCode[] = [
  "PS", "MS", "GS", "CP1", "CP2", "CE1", "CE2", "CM1", "CM2", "RPL", "MAC",
];

/** Bornes d'années des plages de saisie (v10 — champs JJ/MM/AAAA) :
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
  // L'ISO est zéro-padé ("05") : dé-pader pour un affichage naturel
  // dans les champs de saisie (5 plutôt que 05).
  const unpad = (s: string) => (s ? String(Number(s)) : "");
  return { y: y || "", m: unpad(m), d: unpad(d) };
}

/** Nombre de jours d'un mois (m : 1..12, y : année — bissextile gérée).
 *  Sert à refuser les dates inexistantes (ex : 31/02) que le backend
 *  rejetterait en bloc (« date invalide »). */
function daysInMonth(m: number, y: number): number {
  return new Date(y, m, 0).getDate();
}

/** v11 — LA LISTE DÉROULANTE d'un segment de date (JJ, MM ou AAAA),
 *  rendue à la demande : « je souhaite que les bandes déroulantes
 *  restent ; permettre aussi qu'on puisse utiliser la bande
 *  déroulante ». Chaque segment du trio garde SA SAISIE CLAVIER et
 *  reçoit EN PLUS un chevron qui ouvre la liste scrollable — les deux
 *  modes cohabitent (le champ reste maître, la liste ne fait que
 *  remplir la même valeur via le même set() et ses mêmes garde-fous).
 *  La liste est aussi filtrable à la frappe (ce sont des chiffres). */
function PartCombo({
  part,
  label,
  items,
  onPick,
}: {
  part: "d" | "m" | "y";
  label: string;
  items: string[];
  onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`${label} — ouvrir la liste déroulante`}
          disabled={items.length === 0}
          title={`${label} — choisir dans la liste`}
          className="h-7 w-6 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ChevronsUpDown className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-28 p-0" align="start">
        <Command
          filter={(itemValue, search) =>
            itemValue.includes(search) ? 1 : 0
          }
        >
          {/* Champ de filtre utile pour l'année (~87 valeurs) ; pour le
              jour et le mois (≤ 31 valeurs) la liste se parcourt telle
              quelle — bande déroulante classique. */}
          {part === "y" && (
            <CommandInput placeholder="Filtrer…" className="h-8" />
          )}
          <CommandList className="max-h-[220px]">
            <CommandEmpty>Aucune valeur.</CommandEmpty>
            <CommandGroup>
              {items.map((v) => (
                <CommandItem
                  key={v}
                  value={v}
                  onSelect={() => {
                    onPick(v);
                    setOpen(false);
                  }}
                >
                  <span className="w-full text-center font-mono text-xs">
                    {v}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Saisie de date en 3 champs JJ / MM / AAAA — LES DEUX MODES (v11,
 *  demande utilisateur : « je souhaite que les bandes déroulantes
 *  restent ; on pourra faire avec les deux exemples ; permettre aussi
 *  qu'on puisse utiliser la bande déroulante ») :
 *  - MODE CLAVIER (v10) : on ÉCRIT les chiffres (JJ/MM/AAAA), sans
 *    rien parcourir ;
 *  - MODE LISTE DÉROULANTE : chaque segment a SON chevron qui ouvre
 *    une liste scrollable — jour (adapté au mois : février = 28/29),
 *    mois (01-12), année (plage du champ) — on clique, la valeur se
 *    remplit par le même set() et ses mêmes garde-fous.
 *  ISO vaut "YYYY-MM-DD…" (API) ou null ; la date n'est posée que si les
 *  3 parties sont saisies ET forment une date réelle — un duo
 *  jour/mois impossible (ex : 31/02) n'est JAMAIS émis : un message
 *  local le signale et la valeur du dossier reste inchangée, au lieu de
 *  voir la sauvegarde entière rejetée par le backend « date invalide ».
 *  Garde-fous de saisie : chiffres seuls, mois 01-12, jour existant
 *  pour le mois (bissextile géré), année dans la plage du champ
 *  (naissance 1940 → année courante ; entrées 1960 → année courante).
 *
 *  ⚠ Les 3 parties vivent dans un ÉTAT LOCAL initialisé depuis l'ISO :
 *  chaque champ garde sa saisie pendant qu'on complète les deux autres.
 *  (Version initiale : les parties dérivées directement de la prop iso —
 *  la saisie partielle était écrasée par le re-render parent dès le
 *  premier champ complété, les champs semblaient « ne pas fonctionner ».)
 *  L'ISO n'est émis au dossier que lorsque les 3 parties sont réunies et
 *  valides. Le dialog démonte son contenu à la fermeture : chaque
 *  ouverture réinitialise proprement les parties depuis la valeur
 *  enregistrée.
 *
 *  `hint` — précision affichée sous le trio (plage d'années, sens de la
 *  date). Naissance et dates d'entrée (F.P / DREN / IEP) étant DES
 *  DATES DIFFÉRENTES (demande utilisateur), chaque date reste
 *  explicitement libellée et regroupée dans sa section titrée. */
function DateInputs({
  id,
  label,
  iso,
  years,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  iso: string | null | undefined;
  years: number[];
  hint?: string;
  onChange: (iso: string | null) => void;
}) {
  const [parts, setParts] = useState<IsoParts>(() => parseIsoParts(iso));

  // Plage d'années autorisée (bornes de la liste fournie au champ).
  const minYear = years.length ? Math.min(...years) : 1900;
  const maxYear = years.length ? Math.max(...years) : 2100;

  const set = (part: keyof IsoParts, raw: string) => {
    // Chiffres seuls, longueur bornée (2 chiffres jour/mois, 4 l'année) —
    // la saisie au clavier remplace la sélection dans une liste.
    const v = raw.replace(/\D/g, "").slice(0, part === "y" ? 4 : 2);
    const next = { ...parts, [part]: v };
    setParts(next);
    // La date n'est émise que si les 3 parties sont réunies ET
    // cohérentes : mois 1-12, année dans la plage, jour existant dans
    // le mois choisi (février 29/30/31, mois à 30 jours…). Sinon →
    // null (valeur non posée).
    const m = Number(next.m);
    const y = Number(next.y);
    const complete = next.d !== "" && next.m !== "" && next.y.length === 4;
    const monthOk = next.m !== "" && m >= 1 && m <= 12;
    const yearOk = next.y.length === 4 && y >= minYear && y <= maxYear;
    const validDay =
      monthOk && yearOk && Number(next.d) >= 1 &&
      Number(next.d) <= daysInMonth(m, y);
    onChange(
      complete && monthOk && yearOk && validDay
        ? `${next.y}-${next.m.padStart(2, "0")}-${next.d.padStart(2, "0")}`
        : null,
    );
  };
  const cell = "h-8 w-full text-xs px-2 text-center";
  const mOk = parts.m !== "" && Number(parts.m) >= 1 && Number(parts.m) <= 12;
  const yOk =
    parts.y.length === 4 &&
    Number(parts.y) >= minYear &&
    Number(parts.y) <= maxYear;
  const invalidDay =
    mOk && yOk && parts.d !== "" &&
    Number(parts.d) > daysInMonth(Number(parts.m), Number(parts.y));
  const monthOut = parts.m !== "" && !mOk;
  const yearOut = parts.y.length === 4 && !yOk;
  const error = monthOut
    ? "Le mois est entre 01 et 12."
    : yearOut
      ? `Année hors plage (${minYear} → ${maxYear}).`
      : invalidDay
        ? "Ce jour n'existe pas pour ce mois — corrigez le jour ou le mois."
        : null;
  // Listes déroulantes des segments (v11) :
  //  - jour : 1..31, ou borné au mois choisi quand il est valide
  //    (février 28/29, mois à 30…) — impossible de choisir 31/02 ;
  //  - mois : 01..12 ;
  //  - année : la plage du champ (décroissante — la plus récente en tête).
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const maxDay =
    mOk && yOk
      ? daysInMonth(Number(parts.m), Number(parts.y))
      : mOk
        ? daysInMonth(Number(parts.m), 2001)
        : 31;
  const dayItems = Array.from({ length: maxDay }, (_, i) => pad2(i + 1));
  const monthItems = Array.from({ length: 12 }, (_, i) => pad2(i + 1));
  const yearItems = years.map(String);
  return (
    <div className="space-y-1 min-w-0">
      <Label htmlFor={id} className="text-[11px] leading-tight block">
        {label}
      </Label>
      <div className="flex gap-1.5" id={id}>
        <div className="flex-1 min-w-0 flex items-center gap-0.5">
          <Input
            aria-label={`${label} — jour`}
            inputMode="numeric"
            placeholder="JJ"
            className={cell}
            value={parts.d}
            onChange={(e) => set("d", e.target.value)}
          />
          <PartCombo
            part="d"
            label="Jour"
            items={dayItems}
            onPick={(v) => set("d", v)}
          />
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-0.5">
          <Input
            aria-label={`${label} — mois`}
            inputMode="numeric"
            placeholder="MM"
            className={cell}
            value={parts.m}
            onChange={(e) => set("m", e.target.value)}
          />
          <PartCombo
            part="m"
            label="Mois"
            items={monthItems}
            onPick={(v) => set("m", v)}
          />
        </div>
        <div className="flex-[1.3] min-w-0 flex items-center gap-0.5">
          <Input
            aria-label={`${label} — année`}
            inputMode="numeric"
            placeholder="AAAA"
            className={cell}
            value={parts.y}
            onChange={(e) => set("y", e.target.value)}
          />
          <PartCombo
            part="y"
            label="Année"
            items={yearItems}
            onPick={(v) => set("y", v)}
          />
        </div>
      </div>
      {error ? (
        <p className="text-[10px] text-destructive leading-tight">{error}</p>
      ) : hint ? (
        <p className="text-[10px] text-muted-foreground leading-tight">{hint}</p>
      ) : null}
    </div>
  );
}

/** v9 — TOTAL AUTOMATIQUE (demande utilisateur : « le calcul des totaux
 *  peut être automatique ») : T = F + G. F et G vides → T vide ; sinon
 *  la somme des valeurs saisies (0 pour un champ vide). */
export function fgtTotal(
  f: number | null | undefined,
  g: number | null | undefined,
): number | null {
  if (f == null && g == null) return null;
  return (f ?? 0) + (g ?? 0);
}

/** Deux saisies numériques F / G + TOTAL T CALCULÉ en lecture seule
 *  (effectif ou redoublants du cours) — le total suit les saisies en
 *  temps réel et n'est plus éditable (plus d'incohérence F+G ≠ T). */
function FGTInputs({
  label,
  f,
  g,
  onF,
  onG,
}: {
  label: string;
  f: number | null | undefined;
  g: number | null | undefined;
  onF: (v: number | null) => void;
  onG: (v: number | null) => void;
}) {
  const t = fgtTotal(f, g);
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
        {/* T — AUTOMATIQUE (F + G) : lecture seule, style atténué. */}
        <div className="flex-1 min-w-0">
          <Input
            type="number"
            aria-label={`${label} T (automatique : F + G)`}
            value={t ?? ""}
            readOnly
            tabIndex={-1}
            title="Automatique : F + G"
            placeholder="—"
            className="h-8 text-xs px-2 w-full bg-muted/50 text-muted-foreground cursor-default"
          />
        </div>
      </div>
      <div className="flex gap-1.5 text-[10px] text-muted-foreground text-center">
        <span className="flex-1">F</span>
        <span className="flex-1">G</span>
        <span className="flex-1" title="Total automatique : F + G">
          T = F + G
        </span>
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

      {/* === NAISSANCE — groupe DISTINCT des dates d'entrée (demande
          utilisateur : « les dates de naissance sont différentes des
          dates d'entrée à la FP et à l'IEP ») === */}
      <div className="rounded-md border bg-background p-2.5 space-y-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Cake className="w-3.5 h-3.5" />
          Naissance de l&apos;agent
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <DateInputs
            id="pers-naissance"
            label="Date de naissance (Jour · Mois · Année)"
            iso={value.date_naissance}
            years={birthYears}
            hint="Date de NAISSANCE — années 1940 → aujourd'hui"
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
                <SelectLabel>Classe (1 · 2 · E · P)</SelectLabel>
                <SelectItem value={UNSET}>—</SelectItem>
                {GRADES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {CLASSE_GRADE_LABELS[n]}
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

      {/* === DATES D'ENTRÉE — groupe DISTINCT de la naissance : les trois
          dates sont différentes entre elles (F.P = entrée dans la
          Fonction publique ≠ DREN ≠ IEP = arrivée dans l'inspection) —
          demande utilisateur (lever la confusion du formulaire). === */}
      <div className="rounded-md border bg-background p-2.5 space-y-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarDays className="w-3.5 h-3.5" />
          Dates d&apos;entrée de l&apos;agent — distinctes de la naissance
        </div>
        <DateInputs
          id="pers-fp"
          label="Date d'entrée à la F.P (Jour · Mois · Année)"
          iso={value.date_entree_fp}
          years={entryYears}
          hint="Entrée dans la FONCTION PUBLIQUE — années 1960 → aujourd'hui"
          onChange={(iso) => onChange({ ...value, date_entree_fp: iso })}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <DateInputs
            id="pers-dren"
            label="Date d'entrée DREN (Jour · Mois · Année)"
            iso={value.date_entree_dren}
            years={entryYears}
            hint="Entrée à la DREN — années 1960 → aujourd'hui"
            onChange={(iso) => onChange({ ...value, date_entree_dren: iso })}
          />
          <DateInputs
            id="pers-iep"
            label="Entrée à l'IEP (Jour · Mois · Année)"
            iso={value.date_entree_iep}
            years={entryYears}
            hint="Arrivée dans l'INSPECTION (IEP) — années 1960 → aujourd'hui"
            onChange={(iso) => onChange({ ...value, date_entree_iep: iso })}
          />
        </div>
        {/* ARRIVÉE AU POSTE — en dessous de l'entrée DREN (demande
            utilisateur) : 4e date du dossier, distincte des trois
            entrées — alimente la colonne « Arrivée au poste » de
            l'État nominatif. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <DateInputs
            id="pers-arrivee-poste"
            label="Date d'arrivée au poste (Jour · Mois · Année)"
            iso={value.date_arrivee_poste}
            years={entryYears}
            hint="Arrivée sur le POSTE actuel (école) — après les entrées F.P / DREN / IEP"
            onChange={(iso) => onChange({ ...value, date_arrivee_poste: iso })}
          />
        </div>
      </div>

      {/* COURS — plage demandée : bande déroulante des 11 cours tenus
          (maternelle PS · MS · GS puis CP1 → CM2 + RPL + MAC — même
          position que la colonne COURS du document : après les dates,
          avant les effectifs). */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className={field}>
          <Label className="text-[11px]">Cours</Label>
          <Select
            value={value.cours ?? UNSET}
            onValueChange={(v) =>
              onChange({ ...value, cours: v === UNSET ? null : (v as CoursCode) })
            }
          >
            <SelectTrigger className={small} aria-label="Cours tenu">
              <SelectValue placeholder="Choisir…" />
            </SelectTrigger>
            <SelectContent className="min-w-[8.5rem]">
              <SelectGroup>
                <SelectLabel>Cours (PS → CM2 · RPL · MAC)</SelectLabel>
                <SelectItem value={UNSET}>—</SelectItem>
                {COURS_OPTIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="hidden sm:block" />
      </div>

      {/* Effectif + Redoublants (F / G du document — T calculé automatiquement,
          v9 : « le calcul des totaux peut être automatique ») */}
      <div className="grid grid-cols-2 gap-2.5">
        <FGTInputs
          label="Effectif"
          f={value.effectif_f}
          g={value.effectif_g}
          onF={(v) =>
            onChange({ ...value, effectif_f: v, effectif_t: fgtTotal(v, value.effectif_g) })
          }
          onG={(v) =>
            onChange({ ...value, effectif_g: v, effectif_t: fgtTotal(value.effectif_f, v) })
          }
        />
        <FGTInputs
          label="Redoublants"
          f={value.redoublant_f}
          g={value.redoublant_g}
          onF={(v) =>
            onChange({ ...value, redoublant_f: v, redoublant_t: fgtTotal(v, value.redoublant_g) })
          }
          onG={(v) =>
            onChange({ ...value, redoublant_g: v, redoublant_t: fgtTotal(value.redoublant_f, v) })
          }
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
  cours?: CoursCode | null;
  date_entree_dren?: string | null;
  date_entree_iep?: string | null;
  date_arrivee_poste?: string | null;
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
    date_naissance: isoDate(u.date_naissance),
    lieu_naissance: u.lieu_naissance ?? null,
    categorie: u.categorie ?? null,
    classe_grade: u.classe_grade ?? null,
    echelon: u.echelon ?? null,
    date_entree_fp: isoDate(u.date_entree_fp),
    fonction: u.fonction ?? null,
    cours: u.cours ?? null,
    date_entree_dren: isoDate(u.date_entree_dren),
    date_entree_iep: isoDate(u.date_entree_iep),
    date_arrivee_poste: isoDate(u.date_arrivee_poste),
    effectif_f: u.effectif_f ?? null,
    effectif_g: u.effectif_g ?? null,
    // v9 — T CALCULÉ (F + G) : le dossier ouvert affiche le total exact
    // et l'enregistrement converge (plus d'incohérence F+G ≠ T stockée).
    effectif_t: fgtTotal(u.effectif_f, u.effectif_g),
    redoublant_f: u.redoublant_f ?? null,
    redoublant_g: u.redoublant_g ?? null,
    redoublant_t: fgtTotal(u.redoublant_f, u.redoublant_g), // v9 — T calculé
  };
}

/** Normalise une date renvoyée par l'API vers "YYYY-MM-DD".
 *  L'API sérialise les dates (time.Time) en horodatage RFC3339
 *  ("1996-03-16T00:00:00Z") : recopié tel quel dans le dossier, il
 *  repartait à la sauvegarde SANS être retouché par les listes
 *  Jour/Mois/Année et le backend le rejetait (« date invalide »).
 *  Le dossier ne porte donc QUE le format court — l'édition d'un
 *  agent existant enregistre sans toucher aux dates. */
function isoDate(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.length > 10 ? v.slice(0, 10) : v;
}

/** Le dossier contient-il au moins un champ renseigné ? */
export function hasPersonnelData(d: PersonnelDossier | null | undefined): boolean {
  if (!d) return false;
  return Object.values(d).some((v) => v !== null && v !== undefined && v !== "");
}
