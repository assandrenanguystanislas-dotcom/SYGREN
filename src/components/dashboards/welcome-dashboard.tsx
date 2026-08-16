"use client";

import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  School,
  Users,
  BookOpen,
  ClipboardList,
  FileText,
  TrendingUp,
  CheckCircle2,
  Clock,
  ArrowRight,
  Sparkles,
  BarChart3,
} from "lucide-react";

import { useAuthStore } from "@/lib/auth-store";
import { iepApi, schoolsApi, studentsApi, subjectsApi, teachersApi } from "@/lib/api";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface StatCard {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone: "orange" | "green" | "neutral";
}

export function WelcomeDashboard({ onNavigate }: { onNavigate: (view: string) => void }) {
  const user = useAuthStore((s) => s.user);

  // Lecture de la date côté client (évite le mismatch SSR/hydratation)
  const now = useSyncExternalStore(
    () => () => {},
    () =>
      new Date().toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    () => "",
  );

  // Statistiques dynamiques — chargées en parallèle, seulement si l'utilisateur a le droit
  const { data: iepData } = useQuery({
    queryKey: ["iep"],
    queryFn: iepApi.list,
    enabled: user?.role === "admin",
  });
  const { data: schoolsData } = useQuery({
    queryKey: ["schools"],
    queryFn: schoolsApi.list,
    enabled: !!user,
  });
  const { data: studentsData } = useQuery({
    queryKey: ["students"],
    queryFn: () => studentsApi.list(),
    enabled: !!user && user.role !== "inspector",
  });
  const { data: subjectsData } = useQuery({
    queryKey: ["subjects"],
    queryFn: subjectsApi.list,
    enabled: !!user,
  });
  const { data: teachersData } = useQuery({
    queryKey: ["teachers"],
    queryFn: teachersApi.list,
    enabled: !!user && (user.role === "admin" || user.role === "director"),
  });

  if (!user) return null;

  const stats = buildStats(
    user.role,
    {
      iepCount: iepData?.count ?? 0,
      schoolCount: schoolsData?.count ?? 0,
      studentCount: studentsData?.count ?? 0,
      subjectCount: subjectsData?.count ?? 0,
      teacherCount: teachersData?.count ?? 0,
    },
  );

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";

  return (
    <div className="space-y-6">
      {/* Bannière de bienvenue */}
      <Card className="relative overflow-hidden border-border/60">
        <div className="absolute inset-x-0 top-0 h-1 ci-flag-stripe" />
        <CardContent className="pt-6 pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="capitalize">
                  {ROLE_LABELS[user.role]}
                </Badge>
                <span className="text-xs text-muted-foreground">{now}</span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight">
                {greeting}, {user.full_name.split(" ")[0]} 👋
              </h2>
              <p className="text-sm text-muted-foreground max-w-xl">
                {ROLE_DESCRIPTIONS[user.role]}
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>Système opérationnel</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--success)]" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cartes statistiques */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className="border-border/60 hover:shadow-md transition-shadow"
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {stat.label}
              </CardTitle>
              <div
                className={
                  stat.tone === "orange"
                    ? "text-primary"
                    : stat.tone === "green"
                      ? "text-[var(--success)]"
                      : "text-muted-foreground"
                }
              >
                {stat.icon}
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              {stat.hint && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {stat.hint}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Actions rapides selon le rôle */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">Actions rapides</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_ACTIONS[user.role].map((action) => (
            <button
              key={action.view}
              onClick={() => onNavigate(action.view)}
              className="group flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3 text-left transition-all hover:border-primary/40 hover:bg-muted/40"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                {action.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{action.label}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {action.hint}
                </p>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Notice pédagogique */}
      <Card className="border-dashed border-primary/30 bg-primary/[0.02]">
        <CardContent className="py-4 flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="text-sm space-y-1">
            <p className="font-medium text-foreground">
              Phase 2 — Module 1 opérationnel
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              La gestion administrative est complète : IEP, écoles, classes,
              élèves (matricule unique), enseignants et matières. Les statistiques
              ci-dessus sont calculées en temps réel depuis le backend Go.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface StatsData {
  iepCount: number;
  schoolCount: number;
  studentCount: number;
  subjectCount: number;
  teacherCount: number;
}

function buildStats(role: Role, d: StatsData): StatCard[] {
  switch (role) {
    case "admin":
      return [
        { label: "Inspections (IEP)", value: String(d.iepCount), hint: "circonscriptions", icon: <BarChart3 className="w-5 h-5" />, tone: "orange" },
        { label: "Écoles enregistrées", value: String(d.schoolCount), hint: "toutes IEP confondues", icon: <School className="w-5 h-5" />, tone: "green" },
        { label: "Élèves inscrits", value: String(d.studentCount), hint: "matricules uniques", icon: <Users className="w-5 h-5" />, tone: "neutral" },
        { label: "Enseignants", value: String(d.teacherCount), hint: "comptes actifs", icon: <Users className="w-5 h-5" />, tone: "orange" },
      ];
    case "director":
      return [
        { label: "Classes de l'école", value: "—", hint: "voir l'onglet Classes", icon: <BookOpen className="w-5 h-5" />, tone: "green" },
        { label: "Élèves inscrits", value: String(d.studentCount), hint: "dans mon école", icon: <Users className="w-5 h-5" />, tone: "orange" },
        { label: "Enseignants", value: String(d.teacherCount), hint: "comptes actifs", icon: <Users className="w-5 h-5" />, tone: "neutral" },
        { label: "Matières", value: String(d.subjectCount), hint: "disciplines", icon: <BookOpen className="w-5 h-5" />, tone: "green" },
      ];
    case "inspector":
      return [
        { label: "Écoles supervisées", value: String(d.schoolCount), hint: "ma circonscription", icon: <School className="w-5 h-5" />, tone: "orange" },
        { label: "Enseignants", value: String(d.teacherCount), hint: "dans mon IEP", icon: <Users className="w-5 h-5" />, tone: "green" },
        { label: "Matières configurées", value: String(d.subjectCount), hint: "disciplines", icon: <BookOpen className="w-5 h-5" />, tone: "neutral" },
        { label: "Tableaux de bord", value: "—", hint: "à venir (Phase 6)", icon: <TrendingUp className="w-5 h-5" />, tone: "orange" },
      ];
    case "teacher":
      return [
        { label: "Mes élèves", value: String(d.studentCount), hint: "dans ma classe", icon: <Users className="w-5 h-5" />, tone: "green" },
        { label: "Matières", value: String(d.subjectCount), hint: "disciplines à noter", icon: <BookOpen className="w-5 h-5" />, tone: "orange" },
        { label: "Saisie en cours", value: "Aucune", hint: "session fermée", icon: <Clock className="w-5 h-5" />, tone: "neutral" },
        { label: "Bulletins", value: "0", hint: "à venir (Phase 5)", icon: <FileText className="w-5 h-5" />, tone: "green" },
      ];
  }
}

const QUICK_ACTIONS: Record<
  Role,
  { label: string; hint: string; view: string; icon: React.ReactNode }[]
> = {
  admin: [
    { label: "Gérer les IEP", hint: "Circonscriptions scolaires", view: "iep", icon: <BarChart3 className="w-4 h-4" /> },
    { label: "Gérer les écoles", hint: "Établissements", view: "schools", icon: <School className="w-4 h-4" /> },
    { label: "Inscrire un élève", hint: "Matricule auto", view: "students", icon: <Users className="w-4 h-4" /> },
  ],
  director: [
    { label: "Mes classes", hint: "CP1 → CM2", view: "classes", icon: <BookOpen className="w-4 h-4" /> },
    { label: "Inscrire un élève", hint: "Matricule unique", view: "students", icon: <Users className="w-4 h-4" /> },
    { label: "Gérer les enseignants", hint: "Comptes", view: "teachers", icon: <Users className="w-4 h-4" /> },
  ],
  inspector: [
    { label: "Vue analytique", hint: "Multi-écoles", view: "dashboard", icon: <TrendingUp className="w-4 h-4" /> },
    { label: "Écoles supervisées", hint: "Circonscription", view: "schools", icon: <School className="w-4 h-4" /> },
    { label: "Bulletins", hint: "Impression par lot", view: "bulletins", icon: <FileText className="w-4 h-4" /> },
  ],
  teacher: [
    { label: "Saisir les notes", hint: "Grille mensuelle", view: "grades", icon: <ClipboardList className="w-4 h-4" /> },
    { label: "Mes élèves", hint: "Ma classe", view: "students", icon: <Users className="w-4 h-4" /> },
    { label: "Matières", hint: "Disciplines", view: "subjects", icon: <BookOpen className="w-4 h-4" /> },
  ],
};
