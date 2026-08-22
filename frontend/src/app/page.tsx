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
import { StudentsView } from "@/components/views/students-view";
import { UsersView } from "@/components/views/users-view";
import { SubjectsView } from "@/components/views/subjects-view";
import { EvaluationsView } from "@/components/views/evaluations-view";
import { ResultsView } from "@/components/views/results-view";
import { BulletinsView } from "@/components/views/bulletins-view";
import { AnalyticsDashboard } from "@/components/views/analytics-dashboard";
import { SettingsView } from "@/components/views/settings-view";
import { PlaceholderView } from "@/components/views/placeholder-view";

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
  // Active view persistée dans l'URL hash (#students, #sessions, etc.) pour
  // survivre au refresh + intégrer le bouton back/forward du navigateur.
  // Lazy init : lit le hash au premier render (survit au refresh).
  const [activeView, setActiveView] = useState(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.slice(1); // enlève le '#'
      const navItem = NAV_ITEMS.find((n) => n.id === hash);
      if (navItem) return hash;
    }
    return "dashboard";
  });

  // Marque le store comme hydraté après le premier render client.
  useEffect(() => {
    setHydrated(true);
  }, [setHydrated]);

  // Met à jour l'URL hash quand la vue change (replaceState = pas de hashchange,
  // évite une boucle setActiveView → hashchange → setActiveView).
  useEffect(() => {
    if (activeView !== "dashboard") {
      window.history.replaceState(null, "", `#${activeView}`);
    } else if (window.location.hash) {
      // Dashboard = URL propre (sans hash).
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [activeView]);

  // Écoute le bouton back/forward du navigateur (hashchange) → met à jour
  // activeView pour suivre la navigation du navigateur.
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1);
      const navItem = NAV_ITEMS.find((n) => n.id === hash);
      setActiveView(navItem ? hash : "dashboard");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

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
      {view === "dashboard" &&
        (user.role === "teacher" ? (
          <WelcomeDashboard onNavigate={setActiveView} />
        ) : (
          <AnalyticsDashboard />
        ))}
      {view === "iep" && <IepView />}
      {view === "schools" && <SchoolsView />}
      {view === "students" && <StudentsView />}
      {view === "users" && <UsersView />}
      {view === "subjects" && <SubjectsView />}
      {view === "evaluations" && <EvaluationsView />}
      {view === "results" && <ResultsView />}
      {view === "bulletins" && <BulletinsView />}
      {view === "settings" && <SettingsView />}
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
