"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * EntityCombobox (v12 — demande utilisateur) : « POUR TOUTES LES
 * RECHERCHES IL SUFFIT DE CLIQUER DANS LE CHAMP DE RECHERCHE ET ECRIRE
 * LES TROIS PREMIERES LETTRES OBJET DE RECHERCHE POUR AVOIR L'ELEMENT.
 * ON N'A PAS BESOIN DE FAIRE DEFILER LE CURSEUR ».
 *
 * LE CHAMP EST LA RECHERCHE — un seul contrôle :
 * - on CLIQUE dans le champ : la liste s'ouvre en dessous, prête ;
 * - on TAPE directement les premières lettres (plus besoin d'ouvrir
 *   puis de recliquer dans un second champ, et plus besoin de faire
 *   défiler la liste à la molette) : le libellé sélectionné est
 *   pré-surligné, la première frappe le remplace ;
 * - filtrage insensible à la casse ET aux accents (É → e), chaque mot
 *   tapé doit se retrouver dans le libellé ou les mots-clés (code
 *   ministériel, école…), dans n'importe quel ordre ; les mots tapés
 *   en PRÉFIXE remontent en tête (« kou » → KOUAMÉ avant AKOUASSI) ;
 * - MODE BANDE DÉROULANTE conservé (v9/v11) : sans rien taper, la
 *   liste complète est là, défilable à la souris, comme avant ;
 * - clavier : ↑/↓ parcourent, Entrée choisit la ligne surlignée,
 *   Échap referme (et réaffiche la sélection), Tab referme.
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
  /** Libellé affiché dans le champ et la liste. */
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
  // (v11) gardé pour compatibilité des appelants : le champ de
  // recherche EST désormais le contrôle lui-même, plus de champ
  // interne à la liste.
  searchPlaceholder = "Taper pour filtrer…",
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
  /** Icône muette à gauche du libellé du champ. */
  icon?: ReactNode;
  /** Filtres : ajoute une entrée « Tous / Toutes… » de valeur emptyValue. */
  allowEmpty?: boolean;
  emptyValue?: string;
  emptyLabel?: string;
  className?: string;
  listMaxH?: string;
}) {
  const [open, setOpen] = useState(false);
  // null = rien tapé (le champ affiche le libellé sélectionné,
  // pré-surligné) ; string = filtre actif.
  const [typed, setTyped] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = items.find((it) => it.value === value);
  const heading = groupLabel
    ? groupCount
      ? `${groupLabel} (${items.length})`
      : groupLabel
    : undefined;

  // La ligne « Tous / — Aucun — » participe au filtre comme les autres.
  const allItems: ComboItem[] = useMemo(
    () =>
      allowEmpty
        ? [{ value: emptyValue, label: emptyLabel }, ...items]
        : items,
    [allowEmpty, emptyValue, emptyLabel, items],
  );

  const filtered = useMemo(() => {
    const q = norm(typed ?? "").replace(/\s+/g, " ").trim();
    if (!q) return allItems;
    const words = q.split(" ").filter(Boolean);
    if (words.length === 0) return allItems;
    const scored: Array<{ it: ComboItem; s: number }> = [];
    for (const it of allItems) {
      const hay = norm(`${it.label} ${it.keywords ?? ""}`)
        .replace(/\s+/g, " ")
        .trim();
      let ok = true;
      let prefix = true;
      for (const w of words) {
        const at = hay.indexOf(w);
        if (at < 0) {
          ok = false;
          break;
        }
        // Préfixe de mot : début de chaîne ou juste après un espace.
        if (at !== 0 && hay[at - 1] !== " ") prefix = false;
      }
      if (ok) scored.push({ it, s: prefix ? 0 : 1 });
    }
    return scored.sort((a, b) => a.s - b.s).map((x) => x.it);
  }, [allItems, typed]);

  // Nouvelle frappe / ouverture : la navigation repart du haut.
  useEffect(() => {
    setActive(0);
  }, [typed, open]);

  // Fermeture : la frappe en cours est jetée (le champ réaffiche la sélection).
  useEffect(() => {
    if (!open) setTyped(null);
  }, [open]);

  // La ligne surlignée reste visible sans que l'utilisateur ne cherche.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      listRef.current
        ?.querySelector(`[data-idx="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [active, open]);

  function commit(it: ComboItem) {
    onChange(it.value);
    setOpen(false);
    setTyped(null);
  }

  function move(dir: 1 | -1) {
    if (filtered.length === 0) return;
    setActive((a) => {
      let i = a;
      for (let n = 0; n < filtered.length; n++) {
        i = (i + dir + filtered.length) % filtered.length;
        if (filtered[i] && !filtered[i].disabled) break;
      }
      return i;
    });
  }

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            {icon && (
              <span className="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2 items-center">
                {icon}
              </span>
            )}
            <input
              ref={inputRef}
              id={id}
              type="text"
              role="combobox"
              aria-expanded={open}
              autoComplete="off"
              disabled={disabled}
              className={cn(
                "flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none",
                "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
                "pr-8",
                icon && "pl-8",
              )}
              value={
                open ? (typed ?? selected?.label ?? "") : selected?.label ?? ""
              }
              placeholder={placeholder}
              onFocus={() => {
                if (!disabled && !open) setOpen(true);
                // Tout sélectionner : la première frappe REMPLACE le
                // libellé (comme un champ d'adresse e-mail).
                setTimeout(() => inputRef.current?.select(), 0);
              }}
              onChange={(e) => {
                setTyped(e.target.value);
                if (!open) setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!open) {
                    setOpen(true);
                    return;
                  }
                  move(e.key === "ArrowDown" ? 1 : -1);
                } else if (e.key === "Enter") {
                  // Jamais de submit du formulaire porteur depuis ce champ.
                  e.preventDefault();
                  if (open) {
                    const it = filtered[active];
                    if (it && !it.disabled) commit(it);
                  }
                } else if (e.key === "Escape") {
                  if (open) {
                    e.preventDefault();
                    setOpen(false);
                    setTyped(null);
                  }
                } else if (e.key === "Tab") {
                  setOpen(false);
                }
              }}
            />
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // Un clic dans le champ (l'ancre) ne referme jamais la
            // liste ; partout ailleurs le comportement Radix s'applique.
            const t = e.target as Node | null;
            if (t && rootRef.current?.contains(t)) e.preventDefault();
          }}
        >
          <div
            ref={listRef}
            role="listbox"
            className={cn("overflow-y-auto overscroll-contain p-1", listMaxH)}
          >
            {heading && (
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {heading}
              </div>
            )}
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {emptyText}
              </div>
            ) : (
              filtered.map((it, i) => {
                const isEmptyRow = allowEmpty && it.value === emptyValue;
                return (
                  <button
                    key={`${it.value}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={it.value === value}
                    data-idx={i}
                    disabled={it.disabled}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      // mousedown (et non click) : choisit AVANT le blur
                      // du champ — aucun raté de sélection au clic.
                      e.preventDefault();
                      if (!it.disabled) commit(it);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                      i === active &&
                        !it.disabled &&
                        "bg-accent text-accent-foreground",
                      it.disabled && "pointer-events-none opacity-50",
                    )}
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        it.value === value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        isEmptyRow && "font-medium",
                      )}
                    >
                      {it.label}
                    </span>
                    {it.right}
                  </button>
                );
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
