// Client API SYGREN — encapsule tous les appels vers le backend Go.
//
// Architecture :
//   - En dev (sandbox) : le frontend Next.js (port 3000) appelle le backend Go
//     (port 8080) via le gateway Caddy (port 81). Le routing se fait grâce au
//     paramètre ?XTransformPort=8080 ajouté à chaque URL relative.
//   - En prod (Vercel) : le frontend utilise NEXT_PUBLIC_API_URL pour appeler
//     directement le backend Go déployé (Render, Railway, etc.). Les requêtes
//     sont en CORS cross-origin.
//
// Le token JWT est stocké par le store Zustand (auth-store.ts) et injecté
// automatiquement dans l'en-tête Authorization de chaque requête.

import type {
  LoginResponse,
  Subject,
  User,
  ApiError,
  IEP,
  IEPWithStats,
  School,
  SchoolWithStats,
  SchoolClass,
  ClassWithDetails,
  Student,
  StudentWithClass,
  TeacherWithDetails,
  DirectorWithDetails,
  InspectorWithDetails,
  EvaluationSession,
  SessionWithDetails,
  Grade,
  GradeScaleWithSubject,
  SessionStatus,
  SessionResults,
  AnnualResult,
  ReportCard,
  ReportCardWithStudent,
  DashboardData,
  Setting,
  SettingsByCategory,
} from "./types";

// En production (Vercel), NEXT_PUBLIC_API_URL pointe vers le backend déployé.
// En dev (sandbox), on utilise les chemins relatifs avec ?XTransformPort=8080.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";
const API_PORT = "8080";
const IS_PRODUCTION = !!API_BASE_URL;

