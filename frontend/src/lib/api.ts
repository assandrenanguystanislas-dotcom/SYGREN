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
  PasswordResetRequest,
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
  PersonnelDossierInput,
  PersonnelSheet,
  EvaluationSession,
  SessionWithDetails,
  SessionExemption,
  SessionExemptionWithDetails,
  Grade,
  GradeScaleWithSubject,
  SessionStatus,
  SessionResults,
  DecisionConseil,
  EndOfYearSheet,
  EvalType,
  AnnualResult,
  ReportCard,
  DashboardData,
  Setting,
  SettingsByCategory,
  // Architecture D
  PermissionsMatrixResponse,
  UpdatePermissionResponse,
  UserModulesResponse,
  AuditLogsResponse,
  AuditLog,
  UserAdminRow,
  // PDA IEPP — Plan d'Action Pluriannuel
  PdaExam,
  PdaResultsResponse,
  PdaRemediation,
  PdaSummary,
  PdaTimelineResponse,
  PdaBackfillResponse,
  PdaExamKind,
  PdaPlanActionResponse,
  // Centres d'examen (documents officiels du plan IEPP)
  ExamCenter,
  ExamCenterWithStats,
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

/** Token JWT brut du localStorage (format zustand-persist) — exposé pour
 *  le verrou d'impression (pages ouvertes en nouvel onglet où le store
 *  Zustand n'a pas le token, seul localStorage l'a). */
