"use client";

import { useState } from "react";
import { Users, Building2, ShieldCheck } from "lucide-react";

import { useAuthStore } from "@/lib/auth-store";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeachersView } from "./teachers-view";
import { DirectorsView } from "./directors-view";
import { InspectorsView } from "./inspectors-view";

/**
 * Vue unifiée "Utilisateurs" — fusionne Enseignants + Directeurs + Inspecteurs.
 *
 * RBAC :
 *   - admin : voit les 3 onglets
 *   - director : voit uniquement l'onglet "Enseignants" (rendu direct, sans barre d'onglets)
 *
 * L'onglet par défaut est "teachers" (le plus utilisé).
 * Chaque sous-vue conserve son propre Card header + bouton de création.
 */
export function UsersView() {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState("teachers");

  const canSeeTeachers = user?.role === "admin" || user?.role === "director" || user?.role === "inspector";
  const canSeeDirectors = user?.role === "admin";
  const canSeeInspectors = user?.role === "admin";

  const visibleTabs = [
    canSeeTeachers && "teachers",
    canSeeDirectors && "directors",
    canSeeInspectors && "inspectors",
  ].filter(Boolean) as string[];

  // Si l'onglet courant n'est plus accessible, utiliser le 1er disponible
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0] ?? "teachers";

  // Si un seul onglet visible → rendu direct (pas de barre d'onglets)
  if (visibleTabs.length <= 1) {
    if (visibleTabs[0] === "teachers") return <TeachersView />;
    if (visibleTabs[0] === "directors") return <DirectorsView />;
    if (visibleTabs[0] === "inspectors") return <InspectorsView />;
    return <TeachersView />;
  }

  return (
    <Tabs value={activeTab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        {canSeeTeachers && (
          <TabsTrigger value="teachers">
            <Users className="w-4 h-4 mr-1.5" />
            Enseignants
          </TabsTrigger>
        )}
        {canSeeDirectors && (
          <TabsTrigger value="directors">
            <Building2 className="w-4 h-4 mr-1.5" />
            Directeurs
          </TabsTrigger>
        )}
        {canSeeInspectors && (
          <TabsTrigger value="inspectors">
            <ShieldCheck className="w-4 h-4 mr-1.5" />
            Admin IEP
          </TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="teachers">
        <TeachersView />
      </TabsContent>
      <TabsContent value="directors">
        <DirectorsView />
      </TabsContent>
      <TabsContent value="inspectors">
        <InspectorsView />
      </TabsContent>
    </Tabs>
  );
}
