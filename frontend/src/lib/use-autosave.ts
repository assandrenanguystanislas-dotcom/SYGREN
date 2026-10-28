"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { gradesApi } from "@/lib/api";
import type { Grade } from "@/lib/types";

// Clé de cellule : `${studentId}:${subjectId}`
type CellKey = string;

// Snapshot des modifications en attente : studentId+subjectId → valeur
type PendingGrades = Record<CellKey, { student_id: string; subject_id: string; value: number }>;

// États possibles de l'auto-save
export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

interface UseAutoSaveOptions {
  sessionId: string;
  // Délai avant déclenchement de la sauvegarde (ms)
  debounceMs?: number;
}

/**
 * Hook d'auto-save pour la grille de saisie des notes.
 *
 * Cahier des charges §3 Module 2 :
 *   « Sauvegarde temporaire : Mode brouillon automatique pour prévenir
 *    la perte de données en cas de coupure de connexion. »
 *
 * Stratégie :
 *   1. L'utilisateur tape dans une cellule → la valeur est stockée en local
 *      ET exposée via `pending` — la grille calcule la moyenne AU FUR ET À
 *      MESURE de la saisie (sans attendre la sauvegarde).
 *   2. Un debounce attend la fin de la frappe (800ms par défaut)
 *   3. Toutes les cellules modifiées sont envoyées en une seule requête bulk ;
 *      la réponse renvoie les notes TELLES QU'ENREGISTRÉES (avec leurs ID) →
 *      elles sont fusionnées dans le cache React Query : la moyenne reste
 *      exacte sans rechargement ni clignotement.
 *   4. En cas d'échec, les modifications restent en attente (retry au prochain cycle)
 */
export function useAutoSave({ sessionId, debounceMs = 800 }: UseAutoSaveOptions) {
  const [pending, setPending] = useState<PendingGrades>({});
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedCount, setLastSavedCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const queryClient = useQueryClient();

  // Ajoute une modification en attente et programme l'auto-save
  const updateCell = useCallback(
    (studentId: string, subjectId: string, value: number) => {
      const key = `${studentId}:${subjectId}`;
      setPending((prev) => ({
        ...prev,
        [key]: { student_id: studentId, subject_id: subjectId, value },
      }));
      setStatus("pending");
    },
    [],
  );

  // Retire une modification en attente — « effacer complètement la note »
  // quand elle n'a pas encore été sauvegardée (cellule vidée avant flush).
  const discardCell = useCallback((studentId: string, subjectId: string) => {
    const key = `${studentId}:${subjectId}`;
    setPending((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Vide TOUTES les modifications en attente (après une suppression en masse
  // côté serveur — les valeurs locales n'ont plus de raison d'exister).
  const clearPending = useCallback(() => {
    setPending({});
    setStatus("idle");
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Retour à « à jour » quand il ne reste plus aucune modification en attente
  useEffect(() => {
    if (Object.keys(pending).length === 0) {
      setStatus((s) => (s === "pending" ? "idle" : s));
    }
  }, [pending]);

  // Changement de session : les valeurs en attente appartiennent à l'ANCIENNE
  // session — on les abandonne (la vue tente un flush avant le basculement ;
  // une valeur non sauvegardée ne doit jamais fuir vers une autre session,
  // ni dans la moyenne ni dans la prochaine sauvegarde automatique).
  const prevSessionRef = useRef(sessionId);
  useEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId;
      setPending({});
      setStatus("idle");
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [sessionId]);

  // Force une sauvegarde immédiate (utile quand l'utilisateur quitte la page)
  const flush = useCallback(async () => {
    if (isSavingRef.current) return;
    setPending((current) => {
      void saveNow(current);
      return current;
    });
    // saveNow est appelé via la fonction ci-dessus
    async function saveNow(current: PendingGrades) {
      const items = Object.values(current);
      if (items.length === 0 || !sessionId) return;
      isSavingRef.current = true;
      setStatus("saving");
      try {
        const result = await gradesApi.bulkUpsert({
          session_id: sessionId,
          grades: items,
        });
        setLastSavedCount(result.created + result.updated);
        setStatus("saved");

        // Fusion des notes sauvegardées (ID réels renvoyés par le serveur)
        // dans le cache React Query — la moyenne de la grille (lecture
        // pending → cache) reste juste sans refetch ni clignotement.
        const savedGrades = result.grades ?? [];
        if (savedGrades.length > 0) {
          queryClient.setQueryData<{ grades: Grade[]; count: number }>(
            ["grades", sessionId],
            (old) => {
              if (!old) return old;
              const byId = new Map(old.grades.map((g) => [g.id, g]));
              for (const g of savedGrades) {
                // Remplacer l'éventuel doublon (même élève + matière + session,
                // ex : ligne créée entre-temps) pour éviter les entrées jumelles
                const dup = old.grades.find(
                  (o) =>
                    o.id !== g.id &&
                    o.student_id === g.student_id &&
                    o.subject_id === g.subject_id &&
                    o.session_id === g.session_id,
                );
                if (dup) byId.delete(dup.id);
                byId.set(g.id, g);
              }
              const grades = Array.from(byId.values());
              return { ...old, grades, count: grades.length };
            },
          );
        }

        // Vider les modifications envoyées (mais garder celles qui auraient pu
        // être ajoutées pendant la requête)
        setPending((prev) => {
          const next = { ...prev };
          for (const item of items) {
            const key = `${item.student_id}:${item.subject_id}`;
            // Ne supprimer que si la valeur n'a pas été modifiée pendant la requête
            if (next[key]?.value === item.value) {
              delete next[key];
            }
          }
          return next;
        });
        // Effacer le badge "saved" après 2s si rien de nouveau
        setTimeout(() => {
          setStatus((s) => (s === "saved" ? "idle" : s));
        }, 2000);
      } catch (e) {
        setStatus("error");
        toast.error("Échec de la sauvegarde automatique", {
          description:
            e instanceof Error
              ? e.message
              : "Vos modifications sont conservées, nouvel essai…",
        });
      } finally {
        isSavingRef.current = false;
      }
    }
  }, [sessionId, queryClient]);

  // Debounce : à chaque modification, on reprogramme le timer
  useEffect(() => {
    if (Object.keys(pending).length === 0) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flush();
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pending, debounceMs, flush]);

  // Sauvegarde finale quand l'utilisateur quitte la page ou change de session
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Tentative de flush synchrone (au cas où, mais pas garanti)
      void flush();
    };
  }, [flush]);

  return {
    updateCell,
    discardCell,
    clearPending,
    flush,
    status,
    pendingCount: Object.keys(pending).length,
    /** Modifications en attente (frappe en cours) — la grille les fusionne
     *  avec les notes en base pour une moyenne mise à jour en direct. */
    pending,
    lastSavedCount,
  };
}

// Construit une map de lookup des notes existantes : studentId+subjectId → Grade
export function buildGradesMap(grades: Grade[]): Record<CellKey, Grade> {
  const map: Record<CellKey, Grade> = {};
  for (const g of grades) {
    map[`${g.student_id}:${g.subject_id}`] = g;
  }
  return map;
}
