"use client";

import { useEffect, useState } from "react";
import { Loader2, GraduationCap } from "lucide-react";

import { Providers } from "@/components/providers";
import { useAuthStore } from "@/lib/auth-store";
import { LoginView } from "@/components/login-view";
import { DashboardShell, NAV_ITEMS } from "@/components/dashboard-shell";
import { WelcomeDashboard } from "@/components/dashboards/welcome-dashboard";
import { SubjectsView } from "@/components/views/subjects-view";
import { PlaceholderView } from "@/components/views/placeholder-view";
import {
  School,
  Users,
  BookOpen,
  ClipboardList,
  FileText,
  TrendingUp,
  Settings,
  BarChart3,
} from "lucide-react";

/** Écran de chargement pendant la vérification de l'auth. */
function FullScreenLoader() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
      <div className="absolute inset-x-0 top-0 h-1.5 ci-flag-stripe" />
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
        <GraduationCap className="w-8 h-8" />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Initialisation de SYGREN…
      </div>
    </div>
  );
}

function AppContent() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);
  const setHydrated = useAuthStore((s) => s.setHydrated);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [activeView, setActiveView] = useState("dashboard");

  // Marque le store comme hydraté après le premier render client.
  // setHydrated est un setter Zustand (pas un useState), donc pas concerné
  // par la règle react-hooks/set-state-in-effect.
  useEffect(() => {
    setHydrated(true);
  }, [setHydrated]);

  // Si on a un token mais pas d'utilisateur (après rafraîchissement de page),
  // on recharge le profil depuis l'API. Effet légitime : synchronisation avec
  // un système externe (le backend Go).
  useEffect(() => {
    if (hydrated && token && !user) {
      refreshUser();
    }
  }, [hydrated, token, user, refreshUser]);

  // L'auth est "prête" quand : hydratée ET (pas de token OU token + user).
  // Tant que refreshUser est en cours (token sans user), on affiche le loader.
  const isReady = hydrated && (!token || !!user);

  if (!isReady) {
    return <FullScreenLoader />;
  }

  // Non connecté → vue de connexion
  if (!token || !user) {
    return <LoginView />;
  }

  // Connecté → tableau de bord
  const navItem = NAV_ITEMS.find((n) => n.id === activeView);
  const allowed = navItem?.roles.includes(user.role) ?? false;

  // Vue par défaut si la vue active n'est pas autorisée pour ce rôle
  const view = allowed ? activeView : "dashboard";

  return (
    <DashboardShell activeView={view} onViewChange={setActiveView}>
      {view === "dashboard" && (
        <WelcomeDashboard onNavigate={setActiveView} />
      )}
      {view === "subjects" && <SubjectsView />}
      {view === "iep" && (
        <PlaceholderView
          title="Gestion des Inspections (IEP)"
          description="Création et configuration des circonscriptions scolaires. Chaque IEP regroupe plusieurs écoles et est supervisée par un inspecteur."
          icon={BarChart3}
          phase="Phase 2 — Module 1"
        />
      )}
      {view === "schools" && (
        <PlaceholderView
          title="Gestion des Écoles"
          description="Configuration des établissements scolaires rattachés à une IEP. Adresse, directeurs, classes associées."
          icon={School}
          phase="Phase 2 — Module 1"
        />
      )}
      {view === "classes" && (
        <PlaceholderView
          title="Gestion des Classes"
          description="Création des classes (CP1, CP2, CE1, CE2, CM1, CM2) et affectation dynamique des enseignants."
          icon={BookOpen}
          phase="Phase 2 — Module 1"
        />
      )}
      {view === "students" && (
        <PlaceholderView
          title="Gestion des Élèves"
          description="Enregistrement des élèves avec attribution d'un matricule unique. Inscription dans une classe."
          icon={Users}
          phase="Phase 2 — Module 1"
        />
      )}
      {view === "teachers" && (
        <PlaceholderView
          title="Gestion des Enseignants"
          description="Création des comptes enseignants et affectation dynamique aux classes de l'établissement."
          icon={Users}
          phase="Phase 2 — Module 1"
        />
      )}
      {view === "grades" && (
        <PlaceholderView
          title="Saisie des Notes Mensuelles"
          description="Grille de saisie type tableur pour une saisie fluide au clavier. Brouillon automatique pour prévenir la perte de données."
          icon={ClipboardList}
          phase="Phase 3 — Module 2"
        />
      )}
      {view === "bulletins" && (
        <PlaceholderView
          title="Édition des Bulletins"
          description="Génération PDF automatisée des bulletins officiels. Impression par lot (classe/école) ou individuelle."
          icon={FileText}
          phase="Phase 5 — Module 4"
        />
      )}
      {view === "settings" && (
        <PlaceholderView
          title="Paramètres Système"
          description="Configuration globale du système SYGREN. Seuils de mentions, coefficients, sauvegarde des données."
          icon={Settings}
          phase="Phase 2 — Module 1"
        />
      )}
    </DashboardShell>
  );
}

export default function Home() {
  return (
    <Providers>
      <AppContent />
    </Providers>
  );
}
