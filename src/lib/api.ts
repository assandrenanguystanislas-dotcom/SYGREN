// Client API SYGREN — encapsule tous les appels vers le backend Go (port 8080).
//
// Architecture : le frontend Next.js (port 3000) appelle le backend Go (port 8080)
// via le gateway Caddy (port 81). Le routing se fait grâce au paramètre
// ?XTransformPort=8080 ajouté à chaque URL.
//
// Le token JWT est stocké par le store Zustand (auth-store.ts) et injecté
// automatiquement dans l'en-tête Authorization de chaque requête.

import type {
  LoginResponse,
  Subject,
  User,
  ApiError,
} from "./types";

const API_PORT = "8080";

/** Ajoute ?XTransformPort=8080 à un path relatif. */
function withPort(path: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}XTransformPort=${API_PORT}`;
}

/** Erreur API typée. */
export class ApiException extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiException";
    this.status = status;
  }
}

/** Récupère le token JWT depuis localStorage. */
function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("sygren-auth");
    if (!raw) return null;
    return JSON.parse(raw)?.state?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Effectue une requête vers le backend Go avec gestion automatique du
 * routing gateway (XTransformPort) et de l'authentification JWT.
 */
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(withPort(path), {
    ...options,
    headers,
  });

  // Tente de parser le JSON même en cas d'erreur pour récupérer le message
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "error" in data
        ? String((data as ApiError).error)
        : `Erreur ${res.status}`) || `Erreur ${res.status}`;
    throw new ApiException(message, res.status);
  }

  return data as T;
}

// === Authentification (§4.1 du cahier des charges) ===

export const authApi = {
  /** Connexion via téléphone OU email + mot de passe. */
  login: (identifier: string, password: string) =>
    apiFetch<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    }),

  /** Récupère le profil de l'utilisateur connecté. */
  me: () => apiFetch<User>("/api/me"),
};

// === Santé du service ===

export const healthApi = {
  check: () => apiFetch<{ status: string; service: string; version: string }>("/api/health"),
};

// === Matières (Module 1) ===

export const subjectsApi = {
  list: () =>
    apiFetch<{ subjects: Subject[]; count: number }>("/api/subjects"),
};

// Export par défaut groupé
export const api = {
  auth: authApi,
  health: healthApi,
  subjects: subjectsApi,
};
