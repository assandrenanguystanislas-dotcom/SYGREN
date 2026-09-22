"use client";

import { GraduationCap } from "lucide-react";
import { EntityCombobox, type ComboItem } from "@/components/entity-combobox";
import type { ClassWithDetails } from "@/lib/types";

/**
 * ClassCombobox (v11 — demande utilisateur) — même traitement HYBRIDE
 * que les écoles, appliqué AUX CLASSES : « étendre le même traitement
 * ailleurs ». La liste s'ouvre en bande déroulante scrollable ; la
 * saisie filtre par nom de classe (et par école d'appartenance quand
 * elle est affichée — utile à l'admin qui voit les classes de plusieurs
 * écoles). Insensible à la casse et aux accents.
 */
export function ClassCombobox({
  classes,
  value,
  onChange,
  id,
  disabled,
  placeholder = "Choisir une classe…",
  searchPlaceholder = "Taper pour filtrer… ou parcourir la liste",
  emptyText = "Aucune classe.",
  groupLabel = "Toutes les classes",
  withSchoolName = false,
  allowEmpty = false,
  emptyValue = "",
  emptyLabel = "Toutes les classes",
  className,
}: {
  classes: ClassWithDetails[];
  value: string;
  onChange: (classId: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  groupLabel?: string;
  /** Admin : affiche l'école à droite de chaque classe. */
  withSchoolName?: boolean;
  allowEmpty?: boolean;
  emptyValue?: string;
  emptyLabel?: string;
  className?: string;
}) {
  const items: ComboItem[] = classes.map((c) => ({
    value: c.id,
    label: c.name,
    // Recherche par école d'appartenance en bonus (nom ou code).
    keywords: withSchoolName ? (c.school_name ?? "") : undefined,
    right: withSchoolName ? (
      <span className="truncate max-w-[45%] text-[10px] text-muted-foreground shrink-0">
        {c.school_name ?? ""}
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
      searchPlaceholder={searchPlaceholder}
      emptyText={emptyText}
      groupLabel={groupLabel}
      icon={
        <GraduationCap className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      }
      allowEmpty={allowEmpty}
      emptyValue={emptyValue}
      emptyLabel={emptyLabel}
      className={className}
    />
  );
}
