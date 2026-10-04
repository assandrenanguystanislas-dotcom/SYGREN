"use client";

// Task 73 — hook partagé de SÉLECTION DE LIGNES (cases à cocher).
// Réutilisé par les vues en tableau (Fichier du personnel — Task 72,
// Élèves, Parents) pour cocher des lignes puis exporter ou supprimer
// la sélection en masse depuis la barre d'actions orange.
import { useEffect, useState } from "react";

export function useRowSelection(ids: string[], dataReady: boolean) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Hygiène de sélection : les lignes disparues du DERNIER chargement
  // réussi (suppression simple ou en masse, changement de filtre) sont
  // décochées automatiquement. Pendant un rechargement (dataReady =
  // false — data undefined pendant la requête), la sélection en cours
  // est préservée telle quelle.
  useEffect(() => {
    if (!dataReady) return;
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(ids);
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [dataReady, ids]);

  // État de la case « tout sélectionner » (en-tête) : tout coché /
  // partiel (indéterminé) / rien — calculé sur les lignes AFFICHÉES.
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const someSelected = !allSelected && selected.size > 0;

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Case « tout sélectionner » de l'en-tête : coche toutes les lignes
  // AFFICHÉES (recherche + filtres courants) ; re-clic = tout décocher.
  function toggleAllVisible() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(ids));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  return {
    selected,
    count: selected.size,
    allSelected,
    someSelected,
    toggleOne,
    toggleAllVisible,
    clearSelection,
  };
}

// Suppression en masse résiliente : DELETE ligne par ligne PAR LOTS de
// 25 requêtes en parallèle (une ligne déjà supprimée par ailleurs ne
// bloque pas les autres) ; renvoie le bilan succès / échecs.
export async function deleteRowsInBatches(
  ids: string[],
  del: (id: string) => Promise<unknown>,
  batchSize = 25,
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += batchSize) {
    const results = await Promise.allSettled(
      ids.slice(i, i + batchSize).map((id) => del(id)),
    );
    for (const r of results) {
      if (r.status === "fulfilled") ok += 1;
      else failed += 1;
    }
  }
  return { ok, failed };
}