export function getStoredToken(): string | null {
  return getToken();
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

  // FormData (upload fichiers) : PAS de Content-Type — le navigateur pose
  // lui-même multipart/form-data avec le boundary correct.
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
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
  /** Connexion via email, téléphone OU code école + mot de passe. */
  login: (identifier: string, password: string) =>
    apiFetch<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    }),

  /** Task 26 — Auto-inscription Directeur / Enseignant (PUBLIC — fin de la
   *  phase pilote) : création des accès depuis l'écran de connexion. Le
   *  mot de passe est optionnel (vide → standard = numéro de téléphone). */
  registerAccess: (data: {
    role: "director" | "teacher";
    school_code: string;
    full_name: string;
    phone: string;
    email?: string;
    password?: string;
  }) =>
    apiFetch<{ status: string; message: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Récupère le profil de l'utilisateur connecté. */
  me: () => apiFetch<User>("/api/me"),

  /** Architecture D — Liste des modules accessibles au user (pour nav dynamique). */
  modules: () => apiFetch<UserModulesResponse>("/api/me/modules"),

  // === Reset Password ===

  /** User soumet une demande de réinitialisation (PUBLIC). */
  resetRequest: (data: { identifier: string; role_hint: string; message?: string }) =>
    apiFetch<{ status: string; message: string; id: string }>("/api/auth/reset-request", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** User change son mot de passe (AUTH — première connexion ou volontaire). */
  changePassword: (data: { current_password: string; new_password: string }) =>
    apiFetch<{ status: string }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** User réinitialise via un reset link token (PUBLIC). */
  resetPasswordWithToken: (data: { token: string; new_password: string }) =>
    apiFetch<{ status: string }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // === Reset Password — Admin management ===

  /** Admin liste les demandes (pending par défaut). */
  listResetRequests: (status?: string) =>
    apiFetch<{ requests: PasswordResetRequest[]; count: number }>(
      `/api/auth/reset-requests${status ? `?status=${status}` : ""}`,
    ),

  /** Admin approuve une demande (option 1: temp_password, option 2: reset_link, option 3: reset_to_phone — standard téléphone). */
  approveResetRequest: (id: string, data: { method: string; note?: string }) =>
    apiFetch<{
      status: string;
      method: string;
      temp_password?: string;
      reset_link?: string;
      user_name: string;
      message: string;
    }>(`/api/auth/reset-requests/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Admin rejette une demande. */
  rejectResetRequest: (id: string, data: { note?: string }) =>
    apiFetch<{ status: string }>(`/api/auth/reset-requests/${id}/reject`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
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
  create: (data: {
    name: string;
    region?: string;
    inspector_name?: string;
    inspector_email?: string;
    inspector_phone?: string;
    bp?: string;
  }) =>
    apiFetch<IEP>("/api/iep", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: Partial<{
      name: string;
      region: string;
      inspector_name: string;
      inspector_email: string;
      inspector_phone: string;
      bp: string;
    }>,
  ) =>
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
      exam_center_id?: string | null; // "" / null = détacher du centre
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
  // Logo d'école — multipart vers le stockage fichiers (R2 prod / FS dev).
  // 503 si le stockage n'est pas configuré (prod sans variables R2_*).
  uploadLogo: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("logo", file);
    return apiFetch<{ logo_path: string; logo_url: string }>(
      `/api/schools/${id}/logo`,
      { method: "POST", body: fd },
    );
  },
  removeLogo: (id: string) =>
    apiFetch<{ status: string }>(`/api/schools/${id}/logo`, {
      method: "DELETE",
    }),
};

// === Centres d'examen (documents officiels du plan IEPP) ===

export const examCentersApi = {
  list: () =>
    apiFetch<{ exam_centers: ExamCenterWithStats[]; count: number }>(
      "/api/exam-centers",
    ),
  create: (data: { iep_id: string; name: string; position?: number }) =>
    apiFetch<ExamCenter>("/api/exam-centers", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name?: string; position?: number }) =>
    apiFetch<ExamCenter>(`/api/exam-centers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  /** Refusé (409) tant que des écoles sont rattachées au centre. */
  remove: (id: string) =>
    apiFetch<{ status: string }>(`/api/exam-centers/${id}`, {
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
      // Résultats de fin d'année — compteurs manuels du tableau
      // récapitulatif (Exclus / Abandons, colonnes Garçons/Filles ; 0..15,
      // 0 = zéro saisi ; absent = inchangé).
      exclus_garcons?: number;
      exclus_filles?: number;
      abandons_garcons?: number;
      abandons_filles?: number;
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
  list: (params?: { classId?: string; schoolId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.classId) qs.set("class_id", params.classId);
    if (params?.schoolId) qs.set("school_id", params.schoolId);
    const q = qs.toString();
    return apiFetch<{ students: StudentWithClass[]; count: number }>(
      q ? `/api/students?${q}` : "/api/students",
    );
  },
  create: (data: {
    class_id: string;
    first_name: string;
    last_name: string;
    gender: "M" | "F";
    matricule?: string; // fourni par le Ministère de l'Éducation (optionnel)
    birth_year?: number; // année de naissance seule, ex: 2006 — 0/absent = non renseignée
    // === Résultats de fin d'année ===
    scolarite_cours?: number; // 1..10 — 0/absent = non renseignée
    scolarite_totale?: number; // 1..10 — 0/absent = non renseignée
    decision_conseil?: DecisionConseil | ""; // A | R | ABD — "" = non statuée
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
      birth_year: number; // année seule — 0 = effacer (NULL)
      birth_date: string;
      matricule: string; // string vide = effacer le matricule
      // === Résultats de fin d'année — 0/"" = effacer (NULL) ===
      scolarite_cours: number; // 1..10
      scolarite_totale: number; // 1..10
      decision_conseil: DecisionConseil | ""; // A | R | ABD
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
  // Import Excel bulk : le frontend parse le .xls/.xlsx (SheetJS) et envoie
  // un tableau d'élèves (class_name = "CP2", pas un UUID — le backend fait
  // le lookup par nom dans l'école). Réponse : {created, skipped, failed, total}.
  bulkCreate: (data: {
    school_id: string; // requis pour admin ; ignoré pour director (force ctxSchoolID)
    students: {
      matricule?: string;
      first_name: string;
      last_name: string;
      gender: string; // M/F (ou MASCULIN/FEMININ — normalisé backend)
      class_name: string; // "CP2" — lookup par nom dans l'école
    }[];
  }) =>
    apiFetch<{
      created: number;
      skipped: { row: number; matricule?: string; reason: string }[];
      failed: { row: number; matricule?: string; reason: string }[];
      total: number;
    }>("/api/students/bulk", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// === Enseignants ===

export const teachersApi = {
  /**
   * Liste les enseignants.
   *
   * @param params.includeDirectors  si true, inclut aussi les directeurs
   *   d'école dans la réponse (un directeur peut tenir une classe comme
   *   enseignant — cahier des charges §3 Module 1). Le frontend utilise
   *   ce flag dans classes-view.tsx pour alimenter le dropdown d'affec-
   *   tation. Sans ce flag, la réponse ne contient que les users avec
   *   role=teacher (utilisé par teachers-view.tsx).
   */
  list: (params?: { includeDirectors?: boolean }) => {
    const qs = params?.includeDirectors ? "?include_directors=true" : "";
    return apiFetch<{ teachers: TeacherWithDetails[]; count: number }>(
      `/api/teachers${qs}`,
    );
  },
  create: (data: {
    full_name: string;
    phone?: string;
    email?: string;
    /** Task 25 — optionnel : si vide, le backend applique le mot de passe
     *  STANDARD = numéro de téléphone (modifiable par l'enseignant). */
    password?: string;
    school_id?: string;
    personnel?: PersonnelDossierInput; // dossier « état nominatif »
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
      personnel: PersonnelDossierInput; // mise à jour COMPLÈTE du dossier
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
    /** Task 25 — optionnel : si vide, le backend applique le mot de passe
     *  STANDARD = numéro de téléphone (modifiable par le directeur). */
    password?: string;
    school_id?: string;
    personnel?: PersonnelDossierInput; // dossier « état nominatif »
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
      personnel: PersonnelDossierInput; // mise à jour COMPLÈTE du dossier
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
    service?: string;
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
      service: string;
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

// === v2 — Parents (module Utilisateurs → onglet Parents) ===
// Comptes du rôle "parent" — Portail Parent : consultation + impression
// du bulletin individuel de l'enfant (par matricule).

export const parentsApi = {
  list: (q?: string) =>
    apiFetch<{ parents: User[]; count: number }>(
      `/api/parents${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),
  create: (data: {
    full_name: string;
    phone?: string;
    email?: string;
    // Task 26 — optionnel : vide → mot de passe standard = numéro de
    // téléphone (le parent se connecte avec son numéro comme code ET mot
    // de passe).
    password?: string;
    child_matricule?: string;
  }) =>
    apiFetch<User>("/api/parents", {
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
      active: boolean;
      child_matricule: string | null;
    }>,
  ) =>
    apiFetch<User>(`/api/parents/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/parents/${id}`, {
      method: "DELETE",
    }),
};

// === v2 — Portail Parent (module "parent-portal") ===
// Consultation par MATRICULE de l'enfant : bulletin individuel de fin
// d'année (module Résultats) + bulletins individuels de période
// (module Bulletins).

export interface ParentStudentInfo {
  student: {
    id: string;
    matricule: string;
    last_name: string;
    first_name: string;
    full_name: string;
    gender: string;
    birth_year?: number | null;
  };
  class: { id: string; name: string; level: string };
  school: { id: string; name: string; code?: string };
  iep?: { name?: string; region?: string } | null;
  sessions: Array<{
    id: string;
    month: number;
    year: number;
    status: string;
    eval_type: string;
    eval_number: number;
  }>;
  years: number[];
  system_year: number;
  student_id: string;
}

export const parentPortalApi = {
  /** Élève (par matricule) + classe + école + sessions disponibles. */
  student: (matricule: string) =>
    apiFetch<ParentStudentInfo>(
      `/api/parent/student?matricule=${encodeURIComponent(matricule)}`,
    ),

  /** Bulletin individuel « RESULTATS DE FIN D'ANNEE » (payload de classe
   *  + student_id pour isoler l'enfant). */
  endOfYear: (matricule: string, year?: number) =>
    apiFetch<EndOfYearSheet>(
      `/api/parent/end-of-year?matricule=${encodeURIComponent(matricule)}${year ? `&year=${year}` : ""}`,
    ),

  /** Bulletin individuel de période (relevé de classe + student_id +
   *  rangs de la classe pour le rang réel de l'enfant). */
  periodBulletin: (matricule: string, sessionId: string) =>
    apiFetch<{
      releve: Awaited<ReturnType<typeof reportsApi.getReleveData>>;
      student_id: string;
      ranks: Array<{ matricule: string; rank: number }>;
    }>(
      `/api/parent/period-bulletin?matricule=${encodeURIComponent(matricule)}&session_id=${encodeURIComponent(sessionId)}`,
    ),
};

// === Sessions de saisie mensuelle (Module 2 — cahier des charges §3) ===
//
// Approche A — 1 session par ÉCOLE (pas par classe). Toutes les classes
// actives de l'école participent à la session, sauf celles exemptées via
// la table SessionExemption (par class_id ou par niveau CP/CE/CM).

export const sessionsApi = {
  list: (params?: {
    year?: number;
    month?: number;
    school_id?: string;
    view?: "active" | "validated" | "archived";
  }) => {
    const qs = new URLSearchParams();
    if (params?.year) qs.set("year", String(params.year));
    if (params?.month) qs.set("month", String(params.month));
    if (params?.school_id) qs.set("school_id", params.school_id);
    if (params?.view) qs.set("view", params.view);
    const q = qs.toString();
    return apiFetch<{ sessions: SessionWithDetails[]; count: number }>(
      q ? `/api/sessions?${q}` : "/api/sessions",
    );
  },
  /** Crée une session pour une école précise (Approche A — 1 session par école). */
  create: (data: {
    school_id: string;
    month: number;
    year: number;
    status?: SessionStatus;
    eval_type?: EvalType; // composition | exam_blanc | composition_passage
    eval_number?: number;
    open_at: string;
    close_at: string;
    auto_open?: boolean;
  }) =>
    apiFetch<EvaluationSession>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  /**
   * Crée 1 session par école dans le périmètre choisi.
   * - scope="all" : toutes les écoles (admin uniquement)
   * - scope="school" : une école identifiée par son code (admin) ou par
   *   défaut l'école du directeur (le school_code est ignoré pour le director).
   */
  bulkCreate: (data: {
    scope: "all" | "school";
    school_code?: string;
    month: number;
    year: number;
    eval_type?: EvalType; // composition | exam_blanc | composition_passage
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
      total_schools: number;
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
  /**
   * Annule une session programmée (soft cancel — la session passe en statut
   * "cancelled", elle n'est pas supprimée). La raison est obligatoire.
   *
   * Règles (côté backend) :
   *   - Autorisé depuis draft librement.
   *   - Autorisé depuis open : si des notes ont été saisies, il faut passer
   *     deleteGrades=true pour confirmer leur suppression (sinon 409 Conflict).
   *   - Refusé depuis closed/validated (utiliser l'archivage) et depuis
   *     cancelled/archived (déjà terminal).
   *
   * RBAC : admin + director (son école).
   */
  cancel: (id: string, reason: string, deleteGrades = false) =>
    apiFetch<EvaluationSession>(`/api/sessions/${id}/cancel`, {
      method: "PUT",
      body: JSON.stringify({ reason, delete_grades: deleteGrades }),
    }),
  /**
   * Archive une session validée (soft archive — les notes sont CONSERVÉES et
   * continuent de nourrir le bilan annuel élève + la comparaison inter-annuelle).
   * La session passe en statut "archived" (lecture seule, masquée de l'UI active).
   *
   * Autorisé uniquement depuis "validated". L'archivage est aussi déclenché
   * automatiquement par le cron de fin d'année scolaire (main.go) pour les
   * sessions validated dont l'année < année scolaire courante.
   *
   * RBAC : admin + director (son école).
   */
  archive: (id: string) =>
    apiFetch<EvaluationSession>(`/api/sessions/${id}/archive`, {
      method: "PUT",
      body: JSON.stringify({}),
    }),
  delete: (id: string) =>
    apiFetch<{ status: string }>(`/api/sessions/${id}`, {
      method: "DELETE",
    }),

  // === Exemptions — dispenser des classes/niveaux d'une session ===

  /** Liste toutes les exemptions d'une session (GET /api/sessions/{id}/exemptions). */
  listExemptions: (sessionId: string) =>
    apiFetch<{
      exemptions: SessionExemptionWithDetails[];
      count: number;
    }>(`/api/sessions/${sessionId}/exemptions`),

  /**
   * Crée une exemption pour une session (POST /api/sessions/{id}/exemptions).
   * Au moins un de class_id / level doit être fourni.
   */
  createExemption: (
    sessionId: string,
    data: {
      class_id?: string | null;
      level?: string | null; // "CP" | "CE" | "CM"
      reason: string;
    },
  ) =>
    apiFetch<SessionExemption>(`/api/sessions/${sessionId}/exemptions`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Supprime une exemption d'une session (DELETE /api/sessions/{id}/exemptions/{eid}). */
  deleteExemption: (sessionId: string, exemptionId: string) =>
    apiFetch<{ status: string }>(
      `/api/sessions/${sessionId}/exemptions/${exemptionId}`,
      { method: "DELETE" },
    ),
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

// === Module 5 — Tableaux de bord analytiques ===

export const dashboardApi = {
  /** Récupère les KPIs agrégés selon le scope de l'utilisateur (RBAC backend) */
  get: (params?: { year?: string; gender?: string; level?: string }) => {
    const qs = new URLSearchParams();
    if (params?.year) qs.set("year", params.year);
    if (params?.gender) qs.set("gender", params.gender);
    if (params?.level) qs.set("level", params.level);
    const q = qs.toString();
    return apiFetch<DashboardData>(q ? `/api/dashboard?${q}` : "/api/dashboard");
  },
};

// === Synthèse des Résultats (document officiel) ===

export const reportsApi = {
  /**
   * Données du document « ÉTAT NOMINATIF DU PERSONNEL » (module
   * Utilisateurs) pour une école : école + IEP (en-tête officiel), année
   * scolaire en cours et agents (dossier personnel, cours tenu résolu).
   * RBAC : director = son école, inspector = son IEP, admin = tout.
   */
  personnelSheet: (schoolId: string) =>
    apiFetch<PersonnelSheet>(
      `/api/reports/personnel?school_id=${encodeURIComponent(schoolId)}`,
    ),

  /**
   * Données du document « RESULTATS DE FIN D'ANNEE » (module Résultats →
   * onglet « Fin d'année ») pour UNE classe : âge (année de naissance),
   * scolarités (1..10), moyennes (compositions / composition de passage /
   * annuelle), décision du conseil des maîtres (A|R|ABD) et tableau
   * récapitulatif Effectif/Admis/Redoublants (calculés) + Exclus/Abandons
   * (compteurs manuels de la classe). RBAC : director = son école,
   * inspector = son IEP, teacher = sa classe, admin = tout.
   */
  endOfYearSheet: (schoolId: string, classId: string, year?: number) => {
    const qs = new URLSearchParams({
      school_id: schoolId,
      class_id: classId,
    });
    if (year) qs.set("year", String(year));
    return apiFetch<EndOfYearSheet>(`/api/reports/end-of-year?${qs.toString()}`);
  },

  /**
   * Liste les classes associées à une session (pour itérer et générer
   * un relevé/bulletin par classe). Endpoint utilisé par /releve/batch
   * et /bulletins.
   */
  listReleveClasses: (sessionId: string) =>
    apiFetch<{
      classes: Array<{
        id: string;
        name: string;
        level: string;
        student_count: number;
        /** true = la classe (ou son niveau) est exemptée de la session :
         *  affichée grisée dans le sélecteur, exclue de l'impression. */
        exempted: boolean;
      }>;
      count: number;
    }>(`/api/reports/releve-classes?session_id=${sessionId}`),

  /**
   * Récupère les données JSON pour le document de synthèse.
   *
   * @param sessionId ID de la session (rétrocompat : on retrouve l'école + eval)
   * @param levelGroup Périmètre du document :
   *   - "primary" (défaut) → CP1 au CM1 (5 classes)
   *   - "cm2"              → CM2 seulement (document dédié fin de cycle)
   *   - "all"              → toutes les 6 classes (rétrocompatibilité)
   */
  getSyntheseData: (sessionId: string, levelGroup: "primary" | "cm2" | "all" = "primary") =>
    apiFetch<{
      iep_name: string;
      iep_region: string;
      school_name: string;
      school_code: string;
      school_addr: string;
      eval_label: string;
      eval_number: number;
      month: number;
      year: number;
      levels: Array<{
        class_name: string;
        inscrits: [number, number, number];
        presents: [number, number, number];
        admis: [number, number, number];
        pct_admis: [number, number, number];
      }>;
      totals: {
        inscrits_g: number; inscrits_f: number; inscrits_t: number;
        presents_g: number; presents_f: number; presents_t: number;
        admis_g: number; admis_f: number; admis_t: number;
        pct_g: number; pct_f: number; pct_t: number;
      };
      // Transmis par le backend pour adapter le titre + le rendu côté frontend.
      level_group: "primary" | "cm2" | "all";
      document_label: string;
      // === Infos pour les signatures et l'en-tête ===
      director_name: string;
      inspector_name: string;
      inspector_email: string;
      inspector_phone: string;
      iep_bp: string;
    }>(`/api/reports/synthese-data?session_id=${sessionId}&level_group=${levelGroup}`),

  /**
   * Récupère les données JSON pour le document de Relevé de Notes (1 classe).
   *
   * Document A4 portrait multi-pages :
   *   - Page 1 : en-tête institutionnel + tableau (40 élèves max)
   *   - Pages 2..N : tableau suite (45 élèves max/page)
   *   - Dernière page : stats Inscrits/Présents/Admis G/F/T + signatures
   *
   * @param sessionId ID de la session (couvre toute l'école — Approche A)
   * @param classId   ID de la classe à filtrer (1 PDF par classe)
   */
  getReleveData: (sessionId: string, classId: string) =>
    apiFetch<{
      iep_name: string;
      iep_region: string;
      iep_bp: string;
      inspector_name: string;
      inspector_email: string;
      inspector_phone: string;
      school_name: string;
      school_code: string;
      school_addr: string;
      class_name: string;
      class_level: string; // "CP" | "CE" | "CM"
      director_name: string;
      teacher_name: string; // maître titulaire de la classe (signature bulletin)
      eval_label: string;
      eval_number: number;
      eval_type: string; // "composition" | "exam_blanc"
      month: number;
      year: number;
      date: string; // "jj/mm/aaaa"
      title: string; // "RELEVE DE NOTES CM2"
      type_examen: string; // "COMPOSITION N°1"
      total_g: number;
      total_f: number;
      total_t: number;
      students: Array<{
        num: number;
        matricule: string;
        last_name: string;
        first_name: string;
        gender: string; // "M" | "F"
        grades: Array<{
          subject_name: string;
          value: number; // note brute (ex: 18.5/20)
          max_score: number;
          has_grade: boolean;
        }>;
        total: number; // somme des notes brutes
        average: number; // moyenne sur l'échelle du niveau
        average_scale: number; // 10 (CP/CE) ou 20 (CM)
        has_average: boolean;
        observation: string; // "A" (Admis) | "R" (Refusé)
      }>;
      stats: {
        inscrits_g: number; inscrits_f: number; inscrits_t: number;
        presents_g: number; presents_f: number; presents_t: number;
        admis_g: number; admis_f: number; admis_t: number;
        pct_g: number; pct_f: number; pct_t: number;
      };
    }>(`/api/reports/releve-data?session_id=${sessionId}&class_id=${classId}`),
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
// === Architecture D — Permissions (matrice RBAC) ===

export const permissionsApi = {
  /** Récupère la matrice complète role × module. */
  list: () => apiFetch<PermissionsMatrixResponse>("/api/permissions"),

  /** Met à jour une cellule (role_id, module_key, can_read/can_write). */
  update: (data: {
    role_id: string;
    module_key: string;
    can_read?: boolean;
    can_write?: boolean;
  }) =>
    apiFetch<UpdatePermissionResponse>("/api/permissions", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

// === Architecture D — Journal d'audit ===

export const auditApi = {
  /** Liste les entrées du journal avec filtres optionnels. */
  list: (params?: {
    action?: string;
    entity_type?: string;
    actor_id?: string;
    target_id?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.action) q.set("action", params.action);
    if (params?.entity_type) q.set("entity_type", params.entity_type);
    if (params?.actor_id) q.set("actor_id", params.actor_id);
    if (params?.target_id) q.set("target_id", params.target_id);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.page) q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    const qs = q.toString();
    return apiFetch<AuditLogsResponse>(`/api/audit-logs${qs ? "?" + qs : ""}`);
  },
};

// === Architecture D — Gestion admin des comptes (suspend/reactivate) ===

export const usersAdminApi = {
  /** Liste tous les utilisateurs avec leur statut de suspension. */
  list: () =>
    apiFetch<{ users: UserAdminRow[]; admin_iep_services: string[] }>("/api/users"),

  /** Suspend un utilisateur (active=false, suspended_at, reason). */
  suspend: (id: string, reason?: string) =>
    apiFetch<{ ok: boolean; user: UserAdminRow }>(`/api/users/${id}/suspend`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? "" }),
    }),

  /** Réactive un utilisateur suspendu. */
  reactivate: (id: string) =>
    apiFetch<{ ok: boolean; user: UserAdminRow }>(`/api/users/${id}/reactivate`, {
      method: "POST",
    }),
};

// === PDA IEPP — Plan d'Action Pluriannuel (examens blancs CE/CM) ===

export const pdaApi = {
  /** Liste des évaluations du plan — compositions + examens blancs
   *  (scope serveur : director/teacher = leur école). */
  listExams: (params?: { school_id?: string; year?: number }) => {
    const q = new URLSearchParams();
    if (params?.school_id) q.set("school_id", params.school_id);
    if (params?.year) q.set("year", String(params.year));
    const qs = q.toString();
    return apiFetch<{ exams: PdaExam[]; count: number }>(
      `/api/pda/exams${qs ? "?" + qs : ""}`,
    );
  },

  /**
   * Crée une évaluation du plan :
   *  - examen blanc (kind="blanc", défaut) : number absent → auto-incrémenté
   *    par école+année ;
   *  - composition mensuelle (kind="composition") : session_id requis (session
   *    eval_type=composition de l'école) — numéro + année imposés par la session,
   *    notes dérivées du module Notes (lecture seule dans le PDA).
   */
  createExam: (data: {
    school_id: string;
    kind?: PdaExamKind;
    session_id?: string;
    number?: number;
    year: number;
    exam_date?: string;
    threshold?: number;
  }) =>
    apiFetch<PdaExam>("/api/pda/exams", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Rattrapage : abonne au plan toutes les compositions actives non suivies
   *  de l'école (idempotent — les sessions déjà suivies sont ignorées). */
  backfillExams: (schoolId: string) =>
    apiFetch<PdaBackfillResponse>(
      `/api/pda/exams/backfill?school_id=${encodeURIComponent(schoolId)}`,
      { method: "POST" },
    ),

  /** Supprime un examen blanc (cascade résultats + remédiation). */
  deleteExam: (id: string) =>
    apiFetch<{ status: string }>(`/api/pda/exams/${id}`, { method: "DELETE" }),

  /** Roster d'une classe + notes saisies + flags de maîtrise calculés. */
  getResults: (examId: string, classId: string) =>
    apiFetch<PdaResultsResponse>(
      `/api/pda/exams/${examId}/results?class_id=${classId}`,
    ),

  /** Saisie en lot des résultats (note null = effacer). */
  saveResults: (
    examId: string,
    data: {
      class_id: string;
      results: {
        student_id: string;
        present: boolean;
        note_exploitation?: number | null;
        note_math?: number | null;
        note_dictee?: number | null;
      }[];
    },
  ) =>
    apiFetch<{ status: string; count: number }>(
      `/api/pda/exams/${examId}/results`,
      { method: "POST", body: JSON.stringify(data) },
    ),

  /** Compteurs de remédiation d'une classe (lignes 2-3 du tableau 3). */
  getRemediation: (examId: string, classId: string) =>
    apiFetch<PdaRemediation>(
      `/api/pda/exams/${examId}/remediation?class_id=${classId}`,
    ),

  saveRemediation: (examId: string, data: PdaRemediation) =>
    apiFetch<PdaRemediation>(`/api/pda/exams/${examId}/remediation`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  /** Synthèse agrégée (les 3 tableaux du document) — calculée côté serveur. */
  getSummary: (examId: string, classId: string) =>
    apiFetch<PdaSummary>(
      `/api/pda/exams/${examId}/summary?class_id=${classId}`,
    ),

  /** Suivi pluriannuel : matrice élève × évaluations (compositions +
   *  examens blancs) d'une classe CE/CM pour une année donnée. */
  getTimeline: (classId: string, year: number) =>
    apiFetch<PdaTimelineResponse>(
      `/api/pda/timeline?class_id=${classId}&year=${year}`,
    ),

  /** Document réseau « PLAN D'ACTION PLURIANNUEL DE L'IEPP » : toutes les
   *  écoles du périmètre pour UNE évaluation (année+numéro+type), groupées
   *  par centre d'examen (sections A + B du document officiel). */
  getPlanAction: (params: {
    year: number;
    number: number;
    kind?: PdaExamKind;
    iep_id?: string;
  }) => {
    const q = new URLSearchParams({
      year: String(params.year),
      number: String(params.number),
      kind: params.kind ?? "blanc",
    });
    if (params.iep_id) q.set("iep_id", params.iep_id);
    return apiFetch<PdaPlanActionResponse>(`/api/pda/plan-action?${q}`);
  },
};

// Barrel agrégé pour rétro-compat
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
  dashboard: dashboardApi,
  settings: settingsApi,
  // Architecture D
  permissions: permissionsApi,
  audit: auditApi,
  usersAdmin: usersAdminApi,
  pda: pdaApi,
  examCenters: examCentersApi,
  // v2
  parents: parentsApi,
  parentPortal: parentPortalApi,
};
