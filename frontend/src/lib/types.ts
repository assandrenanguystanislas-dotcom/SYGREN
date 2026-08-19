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
  code: string; // code unique identifiant l'école dans le système IEP
  name: string;
  address: string;
  status: SchoolStatus; // public | private | community
  created_at: string;
}

export type SchoolStatus = "public" | "private" | "community";

export const SCHOOL_STATUS_LABELS: Record<SchoolStatus, string> = {
  public: "Public",
  private: "Privé",
  community: "Communautaire",
};

export type ClassLevel = "CP" | "CE" | "CM";
export type ClassName = "CP1" | "CP2" | "CE1" | "CE2" | "CM1" | "CM2";

export interface SchoolClass {
  id: string;
  school_id: string;
  name: ClassName | string;
  level: ClassLevel | string;
  teacher_id?: string | null;
  active: boolean;
  created_at: string;
}

export interface Student {
  id: string;
  matricule: string | null;
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
  levels: string; // "CP1,CP2,CE1,CE2,CM1,CM2" | "CM2" | "CP1,CM2" etc.
  created_at: string;
}

export type SubjectClass = "CP1" | "CP2" | "CE1" | "CE2" | "CM1" | "CM2";

export const ALL_CLASSES: SubjectClass[] = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"];

// Map niveau → classes composantes (pour rétrocompat ancien format "CP,CE,CM")
const LEVEL_TO_CLASSES: Record<string, SubjectClass[]> = {
  CP: ["CP1", "CP2"],
  CE: ["CE1", "CE2"],
  CM: ["CM1", "CM2"],
};

// Parse la string levels ("CP1,CP2,CM2" ou ancien "CP,CE,CM") en array de classes.
// Gère la rétrocompat : "CP" est étendu en ["CP1","CP2"].
export function parseLevels(levels: string | undefined | null): SubjectClass[] {
  if (!levels) return ALL_CLASSES;
  const result: SubjectClass[] = [];
  const seen = new Set<string>();
  for (const raw of levels.split(",")) {
    const token = raw.trim().toUpperCase();
    // Si c'est un ancien niveau (CP/CE/CM), l'étendre en classes
    if (LEVEL_TO_CLASSES[token]) {
      for (const c of LEVEL_TO_CLASSES[token]) {
        if (!seen.has(c)) {
          seen.add(c);
          result.push(c);
        }
      }
    } else if (
      (token === "CP1" || token === "CP2" || token === "CE1" ||
       token === "CE2" || token === "CM1" || token === "CM2") &&
      !seen.has(token)
    ) {
      seen.add(token);
      result.push(token);
    }
  }
  return result.length === 0 ? ALL_CLASSES : result;
}

// Formate un array de classes en string "CP1,CP2,CM2"
export function formatLevels(levels: SubjectClass[]): string {
  return levels.length === 0 ? "CP1,CP2,CE1,CE2,CM1,CM2" : levels.join(",");
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

// Directeur d'école (User avec role=director + school_id)
export interface DirectorWithDetails extends User {
  school_name?: string;
  iep_name?: string;
}

// Inspecteur IEP (User avec role=inspector + iep_id)
export interface InspectorWithDetails extends User {
  iep_name?: string;
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

// === Module 4 — Bulletins PDF ===

export interface ReportCardWithStudent extends ReportCard {
  student_name: string;
  student_matricule: string;
  class_name: string;
  school_name: string;
  month: number;
  year: number;
}

// === Paramètres système (Settings) ===

export interface Setting {
  id: string;
  key: string;
  value: string;
  category: string;
  label: string;
  updated_at: string;
}

export type SettingsByCategory = Record<string, Setting[]>;

// === Module 5 — Tableaux de bord analytiques ===

export interface SessionStats {
  total: number;
  draft: number;
  open: number;
  closed: number;
  validated: number;
}

export interface MentionDistribution {
  labels: string[];
  values: number[];
}

export interface EntityPerformance {
  id: string;
  name: string;
  student_count: number;
  class_count?: number;
  completion_rate: number;
  avg_performance: number;
  session_count: number;
}

export interface MonthlyTrend {
  month: number;
  year: number;
  label: string;
  completion_rate: number;
  avg_performance: number;
  student_count: number;
}

export interface DashboardData {
  scope: "global" | "iep" | "school" | "class";
  scope_name: string;
  school_count?: number;
  class_count: number;
  student_count: number;
  teacher_count: number;
  session_stats: SessionStats;
  completion_rate: number;
  avg_performance: number;
  pass_rate: number;
  schools?: EntityPerformance[];
  classes?: EntityPerformance[];
  mentions: MentionDistribution;
  monthly_trend: MonthlyTrend[];
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
