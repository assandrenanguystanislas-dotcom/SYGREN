"use client";

import { School } from "lucide-react";
import { EntityCombobox, type ComboItem } from "@/components/entity-combobox";
import type { SchoolWithStats } from "@/lib/types";

/**
 * SchoolCombobox (v9 puis v11 — demandes utilisateur) — sélecteur d'école
 * HYBRIDE : « je souhaite que les bandes déroulantes restent ; on pourra
 * faire avec les deux exemples ; permettre aussi qu'on puisse utiliser la
 * bande déroulante ».
 *
 * - MODE BANDE DÉROULANTE : le bouton ouvre la liste COMPLÈTE (~100
 *   écoles), scrollable à la souris, comme l'ancien <Select> ;
 * - MODE SAISIE (v9) : « on pourra écrire les premières lettres ou les
 *   chiffres et le nom voulu apparaît » — les lettres filtrent le NOM,
 *   les chiffres filtrent le CODE ministériel ; insensible aux accents.
 *
 * Délègue au composant générique EntityCombobox (les deux modes) et
 * étend ce traitement à toutes les listes d'écoles de l'application.
 */
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
  const items: ComboItem[] = schools.map((s) => ({
    value: s.id,
    label: s.name,
    // La saisie de CHIFFRES retrouve l'école par son code ministériel.
    keywords: s.code ?? "",
    right: s.code ? (
      <span className="font-mono text-[10px] text-muted-foreground shrink-0">
        {s.code}
      </span>
    ) : undefined,
  }));

  return (
    <EntityCombobox
      items={items}
      value={value}
      onChange={onChange}
      id={id}
      disabled={disabled}
      placeholder={placeholder}
      searchPlaceholder="Premières lettres du nom ou code…"
      emptyText="Aucune école ne correspond."
      groupLabel="Toutes les écoles"
      icon={<School className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
    />
  );
}
