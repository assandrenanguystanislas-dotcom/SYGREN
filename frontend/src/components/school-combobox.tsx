import { useState } from "react";
import { Check, ChevronsUpDown, School } from "lucide-react";
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
import type { SchoolWithStats } from "@/lib/types";

/**
 * SchoolCombobox (v9 — demande utilisateur) — sélecteur d'école avec
 * AUTOCOMPLÉTION pour les formulaires « Modifier un directeur / adjoint » :
 * « on pourra écrire les premières lettres ou les chiffres et le nom voulu
 * apparaît ». Remplace le <Select> à ~124 entrées impossible à parcourir.
 *
 * - La saisie filtre au fil des lettres du NOM de l'école ;
 * - La saisie de CHIFFRES filtre par CODE ministériel de l'école ;
 * - Le filtre est insensible à la casse et aux accents (É → e).
 *
 * Basé sur cmdk (ui/command) + Popover — le même pattern que les combobox
 * shadcn/ui, sans dépendance supplémentaire.
 */

/** Minuscule + suppression des diacritiques (comparaison É = e). */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function SchoolCombobox({
  schools,
  value,
  onChange,
  id,
  disabled,
  placeholder = "Choisir une école…",
}: {
  schools: SchoolWithStats[];
  value: string;
  onChange: (schoolId: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = schools.find((s) => s.id === value);

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
          className="w-full justify-between font-normal h-9 px-3"
        >
          <span className="flex items-center gap-2 min-w-0">
            <School className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {selected
                ? selected.name
                : placeholder}
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
          <CommandInput placeholder="Premières lettres du nom ou code…" />
          <CommandList>
            <CommandEmpty>Aucune école ne correspond.</CommandEmpty>
            <CommandGroup>
              {schools.map((s) => (
                <CommandItem
                  key={s.id}
                  // value filtré par cmdk : nom + code → la saisie de
                  // chiffres retrouve l'école par son code ministériel.
                  value={`${s.name} ${s.code ?? ""}`}
                  onSelect={() => {
                    onChange(s.id);
                    setOpen(false);
                  }}
                  className="gap-2"
                >
                  <Check
                    className={
                      s.id === value
                        ? "h-4 w-4 shrink-0"
                        : "h-4 w-4 shrink-0 opacity-0"
                    }
                  />
                  <span className="truncate flex-1">{s.name}</span>
                  {s.code && (
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                      {s.code}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
