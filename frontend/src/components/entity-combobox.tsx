"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * EntityCombobox (v11 — demande utilisateur) — LE contrôle de sélection
 * à DEUX MODES, né de la consigne : « je souhaite que les bandes
 * déroulantes restent ; on pourra faire avec les deux exemples ;
 * permettre aussi qu'on puisse utiliser la bande déroulante ; étendre
 * le même traitement ailleurs ».
 *
 * MODE 1 — LA BANDE DÉROULANTE : le bouton (chevron) ouvre la liste
 * COMPLÈTE, immédiatement scrollable à la souris/molette, comme un
 * <Select> classique. Rien à taper : on parcourt, on clique.
 *
 * MODE 2 — LA SAISIE : le champ en haut filtre la liste au fil des
 * lettres du libellé (insensible à la casse et aux accents, É → e) et
 * des CHIFFRES (mots-clés : code ministériel de l'école…).
 *
 * Un seul contrôle remplace donc l'ancien <Select> ET l'autocomplétion
 * (v9) : « les deux exemples » cohabitent. Utilisé pour les écoles
 * (~100 entrées), les classes, et toute liste trop longue pour un
 * parcours à l'œil.
 */

/** Minuscule + suppression des diacritiques (comparaison É = e). */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export type ComboItem = {
  /** Valeur émise par onChange (id, code…). */
  value: string;
  /** Libellé affiché dans le bouton et la liste. */
  label: string;
  /** Texte de recherche additionnel (ex : code ministériel). */
  keywords?: string;
  /** Détail aligné à droite de la ligne (code, effectif…). */
  right?: ReactNode;
  /** Ligne visible mais non sélectionnable (ex : classe exemptée). */
  disabled?: boolean;
};

export function EntityCombobox({
  items,
  value,
  onChange,
  id,
  disabled,
  placeholder = "Choisir…",
  searchPlaceholder = "Taper pour filtrer… ou parcourir la liste",
  emptyText = "Aucun résultat.",
  groupLabel,
  groupCount = true,
  icon,
  allowEmpty = false,
  emptyValue = "",
  emptyLabel = "Tous",
  className,
  listMaxH = "max-h-[340px]",
}: {
  items: ComboItem[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Titre du groupe en tête de liste, ex : « Toutes les écoles (97) ». */
  groupLabel?: string;
  groupCount?: boolean;
  /** Icône muette à gauche du libellé du bouton. */
  icon?: ReactNode;
  /** Filtres : ajoute une entrée « Tous / Toutes… » de valeur emptyValue. */
  allowEmpty?: boolean;
  emptyValue?: string;
  emptyLabel?: string;
  className?: string;
  listMaxH?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((it) => it.value === value);
  const isEmptyValue = value === emptyValue;
  const heading = groupLabel
    ? groupCount
      ? `${groupLabel} (${items.length})`
      : groupLabel
    : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal h-9 px-3",
            className,
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            {icon}
            <span className="truncate">
              {selected ? selected.label : placeholder}
            </span>
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
        align="start"
      >
        <Command
          filter={(itemValue, search) =>
            norm(itemValue).includes(norm(search)) ? 1 : 0
          }
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className={listMaxH}>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup heading={heading}>
              {allowEmpty && (
                <CommandItem
                  value={emptyLabel}
                  onSelect={() => {
                    onChange(emptyValue);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check
                    className={
                      isEmptyValue
                        ? "h-4 w-4 shrink-0"
                        : "h-4 w-4 shrink-0 opacity-0"
                    }
                  />
                  <span className="flex-1 font-medium">{emptyLabel}</span>
                </CommandItem>
              )}
              {items.map((it) => (
                <CommandItem
                  key={it.value}
                  // value élargi au filtre cmdk : libellé + mots-clés →
                  // la saisie de lettres OU de chiffres retrouve la ligne.
                  value={`${it.label} ${it.keywords ?? ""}`}
                  onSelect={
                    it.disabled ? undefined : () => {
                      onChange(it.value);
                      setOpen(false);
                    }
                  }
                  disabled={it.disabled}
                  className="gap-2"
                >
                  <Check
                    className={
                      it.value === value && !isEmptyValue
                        ? "h-4 w-4 shrink-0"
                        : "h-4 w-4 shrink-0 opacity-0"
                    }
                  />
                  <span className="truncate flex-1">{it.label}</span>
                  {it.right}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {/* Rappel des deux modes — la liste reste utilisable SANS rien
            taper (molette), la saisie n'est qu'un raccourci. */}
        <p className="border-t px-3 py-2 text-[10px] leading-tight text-muted-foreground">
          Parcourez la liste à la souris, ou tapez les premières lettres /
          chiffres pour filtrer.
        </p>
      </PopoverContent>
    </Popover>
  );
}