/** Construit l'URL complète pour un appel API. */
function buildUrl(path: string): string {
  if (IS_PRODUCTION) {
    // Mode production : URL absolue vers le backend déployé
    return `${API_BASE_URL}${path}`;
  }
  // Mode dev (sandbox) : chemin relatif + ?XTransformPort=8080
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}XTransformPort=${API_PORT}`;
}

/** Alias rétro-compatible. */
function withPort(path: string): string {
  return buildUrl(path);
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
  list: (params?: { level?: string }) => {
    const q = params?.level ? `?level=${params.level}` : "";
    return apiFetch<{ subjects: Subject[]; count: number }>(`/api/subjects${q}`);
  },
  create: (data: { name: string; coefficient?: number; levels?: string }) =>
    apiFetch<Subject>("/api/subjects", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<{ name: string; coefficient: number; levels: string }>) =>
    apiFetch<Subject>(`/api/subjects/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/subjects/${id}`, { method: "DELETE" }),
};

// === IEP — Inspection de l'Enseignement Primaire ===

export const iepApi = {
  list: () =>
    apiFetch<{ ieps: IEPWithStats[]; count: number }>("/api/iep"),
  create: (data: { name: string; region: string }) =>
    apiFetch<IEP>("/api/iep", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name?: string; region?: string }) =>
    apiFetch<IEP>(`/api/iep/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/iep/${id}`, { method: "DELETE" }),
};

// === Écoles ===

export const schoolsApi = {
  list: () =>
    apiFetch<{ schools: SchoolWithStats[]; count: number }>("/api/schools"),
  create: (data: {
    iep_id: string;
    code: string;
    name: string;
    address: string;
    status: "public" | "private" | "community";
  }) =>
    apiFetch<School>("/api/schools", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: {
      iep_id?: string;
      code?: string;
      name?: string;
      address?: string;
      status?: "public" | "private" | "community";
    },
  ) =>
    apiFetch<School>(`/api/schools/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/schools/${id}`, {
      method: "DELETE",
    }),
};

// === Classes ===

export const classesApi = {
  list: (params?: { includeInactive?: boolean; schoolId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.includeInactive) qs.set("include_inactive", "true");
    if (params?.schoolId) qs.set("school_id", params.schoolId);
    const q = qs.toString();
    return apiFetch<{ classes: ClassWithDetails[]; count: number }>(
      q ? `/api/classes?${q}` : "/api/classes",
    );
  },
  create: (data: {
    school_id: string;
    name: string;
    teacher_id?: string | null;
  }) =>
    apiFetch<SchoolClass>("/api/classes", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: Partial<{
      name?: string;
      teacher_id?: string | null;
      active?: boolean;
    }>,
  ) =>
    apiFetch<SchoolClass>(`/api/classes/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/classes/${id}`, {
      method: "DELETE",
    }),
};

// === Élèves ===

export const studentsApi = {
  list: (classId?: string) =>
    apiFetch<{ students: StudentWithClass[]; count: number }>(
      classId ? `/api/students?class_id=${classId}` : "/api/students",
    ),
  create: (data: {
    class_id: string;
    first_name: string;
    last_name: string;
    gender: "M" | "F";
    matricule?: string; // fourni par le Ministère de l'Éducation (optionnel)
  }) =>
    apiFetch<Student>("/api/students", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: Partial<{
      class_id: string;
      first_name: string;
      last_name: string;
      gender: "M" | "F";
      birth_date: string;
      matricule: string; // string vide = effacer le matricule
    }>,
  ) =>
    apiFetch<Student>(`/api/students/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/students/${id}`, {
      method: "DELETE",
    }),
};

// === Enseignants ===

export const teachersApi = {
  list: () =>
    apiFetch<{ teachers: TeacherWithDetails[]; count: number }>(
      "/api/teachers",
    ),
  create: (data: {
    full_name: string;
    phone?: string;
    email?: string;
    password: string;
    school_id?: string;
  }) =>
    apiFetch<User>("/api/teachers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: Partial<{
      full_name: string;
      phone: string | null;
      email: string | null;
      password: string;
      school_id: string | null;
      active: boolean;
    }>,
  ) =>
    apiFetch<User>(`/api/teachers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/teachers/${id}`, {
      method: "DELETE",
    }),
};

// === Directeurs d'école (role=director) ===

export const directorsApi = {
  list: () =>
    apiFetch<{ directors: DirectorWithDetails[]; count: number }>(
      "/api/directors",
    ),
  create: (data: {
    full_name: string;
    phone?: string;
    email?: string;
    password: string;
    school_id?: string;
  }) =>
    apiFetch<User>("/api/directors", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: Partial<{
      full_name: string;
      phone: string | null;
      email: string | null;
      password: string;
      school_id: string | null;
      active: boolean;
    }>,
  ) =>
    apiFetch<User>(`/api/directors/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/directors/${id}`, {
      method: "DELETE",
    }),
};

// === Inspecteurs IEP (role=inspector) ===

export const inspectorsApi = {
  list: () =>
    apiFetch<{ inspectors: InspectorWithDetails[]; count: number }>(
      "/api/inspectors",
    ),
  create: (data: {
    full_name: string;
    phone?: string;
    email?: string;
    password: string;
    iep_id?: string;
  }) =>
    apiFetch<User>("/api/inspectors", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: Partial<{
      full_name: string;
      phone: string | null;
      email: string | null;
      password: string;
      iep_id: string | null;
      active: boolean;
    }>,
  ) =>
    apiFetch<User>(`/api/inspectors/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/inspectors/${id}`, {
      method: "DELETE",
    }),
};

// === Sessions de saisie mensuelle (Module 2 — cahier des charges §3) ===

export const sessionsApi = {
  list: (params?: { year?: number; month?: number; class_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.year) qs.set("year", String(params.year));
    if (params?.month) qs.set("month", String(params.month));
    if (params?.class_id) qs.set("class_id", params.class_id);
    const q = qs.toString();
    return apiFetch<{ sessions: SessionWithDetails[]; count: number }>(
      q ? `/api/sessions?${q}` : "/api/sessions",
    );
  },
  create: (data: {
    class_id: string;
    month: number;
    year: number;
    status?: SessionStatus;
    eval_type?: "composition" | "exam_blanc";
    eval_number?: number;
    open_at: string;
    close_at: string;
    auto_open?: boolean;
  }) =>
    apiFetch<EvaluationSession>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  bulkCreate: (data: {
    scope: "all" | "school";
    school_code?: string;
    month: number;
    year: number;
    eval_type?: "composition" | "exam_blanc";
    eval_number?: number;
    open_at: string;
    close_at: string;
    auto_open?: boolean;
  }) =>
    apiFetch<{
      status: string;
      created: number;
      skipped: string[];
      failed: string[];
      total_classes: number;
    }>("/api/sessions/bulk", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateStatus: (id: string, status: SessionStatus) =>
    apiFetch<EvaluationSession>(`/api/sessions/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),
  extend: (id: string, newCloseAt: string) =>
    apiFetch<EvaluationSession>(`/api/sessions/${id}/extend`, {
      method: "PUT",
      body: JSON.stringify({ new_close_at: newCloseAt }),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/sessions/${id}`, {
      method: "DELETE",
    }),
};

// === Notes (Module 2 — saisie des notes) ===

export const gradesApi = {
  list: (sessionId: string) =>
    apiFetch<{ grades: Grade[]; count: number }>(
      `/api/grades?session_id=${sessionId}`,
    ),
  upsert: (data: {
    student_id: string;
    subject_id: string;
    session_id: string;
    value: number;
  }) =>
    apiFetch<Grade>("/api/grades", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  bulkUpsert: (data: {
    session_id: string;
    grades: { student_id: string; subject_id: string; value: number }[];
  }) =>
    apiFetch<{
      status: string;
      session_id: string;
      total_received: number;
      created: number;
      updated: number;
      skipped: number;
    }>("/api/grades/bulk", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/grades/${id}`, {
      method: "DELETE",
    }),
};

