// Types TypeScript correspondant aux modèles GORM du backend Go (models/models.go)
// Ces types garantissent le typage statique entre le frontend et l'API.

export type Role = "teacher" | "director" | "inspector" | "admin";

export const ROLE_LABELS: Record<Role, string> = {
  teacher: "Instituteur",
  director: "Directeur d'École",
  inspector: "Admin IEP",
  admin: "Super-Administrateur",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  teacher: "Saisie des notes mensuelles de votre classe",
  director: "Gestion de l'établissement et validation des bulletins",
  inspector: "Administration multi-écoles (sauf paramètres généraux)",
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
  must_change_password?: boolean;
  service?: string;
  // Architecture D — Suspension
  suspended_at?: string | null;
  suspended_by_id?: string | null;
  suspended_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface IEP {
  id: string;
  name: string;
  region: string;
  // === Informations de l'inspecteur titulaire de l'IEP ===
  // Ces champs alimentent automatiquement le document de synthèse des
  // résultats (signatures + en-tête "BP / Tel / Courriel"). Évite de les
  // ressaisir à chaque impression.
  inspector_name: string;
  inspector_email: string;
  inspector_phone: string;
  bp: string; // Boîte postale de l'IEP
  created_at: string;
}

export interface School {
  id: string;
  iep_id: string;
  code: string; // code unique identifiant l'école dans le système IEP
  name: string;
  address: string;
  status: SchoolStatus; // public | private | community
  logo_path?: string; // clé stockage (R2 prod / FS dev) — URL calculée par l'API
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
  birth_year?: number | null; // année de naissance seule (ex: 2006) — null si non renseignée
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

// Statuts d'une session de saisie.
//
// Cycle de vie :
//   draft ──open──► open ──close──► closed ──validate──► validated ──archive──► archived
//     │                  │
//     └──cancel──► cancelled
//
// Statuts "actifs" (cycle en cours) : draft, open, closed, validated
// Statuts "terminaux" (lecture seule, plus de modification) :
//   - cancelled : session annulée (raison obligatoire). Les notes sont
//     supprimées à l'annulation. Conservée pour l'audit.
//   - archived  : session validée puis archivée (manuel ou cron fin d'année).
//     Les notes sont CONSERVÉES et nourrissent le bilan annuel + la
//     comparaison inter-annuelle. Masquée de l'UI active par défaut.
export type SessionStatus =
  | "draft"
  | "open"
  | "closed"
  | "validated"
  | "cancelled"
  | "archived";
export type EvalType = "composition" | "exam_blanc";

export const EVAL_TYPE_LABELS: Record<EvalType, string> = {
  composition: "Composition",
  exam_blanc: "Examen Blanc",
};

export interface EvaluationSession {
  id: string;
  // Approche A — 1 session par ÉCOLE (pas par classe).
  // SchoolID remplace ClassID : toutes les classes actives de l'école
  // participent à la session, sauf celles exemptées via SessionExemption.
  school_id: string;
  month: number;
  year: number;
  status: SessionStatus;
  eval_type: EvalType;
  eval_number: number;
  open_at: string | null;
  close_at: string | null;
  auto_open: boolean;
  // Métadonnées d'annulation (renseignées si status === "cancelled")
  cancel_reason?: string;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
  // Métadonnées d'archivage (renseignées si status === "archived").
  // archived_by = "system-cron" pour l'auto-archivage de fin d'année, sinon
  // l'ID de l'utilisateur (admin/director) qui a archivé manuellement.
  archived_at?: string | null;
  archived_by?: string | null;
  created_at: string;
  updated_at: string;
}

// SessionExemption — permet d'exempter une classe précise (class_id) ou un
// niveau entier (level = CP|CE|CM) d'une session. Au moins un des deux champs
// doit être renseigné. Les deux peuvent être cumulés pour documenter à la fois
// la classe et le niveau concerné.
export interface SessionExemption {
  id: string;
  session_id: string;
  class_id?: string | null; // NULL = pas une classe précise
  level?: string | null; // "CP"|"CE"|"CM" = tout le niveau
  reason: string;
  created_at: string;
}

// SessionExemptionWithDetails — exemption enrichie du nom de la classe
// (rempli par le backend quand class_id est défini).
export interface SessionExemptionWithDetails extends SessionExemption {
  class_name?: string;
}

export interface Grade {
  id: string;
  student_id: string;
  subject_id: string;
  session_id: string;
  value: number; // note brute (sur max_score, pas forcément 20)
  is_draft: boolean;
  updated_at: string;
}

// === Barème de notation (GradeScale) ===
export interface GradeScale {
  id: string;
  level: string; // "CP" | "CE" | "CM"
  subject_id?: string | null; // NULL = défaut du niveau
  max_score: number; // 10, 20, 30, 50...
  created_at: string;
  updated_at: string;
}

export interface GradeScaleWithSubject extends GradeScale {
  subject_name?: string;
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
  logo_url?: string; // URL présignée (TTL court) — à recharger après expiration
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
  // Approche A — la session couvre toute l'école. class_name est vide côté
  // backend (multi-classes). Conservé en option pour compatibilité affichage.
  class_name?: string;
  school_name?: string;
  class_count: number; // nombre de classes actives de l'école
  exemption_count: number; // nombre d'exemptions déclarées sur la session
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
  grade: number; // -1 si aucune note (valeur brute)
  max_score: number; // barème (10, 20, 30, 50...)
  normalized_value: number; // note normalisée sur /20
  has_grade: boolean;
  is_draft: boolean;
}

export interface StudentResult {
  student_id: string;
  matricule: string;
  first_name: string;
  last_name: string;
  // Approche A — chaque élève porte SA propre classe (la session couvre
  // toute l'école, donc les résultats mélangent CP1, CP2, ..., CM2).
  class_name?: string;
  class_id?: string;
  class_level?: string; // CP | CE | CM
  average_scale?: number; // 10 (CP/CE) ou 20 (CM) — par élève
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
  // Approche A — la session couvre toute l'école. class_name et class_level
  // sont vides côté backend (multi-classes/multi-niveaux). average_scale vaut
  // 20 par défaut (compat statistiques agrégées). Le détail par élève (classe,
  // niveau, barème) est dans chaque StudentResult.
  class_name: string;
  class_level: string; // "" (multi-niveaux)
  average_scale: number; // 20 (défaut CM, pour compat stats agrégées)
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
  // Statuts terminaux (annulation + archivage) — exclus du taux de complétion
  cancelled: number;
  archived: number;
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

export interface YearComparison {
  current_year: number;
  previous_year: number;
  current_perf: number;
  previous_perf: number;
  perf_delta: number;
  current_pass_rate: number;
  previous_pass_rate: number;
  pass_delta: number;
}

export interface DashboardData {
  scope: "global" | "iep" | "school" | "class";
  scope_name: string;
  year_filter?: number;
  gender_filter?: string;
  level_filter?: string;
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
  year_comparison?: YearComparison;
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
  must_change_password: boolean;
}

export interface PasswordResetRequest {
  id: string;
  identifier: string;
  role_hint: string;
  user_id?: string;
  user_name?: string;
  status: "pending" | "approved" | "rejected";
  reset_token?: string;
  message?: string;
  admin_note?: string;
  created_at: string;
  resolved_at?: string;
}

export interface ApiError {
  error: string;
}

// Listes valides (cahier des charges §3 — école primaire ivoirienne)
export const CLASS_NAMES = ["CP1", "CP2", "CE1", "CE2", "CM1", "CM2"] as const;
export const CLASS_LEVELS = ["CP", "CE", "CM"] as const;

// === Architecture D — Dynamic RBAC + Audit ===

// Module metadata (mirrors backend models.AllModuleMetas())
export interface ModuleMeta {
  key: string;
  label: string;
  description: string;
  icon_hint: string;
}

// Cellule de la matrice (role × module)
export interface PermissionCell {
  key: string;
  label: string;
  description: string;
  icon_hint: string;
  can_read: boolean;
  can_write: boolean;
  irreducible: boolean; // true = ne peut pas être décoché (sécurité anti auto-blocage)
}

// Un rôle avec sa liste de cellules
export interface PermissionRole {
  id: string;
  name: string;
  label: string;
  description: string;
  is_system: boolean;
  sort_order: number;
  modules: PermissionCell[];
}

// Réponse de GET /api/permissions
export interface PermissionsMatrixResponse {
  roles: PermissionRole[];
  modules: ModuleMeta[];
}

// Réponse de PUT /api/permissions
export interface UpdatePermissionResponse {
  ok: boolean;
  role_id: string;
  module_key: string;
  can_read: boolean;
  can_write: boolean;
}

// Réponse de GET /api/me/modules
export interface UserModulesResponse {
  modules: string[];
  role: string;
}

// Une entrée du journal d'audit (GET /api/audit-logs)
export interface AuditLog {
  id: string;
  actor_id?: string;
  actor_role: string;
  actor_name?: string;
  actor_email?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  details?: string;
  ip?: string;
  user_agent?: string;
  created_at: string;
}

export interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

// User vu par l'admin (GET /api/users) — même structure que User, plus rien de sensible
export type UserAdminRow = User;

// === PDA IEPP — Plan d'Action Pluriannuel (compositions + examens blancs) ===
// Reproduction du document officiel « SUIVI DU PLAN D'ACTION PLURIANNUEL DE
// L'IEPP ». Le plan suit les compositions mensuelles (notes dérivées du
// module Notes) ET les examens blancs (saisie manuelle) pour les élèves de
// CE et CM, dans les 3 matières désignées : Exploitation de texte,
// Mathématiques, Dictée.
// Maîtrise : Admis = présent ET note >= barème × seuil % — barème selon la
// source : blanc = PDA fixe (CE=/10, CM=/20) ; composition = GradeScale réel.

export type PdaExamKind = "blanc" | "composition";

export interface PdaExam {
  id: string;
  school_id: string;
  school_name?: string;
  kind: PdaExamKind;
  session_id?: string | null;
  // Enrichissement liste (compositions uniquement)
  session_month?: number | null;
  session_status?: string;
  number: number;
  year: number;
  exam_date?: string | null;
  threshold: number;
  created_at: string;
  updated_at: string;
}

// État d'une matière désignée pour l'évaluation (barème + seuil absolus).
// Pour une composition, max_score/seuil viennent du GradeScale réel du
// niveau et de la matière ; matched=false = matière non notée dans les
// compositions (aucune dérivation possible — avertissement affiché).
export interface PdaSubjectInfo {
  key: "exploitation" | "math" | "dictee";
  label: string;
  matched: boolean;
  subject_id?: string;
  subject_name?: string;
  max_score: number;
  seuil: number;
}

export interface PdaClassInfo {
  id: string;
  name: string;
  level: string;
  // Barème PDA uniforme (blancs uniquement — 0 pour une composition,
  // les barèmes par matière étant dans subjects[]).
  max_score: number;
  seuil: number;
}

// Ligne élève de la grille (GET .../results)
export interface PdaStudentRow {
  student_id: string;
  matricule: string;
  last_name: string;
  first_name: string;
  gender: string; // M / F
  present: boolean;
  note_exploitation?: number | null;
  note_math?: number | null;
  note_dictee?: number | null;
  admis_exploitation: boolean;
  admis_math: boolean;
  admis_dictee: boolean;
  admis_global: boolean;
}

export interface PdaResultsResponse {
  exam: PdaExam;
  // true = composition mensuelle (notes dérivées du module Notes)
  read_only: boolean;
  // Barème + seuil par matière (ordre : exploitation, math, dictée)
  subjects: PdaSubjectInfo[];
  class: PdaClassInfo;
  students: PdaStudentRow[];
  count: number;
}

// Effectifs Total | Filles | Garçons d'une ligne du document
export interface PdaCountRow {
  total: number;
  filles: number;
  garcons: number;
}

// Stats de maîtrise d'une matière (Tableau 2)
export interface PdaSubjectStats {
  presents: PdaCountRow;
  admis: PdaCountRow;
  non_admis: PdaCountRow;
  pct_admis: number;
  pct_non_admis: number;
}

// IEP pour l'en-tête officiel du document
export interface PdaIepInfo {
  id: string;
  name: string;
  region: string;
  inspector_name: string;
  inspector_email: string;
  inspector_phone: string;
  bp: string;
}

// Synthèse agrégée (GET .../summary) — les 3 tableaux du document
export interface PdaSummary {
  exam: PdaExam;
  read_only: boolean;
  // Barème + seuil par matière (ordre : exploitation, math, dictée)
  subjects: PdaSubjectInfo[];
  school: { id: string; name: string; code: string };
  iep: PdaIepInfo | null;
  class: PdaClassInfo;
  table1: { presents: PdaCountRow; admis: PdaCountRow; pct_admis: number };
  table2: {
    exploitation: PdaSubjectStats;
    math: PdaSubjectStats;
    dictee: PdaSubjectStats;
  };
  table3: {
    difficultes: PdaCountRow;
    mise_a_niveau: PdaCountRow;
    remediation: PdaCountRow;
  };
}

// Compteurs de remédiation (lignes 2-3 du tableau 3 — saisie manuelle)
export interface PdaRemediation {
  class_id: string;
  mise_a_niveau_total: number;
  mise_a_niveau_garcons: number;
  mise_a_niveau_filles: number;
  remediation_total: number;
  remediation_garcons: number;
  remediation_filles: number;
}

// === Suivi pluriannuel (GET /api/pda/timeline) — matrice élève × évaluations ===
// Toutes les évaluations du plan d'une année pour une classe CE/CM :
// compositions mensuelles (dérivées) + examens blancs (saisie manuelle).

export interface PdaTimelineEvaluation {
  id: string;
  kind: PdaExamKind;
  label: string; // « Composition N°2 — Octobre 2026 » / « Examen blanc N°1 »
  short_label: string; // « C2 » / « EB1 » (en-tête compact de la matrice)
  number: number;
  year: number;
  month?: number | null;
  threshold: number;
  read_only: boolean;
  subject_maxes: [number, number, number];
  subject_seuils: [number, number, number];
}

export interface PdaTimelineCell {
  present: boolean;
  notes: [number | null, number | null, number | null];
  admis: [boolean, boolean, boolean];
  admis_global: boolean;
}

export interface PdaTimelineStudent {
  student_id: string;
  matricule: string;
  last_name: string;
  first_name: string;
  gender: string; // M / F
  cells: Record<string, PdaTimelineCell>;
  presents: number;
  admis_global_count: number;
  pct_admis: number;
}

export interface PdaTimelineSubject {
  key: "exploitation" | "math" | "dictee";
  label: string;
  matched: boolean;
  subject_id?: string;
  subject_name?: string;
  max_composition: number; // barème compositions (0 = non notée)
  max_blanc: number; // barème PDA des examens blancs
}

export interface PdaTimelineResponse {
  class: { id: string; name: string; level: string };
  year: number;
  evaluations: PdaTimelineEvaluation[];
  students: PdaTimelineStudent[];
  subjects: PdaTimelineSubject[];
  warnings: string[];
  count: number;
}
