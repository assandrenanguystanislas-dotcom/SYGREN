"use client";

import { useState } from "react";
import { Calendar, ClipboardList } from "lucide-react";

import { useAuthStore } from "@/lib/auth-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SessionsView } from "./sessions-view";
import { GradesGrid } from "./grades-view";

/**
 * Vue unifiée "Évaluations" — fusionne Sessions + Saisie des notes.
 *
 * RBAC :
 *   - admin/director : voient les 2 onglets (Sessions + Saisie)
 *   - teacher : voit les 2 onglets (Sessions + Saisie — sa tâche principale)
 *   - inspector : voit uniquement "Sessions" (rendu direct, sans barre d'onglets)
 *
 * Pour les enseignants, l'onglet par défaut est "grades" (saisie = tâche quotidienne).
 * Pour les autres rôles, l'onglet par défaut est "sessions" (vue d'ensemble).
 */
export function EvaluationsView() {
  const user = useAuthStore((s) => s.user);
  const defaultTab = user?.role === "teacher" ? "grades" : "sessions";
  const [tab, setTab] = useState(defaultTab);

  const canSeeSessions = true; // tous les rôles authentifiés
  const canSeeGrades =
    user?.role === "teacher" || user?.role === "director" || user?.role === "admin";

  const visibleTabs = [
    canSeeSessions && "sessions",
    canSeeGrades && "grades",
  ].filter(Boolean) as string[];

  // Si l'onglet courant n'est plus accessible, utiliser le 1er disponible
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0] ?? "sessions";

  // Inspecteur → un seul onglet (Sessions) → rendu direct
  if (visibleTabs.length <= 1) {
    if (visibleTabs[0] === "sessions") return <SessionsView />;
    if (visibleTabs[0] === "grades") return <GradesGrid />;
    return <SessionsView />;
  }

  return (
    <Tabs value={activeTab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="sessions">
          <Calendar className="w-4 h-4 mr-1.5" />
          Sessions
        </TabsTrigger>
        <TabsTrigger value="grades">
          <ClipboardList className="w-4 h-4 mr-1.5" />
          Saisie des notes
        </TabsTrigger>
      </TabsList>
      <TabsContent value="sessions">
        <SessionsView />
      </TabsContent>
      <TabsContent value="grades">
        <GradesGrid />
      </TabsContent>
    </Tabs>
  );
}
