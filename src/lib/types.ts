// Types TypeScript correspondant aux modèles GORM du backend Go (models/models.go)
// Ces types garantissent le typage statique entre le frontend et l'API.

export type Role = "teacher" | "director" | "inspector" | "admin";

export const ROLE_LABELS: Record<Role, string> = {
  teacher: "Instituteur",
  director: "Directeur d'École",
  inspector: "Inspecteur (IEP)",
  admin: "Super-Administrateur",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  teacher: "Saisie des notes mensuelles de votre classe",
  director: "Gestion de l'établissement et validation des bulletins",
  inspector: "Supervision analytique multi-écoles (circonscription)",
  admin: "Administration globale du système SYGREN",
};

export interface User {
  id: string;
  phone?: string | null;
  email?: string | null;
  full_name: string;
  role: Role;
  iep_id?: string | null;
  school_id?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IEP {
  id: string;
  name: string;
  region: string;
  created_at: string;
}

export interface School {
  id: string;
  iep_id: string;
  name: string;
  address: string;
  created_at: string;
}

export type ClassLevel = "CP" | "CE" | "CM";
export type ClassName = "CP1" | "CP2" | "CE1" | "CE2" | "CM1" | "CM2";

export interface SchoolClass {
  id: string;
  school_id: string;
  name: ClassName | string;
  level: ClassLevel | string;
  teacher_id?: string | null;
  created_at: string;
}

export interface Student {
  id: string;
  matricule: string;
  class_id: string;
  first_name: string;
  last_name: string;
  gender: "M" | "F" | string;
  birth_date?: string | null;
  created_at: string;
}

export interface Subject {
  id: string;
  name: string;
  coefficient: number;
  created_at: string;
}

export type SessionStatus = "draft" | "open" | "closed" | "validated";

export interface EvaluationSession {
  id: string;
  class_id: string;
  month: number; // 1-12
  year: number;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}

export interface Grade {
  id: string;
  student_id: string;
  subject_id: string;
  session_id: string;
  value: number; // 0-20
  is_draft: boolean;
  updated_at: string;
}

export interface ReportCard {
  id: string;
  student_id: string;
  session_id: string;
  average: number;
  rank: number;
  mention: string;
  file_path: string;
  generated_at: string;
}

// Types enrichis (avec relations jointes par le backend)

export interface IEPWithStats extends IEP {
  school_count: number;
}

export interface SchoolWithStats extends School {
  iep_name?: string;
  class_count: number;
  student_count: number;
}

export interface ClassWithDetails extends SchoolClass {
  school_name?: string;
  teacher_name?: string | null;
  student_count: number;
}

export interface StudentWithClass extends Student {
  class_name?: string;
  school_name?: string;
}

export interface TeacherWithDetails extends User {
  school_name?: string;
  class_name?: string | null;
}

export interface SessionWithDetails extends EvaluationSession {
  class_name?: string;
  school_name?: string;
  teacher_name?: string | null;
  student_count: number;
  subject_count: number;
  graded_count: number;
  draft_count: number;
  completion_rate: number;
}

// === Module 3 — Résultats de calcul (moyennes, classement, mentions) ===

export interface SubjectGrade {
  subject_id: string;
  subject_name: string;
  coefficient: number;
  grade: number; // -1 si aucune note
  has_grade: boolean;
  is_draft: boolean;
}

export interface StudentResult {
  student_id: string;
  matricule: string;
  first_name: string;
  last_name: string;
  subject_grades: SubjectGrade[];
  average: number;
  has_average: boolean;
  rank: number;
  rank_label: string;
  mention: string;
  mention_color: string;
  graded_count: number;
  total_subjects: number;
  has_drafts: boolean;
}

export interface ClassStatistics {
  student_count: number;
  class_average: number;
  max_average: number;
  min_average: number;
  median_average: number;
  pass_rate: number;
  distinction_rate: number;
  completion_rate: number;
  mention_distribution: Record<string, number>;
}

export interface SessionResults {
  session_id: string;
  class_name: string;
  school_name: string;
  month: number;
  year: number;
  status: SessionStatus;
  results: StudentResult[];
  statistics: ClassStatistics;
}

export interface SessionSummary {
  session_id: string;
  month: number;
  year: number;
  average: number;
  has_average: boolean;
  rank: number;
  mention: string;
}

export interface AnnualResult {
  student_id: string;
  matricule: string;
  first_name: string;
  last_name: string;
  class_name: string;
  year: number;
  session_count: number;
  annual_average: number;
  has_annual: boolean;
  mention: string;
  mention_color: string;
  sessions: SessionSummary[];
}

// Map couleur mention → classes Tailwind
export const MENTION_COLOR_CLASSES: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
  green: "bg-green-100 text-green-700 border-green-200",
  lime: "bg-lime-100 text-lime-700 border-lime-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  orange: "bg-orange-100 text-orange-700 border-orange-200",
  red: "bg-red-100 text-red-700 border-red-200",
  rose: "bg-rose-100 text-rose-700 border-rose-200",
  slate: "bg-slate-100 text-slate-600 border-slate-200",
};

// Réponses API
export interface LoginResponse {
  token: string;
  user: User;
}

export interface ApiError {
  error: string;
}

// Listes valides (cahier des charges §3 — école primaire ivoirienne)
export const CLASS_NAMES = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"] as const;
export const CLASS_LEVELS = ["CP", "CE", "CM"] as const;
