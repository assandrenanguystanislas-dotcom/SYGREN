"use client";

import { useSyncExternalStore } from "react";
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
} from "lucide-react";

import { useAuthStore } from "@/lib/auth-store";
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

const STATS_BY_ROLE: Record<Role, StatCard[]> = {
  admin: [
    { label: "Inspections (IEP)", value: "0", hint: "à configurer", icon: <TrendingUp className="w-5 h-5" />, tone: "orange" },
    { label: "Écoles enregistrées", value: "0", hint: "à configurer", icon: <School className="w-5 h-5" />, tone: "green" },
    { label: "Utilisateurs", value: "1", hint: "admin actif", icon: <Users className="w-5 h-5" />, tone: "neutral" },
    { label: "Matières configurées", value: "8", hint: "par défaut", icon: <BookOpen className="w-5 h-5" />, tone: "orange" },
  ],
  director: [
    { label: "Classes de l'école", value: "—", hint: "à créer", icon: <BookOpen className="w-5 h-5" />, tone: "green" },
    { label: "Élèves inscrits", value: "—", hint: "à inscrire", icon: <Users className="w-5 h-5" />, tone: "orange" },
    { label: "Enseignants", value: "—", hint: "à affecter", icon: <Users className="w-5 h-5" />, tone: "neutral" },
    { label: "Bulletins émis", value: "0", hint: "cette année", icon: <FileText className="w-5 h-5" />, tone: "green" },
  ],
  inspector: [
    { label: "Écoles supervisées", value: "—", hint: "circonscription", icon: <School className="w-5 h-5" />, tone: "orange" },
    { label: "Taux de complétion", value: "—", hint: "saisies du mois", icon: <ClipboardList className="w-5 h-5" />, tone: "green" },
    { label: "Moyenne circonscription", value: "—", hint: "calcul auto", icon: <TrendingUp className="w-5 h-5" />, tone: "neutral" },
    { label: "Bulletins émis", value: "0", hint: "ce mois", icon: <FileText className="w-5 h-5" />, tone: "orange" },
  ],
  teacher: [
    { label: "Ma classe", value: "—", hint: "à affecter", icon: <BookOpen className="w-5 h-5" />, tone: "green" },
    { label: "Mes élèves", value: "—", hint: "à inscrire", icon: <Users className="w-5 h-5" />, tone: "orange" },
    { label: "Saisie en cours", value: "Aucune", hint: "session fermée", icon: <Clock className="w-5 h-5" />, tone: "neutral" },
    { label: "Moyenne de classe", value: "—", hint: "auto-calculée", icon: <TrendingUp className="w-5 h-5" />, tone: "green" },
  ],
};

interface WelcomeDashboardProps {
  onNavigate: (view: string) => void;
}

export function WelcomeDashboard({ onNavigate }: WelcomeDashboardProps) {
  const user = useAuthStore((s) => s.user);

  // Lecture de la date côté client uniquement (évite le mismatch SSR/hydratation)
  // via useSyncExternalStore, le pattern React recommandé.
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

  if (!user) return null;

  const stats = STATS_BY_ROLE[user.role];
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
              Phase 1 en cours — Fondations posées
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              L'authentification JWT et le RBAC (4 rôles) sont opérationnels.
              Le backend Go tourne sur le port 8080 et le frontend Next.js sur
              le port 3000. Les modules de gestion (écoles, classes, élèves)
              seront implémentés dans la Phase 2.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const QUICK_ACTIONS: Record<
  Role,
  { label: string; hint: string; view: string; icon: React.ReactNode }[]
> = {
  admin: [
    { label: "Gérer les matières", hint: "8 matières configurées", view: "subjects", icon: <BookOpen className="w-4 h-4" /> },
    { label: "Créer une IEP", hint: "Inspection de circonscription", view: "iep", icon: <TrendingUp className="w-4 h-4" /> },
    { label: "Gérer les écoles", hint: "Établissements scolaires", view: "schools", icon: <School className="w-4 h-4" /> },
  ],
  director: [
    { label: "Mes classes", hint: "CP1 → CM2", view: "classes", icon: <BookOpen className="w-4 h-4" /> },
    { label: "Inscrire un élève", hint: "Matricule unique", view: "students", icon: <Users className="w-4 h-4" /> },
    { label: "Gérer les matières", hint: "Disciplines", view: "subjects", icon: <BookOpen className="w-4 h-4" /> },
  ],
  inspector: [
    { label: "Vue analytique", hint: "Multi-écoles", view: "dashboard", icon: <TrendingUp className="w-4 h-4" /> },
    { label: "Écoles supervisées", hint: "Circonscription", view: "schools", icon: <School className="w-4 h-4" /> },
    { label: "Bulletins", hint: "Impression par lot", view: "bulletins", icon: <FileText className="w-4 h-4" /> },
  ],
  teacher: [
    { label: "Saisir les notes", hint: "Grille mensuelle", view: "grades", icon: <ClipboardList className="w-4 h-4" /> },
    { label: "Ma classe", hint: "Mes élèves", view: "classes", icon: <BookOpen className="w-4 h-4" /> },
    { label: "Matières", hint: "Disciplines", view: "subjects", icon: <BookOpen className="w-4 h-4" /> },
  ],
};
