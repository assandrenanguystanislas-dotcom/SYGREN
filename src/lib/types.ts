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

// Réponses API
export interface LoginResponse {
  token: string;
  user: User;
}

export interface ApiError {
  error: string;
}
