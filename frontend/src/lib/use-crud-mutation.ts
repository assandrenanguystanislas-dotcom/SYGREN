"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ApiException } from "@/lib/api";

interface UseCrudMutationOptions {
  /** Clé de cache React Query à invalider après mutation */
  invalidateKeys: unknown[][];
  /** Message de succès */
  successMessage: string;
  /** Verbe pour le message d'erreur */
  actionLabel: string;
}

/**
 * Hook générique pour exécuter une mutation CRUD (create/update/delete)
 * avec gestion automatique des toasts et de l'invalidation du cache.
 */
export function useCrudMutation<TArgs extends unknown[], TResult>(
  mutationFn: (...args: TArgs) => Promise<TResult>,
  options: UseCrudMutationOptions,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      toast.success(options.successMessage);
      // Invalide toutes les clés spécifiées pour forcer le rechargement
      await Promise.all(
        options.invalidateKeys.map((key) =>
          queryClient.invalidateQueries({ queryKey: key }),
        ),
      );
    },
    onError: (error) => {
      const message =
        error instanceof ApiException
          ? error.message
          : "Erreur inattendue";
      toast.error(`${options.actionLabel} échoué(e)`, { description: message });
    },
  });
}
