"use client";

import { useEffect, useState } from "react";
import { Loader2, GraduationCap } from "lucide-react";

import { Providers } from "@/components/providers";
import { useAuthStore } from "@/lib/auth-store";
import { LoginView } from "@/components/login-view";
import { DashboardShell, NAV_ITEMS } from "@/components/dashboard-shell";
import { WelcomeDashboard } from "@/components/dashboards/welcome-dashboard";
import { IepView } from "@/components/views/iep-view";
import { SchoolsView } from "@/components/views/schools-view";
import { ClassesView } from "@/components/views/classes-view";
import { StudentsView } from "@/components/views/students-view";
import { TeachersView } from "@/components/views/teachers-view";
import { SubjectsView } from "@/components/views/subjects-view";
import { SessionsView } from "@/components/views/sessions-view";
import { GradesGrid } from "@/components/views/grades-view";
import { ResultsView } from "@/components/views/results-view";
import { BulletinsView } from "@/components/views/bulletins-view";
import { PlaceholderView } from "@/components/views/placeholder-view";
import { Settings } from "lucide-react";

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
      {view === "iep" && <IepView />}
      {view === "schools" && <SchoolsView />}
      {view === "classes" && <ClassesView />}
      {view === "students" && <StudentsView />}
      {view === "teachers" && <TeachersView />}
      {view === "subjects" && <SubjectsView />}
      {view === "sessions" && <SessionsView />}
      {view === "grades" && <GradesGrid />}
      {view === "results" && <ResultsView />}
      {view === "bulletins" && <BulletinsView />}
      {view === "settings" && (
        <PlaceholderView
          title="Paramètres Système"
          description="Configuration globale du système SYGREN. Seuils de mentions, coefficients, sauvegarde des données."
          icon={Settings}
          phase="Phase à venir"
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
