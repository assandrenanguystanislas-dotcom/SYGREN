"use client";

// Store d'authentification SYGREN (Zustand + persist).
//
// Gère :
// - le token JWT et le profil utilisateur
// - la persistance dans localStorage (survit au rafraîchissement)
// - l'hydratation au démarrage de l'app
// - la liste des modules accessibles (Architecture D — nav dynamique)
//
// Le token est lu par le client API (src/lib/api.ts) via la clé localStorage
// "sygren-auth" (format zustand-persist : { state: { token, user }, version }).

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "./types";
import { authApi } from "./api";

interface AuthState {
  token: string | null;
  user: User | null;
  loading: boolean;
  hydrated: boolean;
  mustChangePassword: boolean;
  // Architecture D — Liste des modules accessibles au user (pour nav dynamique)
  modules: string[];

  /** Tente une connexion et stocke le token. */
  login: (identifier: string, password: string) => Promise<User>;
  /** Déconnexion : purge le token et le profil. */
  logout: () => void;
  /** Recharge le profil depuis l'API (utile après rafraîchissement). */
  refreshUser: () => Promise<User | null>;
  /** Marque le store comme hydraté (appelé par useHydrateAuth). */
  setHydrated: (v: boolean) => void;
  /** Efface le flag mustChangePassword (après changement de mot de passe). */
  clearMustChangePassword: () => void;
  /** Architecture D — Recharge la liste des modules accessibles. */
  refreshModules: () => Promise<string[]>;
  /** Architecture D — Setter manuel (au login). */
  setModules: (mods: string[]) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      loading: false,
      hydrated: false,
      mustChangePassword: false,
      modules: [],

      login: async (identifier, password) => {
        set({ loading: true });
        try {
          const { token, user, must_change_password } = await authApi.login(identifier, password);
          set({ token, user, loading: false, mustChangePassword: must_change_password });
          // Fetch modules en arrière-plan (non bloquant)
          get().refreshModules().catch(() => {});
          return user;
        } catch (e) {
          set({ loading: false });
          throw e;
        }
      },

      logout: () => {
        set({ token: null, user: null, mustChangePassword: false, modules: [] });
      },

      refreshUser: async () => {
        const token = get().token;
        if (!token) return null;
        try {
          const user = await authApi.me();
          set({ user });
          // Refresh modules en arrière-plan
          get().refreshModules().catch(() => {});
          return user;
        } catch {
          // Token expiré ou invalide → déconnexion
          set({ token: null, user: null, modules: [] });
          return null;
        }
      },

      setHydrated: (v) => set({ hydrated: v }),
      clearMustChangePassword: () => set({ mustChangePassword: false }),

      refreshModules: async () => {
        const token = get().token;
        if (!token) {
          set({ modules: [] });
          return [];
        }
        try {
          const { modules } = await authApi.modules();
          set({ modules });
          return modules;
        } catch {
          // Erreur réseau ou token expiré → on garde l'ancienne liste
          return get().modules;
        }
      },

      setModules: (mods) => set({ modules: mods }),
    }),
    {
      name: "sygren-auth",
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        mustChangePassword: state.mustChangePassword,
        modules: state.modules,
      }),
    },
  ),
);
