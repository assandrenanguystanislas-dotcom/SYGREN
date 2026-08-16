"use client";

// Store d'authentification SYGREN (Zustand + persist).
//
// Gère :
// - le token JWT et le profil utilisateur
// - la persistance dans localStorage (survit au rafraîchissement)
// - l'hydratation au démarrage de l'app
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

  /** Tente une connexion et stocke le token. */
  login: (identifier: string, password: string) => Promise<User>;
  /** Déconnexion : purge le token et le profil. */
  logout: () => void;
  /** Recharge le profil depuis l'API (utile après rafraîchissement). */
  refreshUser: () => Promise<User | null>;
  /** Marque le store comme hydraté (appelé par useHydrateAuth). */
  setHydrated: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      loading: false,
      hydrated: false,

      login: async (identifier, password) => {
        set({ loading: true });
        try {
          const { token, user } = await authApi.login(identifier, password);
          set({ token, user, loading: false });
          return user;
        } catch (e) {
          set({ loading: false });
          throw e;
        }
      },

      logout: () => {
        set({ token: null, user: null });
      },

      refreshUser: async () => {
        const token = get().token;
        if (!token) return null;
        try {
          const user = await authApi.me();
          set({ user });
          return user;
        } catch {
          // Token expiré ou invalide → déconnexion
          set({ token: null, user: null });
          return null;
        }
      },

      setHydrated: (v) => set({ hydrated: v }),
    }),
    {
      name: "sygren-auth",
      partialize: (state) => ({ token: state.token, user: state.user }),
    },
  ),
);