// === Barèmes de notation (cahier des charges §3 Module 2) ===

export const gradeScalesApi = {
  list: (params?: { level?: string }) => {
    const q = params?.level ? `?level=${params.level}` : "";
    return apiFetch<{ grade_scales: GradeScaleWithSubject[]; count: number }>(
      `/api/grade-scales${q}`,
    );
  },
  create: (data: {
    level: string;
    subject_id?: string | null;
    max_score: number;
  }) =>
    apiFetch<GradeScaleWithSubject>("/api/grade-scales", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: Partial<{ level: string; subject_id: string | null; max_score: number }>,
  ) =>
    apiFetch<GradeScaleWithSubject>(`/api/grade-scales/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/grade-scales/${id}`, {
      method: "DELETE",
    }),
};

// === Module 3 — Calcul des moyennes + classement + mentions ===

export const computationApi = {
  /** Résultats complets d'une session (moyennes, classement, mentions, stats) */
  getSessionResults: (sessionId: string) =>
    apiFetch<SessionResults>(`/api/computation/session/${sessionId}`),
  /** Bilan annuel d'un élève (agrégation des sessions de l'année) */
  getStudentAnnual: (studentId: string, year?: number) =>
    apiFetch<AnnualResult>(
      `/api/computation/student/${studentId}/annual${year ? `?year=${year}` : ""}`,
    ),
};

// === Module 4 — Bulletins PDF ===

export const reportCardsApi = {
  /** Liste les bulletins générés pour une session */
  list: (sessionId: string) =>
    apiFetch<{ report_cards: ReportCardWithStudent[]; count: number }>(
      `/api/report-cards/session/${sessionId}`,
    ),
  /** Génère le bulletin d'un élève spécifique */
  generate: (sessionId: string, studentId: string) =>
    apiFetch<ReportCard>(
      `/api/report-cards/generate/${sessionId}/${studentId}`,
      { method: "POST" },
    ),
  /** Génère les bulletins de tous les élèves d'une session (par lot) */
  generateBatch: (sessionId: string) =>
    apiFetch<{
      session_id: string;
      total: number;
      generated: number;
      failed: number;
    }>(`/api/report-cards/generate-batch/${sessionId}`, { method: "POST" }),
  /** Télécharge le PDF d'un bulletin (retourne un Blob) */
  download: async (reportCardId: string): Promise<Blob> => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(
      withPort(`/api/report-cards/${reportCardId}/download`),
      { headers },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new ApiException(
        text || `Erreur ${res.status}`,
        res.status,
      );
    }
    return res.blob();
  },
};

// === Module 5 — Tableaux de bord analytiques ===

export const dashboardApi = {
  /** Récupère les KPIs agrégés selon le scope de l'utilisateur (RBAC backend) */
  get: () => apiFetch<DashboardData>("/api/dashboard"),
};

// === Synthèse des Résultats (PDF officiel) ===

export const reportsApi = {
  /** Télécharge la synthèse des résultats (PDF) pour une session */
  downloadSynthese: async (sessionId: string): Promise<Blob> => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(withPort(`/api/reports/synthese?session_id=${sessionId}`), { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiException(text || `Erreur ${res.status}`, res.status);
    }
    return res.blob();
  },
};

// === Paramètres système (admin uniquement) ===

export const settingsApi = {
  /** Liste tous les paramètres, groupés par catégorie */
  list: () =>
    apiFetch<{ settings: SettingsByCategory; count: number }>("/api/settings"),
  /** Récupère un paramètre précis */
  get: (key: string) => apiFetch<Setting>(`/api/settings/${key}`),
  /** Met à jour un paramètre */
  update: (key: string, value: string) =>
    apiFetch<Setting>(`/api/settings/${key}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
};

// Export par défaut groupé
export const api = {
  auth: authApi,
  health: healthApi,
  subjects: subjectsApi,
  iep: iepApi,
  schools: schoolsApi,
  classes: classesApi,
  students: studentsApi,
  teachers: teachersApi,
  directors: directorsApi,
  inspectors: inspectorsApi,
  sessions: sessionsApi,
  grades: gradesApi,
  computation: computationApi,
  reportCards: reportCardsApi,
  dashboard: dashboardApi,
  settings: settingsApi,
};
