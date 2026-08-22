"use client";

import { useEffect, useState, useRef } from "react";
import { Loader2, GraduationCap, Lock } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/api";

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
import { SettingsView, type SettingsTab } from "@/components/views/settings-view";
import { AuditView } from "@/components/views/audit-view";
import type { NavItem } from "@/components/dashboard-shell";
import type { User } from "@/lib/types";

/**
 * Architecture D-Phase3 (étendu en Phase4) — Refonte Settings en onglets.
 * « baremes », « permissions » et « reset-requests » ne sont plus des
 * entrées de nav top-level : ce sont désormais des sous-onglets de la
 * page Paramètres. On les mappe vers « settings » pour le routing
 * top-level (le navItem correspondant doit exister dans NAV_ITEMS pour
 * passer le guard isViewAllowed). Le sous-onglet à ouvrir initialement
 * est calculé plus bas à partir du hash URL originel.
 */
function resolveView(view: string): string {
  if (
    view === "baremes" ||
    view === "permissions" ||
    view === "reset-requests"
  ) {
    return "settings";
  }
  return view;
}

/**
 * Helper : détermine si une vue est autorisée pour le user.
 * Architecture D — utilise la liste dynamique `modules[]` (fetch depuis
 * /api/me/modules) avec fallback au legacy `navItem.roles` si modules[]
 * est encore vide (pendant le chargement initial).
 */
function isViewAllowed(item: NavItem, user: User | null, modules: string[]): boolean {
  if (!user) return false;
  if (modules.length === 0) {
    return item.roles.includes(user.role);
  }
  return item.moduleKeys.some((k) => modules.includes(k));
}

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
  const modules = useAuthStore((s) => s.modules);
  const hydrated = useAuthStore((s) => s.hydrated);
  const setHydrated = useAuthStore((s) => s.setHydrated);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
  const clearMustChangePassword = useAuthStore((s) => s.clearMustChangePassword);
  // Active view persistée dans l'URL hash (#students, #sessions, etc.) pour
  // survivre au refresh + intégrer le bouton back/forward du navigateur.
  // Lazy init : lit le hash au premier render (survit au refresh).
  // Architecture D-Phase4 : on resolve « baremes » / « permissions » /
  // « reset-requests » → « settings » (devenus des sous-onglets de la page
  // Paramètres).
  const [activeView, setActiveView] = useState(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.slice(1); // enlève le '#'
      const resolved = resolveView(hash);
      const navItem = NAV_ITEMS.find((n) => n.id === resolved);
      if (navItem) return resolved;
    }
    return "dashboard";
  });

  // Ref pour skip le 1er mount (le hash est déjà dans l'URL — pas de pushState).
  const skipPush = useRef(true);

  // Marque le store comme hydraté après le premier render client.
  useEffect(() => {
    setHydrated(true);
  }, [setHydrated]);

  // Met à jour l'URL hash quand la vue change (pushState = ajoute une entrée
  // d'historique → le navigateur peut y revenir avec back/forward).
  // Skip au 1er mount (le hash vient de la lazy init — déjà dans l'URL).
  useEffect(() => {
    if (skipPush.current) {
      skipPush.current = false;
      return;
    }
    if (activeView !== "dashboard") {
      window.history.pushState(null, "", `#${activeView}`);
    } else if (window.location.hash) {
      // Dashboard = URL propre (sans hash). pushState pour que back y revienne.
      window.history.pushState(null, "", window.location.pathname);
    }
  }, [activeView]);

  // Écoute back/forward du navigateur (popstate + hashchange) → met à jour
  // activeView pour suivre la navigation du navigateur.
  // Architecture D-Phase4 : on resolve les alias « baremes », « permissions »
  // et « reset-requests » vers « settings » (page.tsx ne gère plus que les
  // vues top-level ; le sous-onglet est géré par SettingsView elle-même).
  useEffect(() => {
    const onNav = () => {
      const hash = window.location.hash.slice(1);
      const resolved = resolveView(hash);
      const navItem = NAV_ITEMS.find((n) => n.id === resolved);
      setActiveView(navItem ? resolved : "dashboard");
    };
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("hashchange", onNav);
    };
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

  // Mot de passe temporaire → forcer le changement
  if (mustChangePassword) {
    return <ForceChangePassword onDone={clearMustChangePassword} />;
  }

  // Connecté → tableau de bord
  const navItem = NAV_ITEMS.find((n) => n.id === activeView);
  const allowed = navItem ? isViewAllowed(navItem, user, modules) : false;

  // Vue par défaut si la vue active n'est pas autorisée pour ce rôle
  const view = allowed ? activeView : "dashboard";

  // Architecture D-Phase4 : si on est sur la vue « settings », détermine
  // quel sous-onglet ouvrir initialement à partir du hash URL originel
  // (signet #baremes / #permissions / #reset-requests → ouvre directement
  // l'onglet). Le hash est lu côté client uniquement ; SettingsView gère
  // ensuite son propre état d'onglet (et son propre sync hash URL).
  const settingsTab: SettingsTab = (() => {
    if (typeof window === "undefined") return "general";
    const hash = window.location.hash.slice(1);
    if (hash === "baremes") return "baremes";
    if (hash === "permissions") return "permissions";
    if (hash === "reset-requests") return "reset-requests";
    return "general";
  })();

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
      {/* Architecture D-Phase4 — Refonte Settings : les anciennes vues
          « baremes », « permissions » et « reset-requests » deviennent des
          sous-onglets de la page Paramètres (routing top-level résolu via
          resolveView). */}
      {view === "settings" && <SettingsView initialTab={settingsTab} />}
      {view === "audit" && <AuditView />}
    </DashboardShell>
  );
}

/** Force le changement de mot de passe (première connexion avec mdp temporaire). */
function ForceChangePassword({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!current || !next || next !== confirm) {
      toast.error("Erreur", { description: "Le nouveau mot de passe et la confirmation doivent être identiques." });
      return;
    }
    if (next.length < 6) {
      toast.error("Mot de passe trop court", { description: "6 caractères minimum." });
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword({ current_password: current, new_password: next });
      toast.success("Mot de passe changé", { description: "Vous pouvez maintenant utiliser l'application." });
      onDone();
    } catch (e) {
      toast.error("Erreur", { description: e instanceof Error ? e.message : "Erreur inconnue" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute inset-x-0 top-0 h-1.5 ci-flag-stripe" />
      <div className="w-full max-w-md">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 mx-auto mb-4">
          <Lock className="w-7 h-7" />
        </div>
        <h1 className="text-xl font-bold text-center mb-1">Changez votre mot de passe</h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          Vous êtes connecté avec un mot de passe temporaire. Pour des raisons de sécurité,
          vous devez définir un nouveau mot de passe.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium mb-1 block">Mot de passe actuel (temporaire)</label>
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" disabled={loading} />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Nouveau mot de passe (6 caractères min.)</label>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="••••••••" disabled={loading} />
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Confirmer le nouveau mot de passe</label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" disabled={loading} />
          </div>
          <Button onClick={submit} disabled={loading || !current || !next || !confirm} className="w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Lock className="w-4 h-4 mr-1.5" />}
            Changer le mot de passe
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <Providers>
      <AppContent />
    </Providers>
  );
}
