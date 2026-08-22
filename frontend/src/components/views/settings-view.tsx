"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings as SettingsIcon,
  Loader2,
  Save,
  RotateCcw,
  Award,
  Sliders,
  Database,
  Info,
  Check,
  AlertCircle,
  ShieldCheck,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";

import { settingsApi, healthApi } from "@/lib/api";
import type { Setting } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GradeScalesPanel } from "./grade-scales-view";
import { PermissionsView } from "./permissions-view";
import { ResetRequestsView } from "./reset-requests-view";

// Labels lisibles pour les catégories
const CATEGORY_LABELS: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  mention: {
    label: "Seuils de mentions",
    icon: <Award className="w-4 h-4" />,
    description: "Définit les seuils (≥) pour chaque niveau de mention. Utilisés dans le calcul des moyennes et classements.",
  },
  system: {
    label: "Configuration système",
    icon: <Sliders className="w-4 h-4" />,
    description: "Paramètres globaux du système (année scolaire, seuils de réussite/distinction).",
  },
  coefficient: {
    label: "Coefficients",
    icon: <Database className="w-4 h-4" />,
    description: "Coefficient par défaut appliqué aux nouvelles matières (modifiable individuellement par matière).",
  },
};

// Valeurs par défaut (pour réinitialisation)
const DEFAULT_VALUES: Record<string, string> = {
  "mention.threshold.tres_bien": "16",
  "mention.threshold.bien": "14",
  "mention.threshold.assez_bien": "12",
  "mention.threshold.passable": "10",
  "mention.threshold.faible": "8",
  "mention.threshold.insuffisant": "5",
  "system.school_year": "2026",
  "system.pass_rate_threshold": "10",
  "system.distinction_threshold": "14",
  "coefficient.default": "1",
};

export type SettingsTab = "general" | "permissions" | "reset-requests";

/**
 * Mappe l'onglet actif vers le hash URL (pour bookmarks + back/forward).
 * - "general"        → "#settings"
 * - "permissions"    → "#permissions"
 * - "reset-requests" → "#reset-requests"
 */
function tabToHash(tab: SettingsTab): string {
  if (tab === "permissions" || tab === "reset-requests") return `#${tab}`;
  return "#settings";
}

/**
 * Lit le hash URL courant et renvoie l'onglet Settings correspondant.
 * Retourne null si le hash ne correspond à aucun sous-onglet (page.tsx
 * garde la mainmise sur le routing top-level).
 */
function hashToTab(hash: string): SettingsTab | null {
  if (hash === "permissions") return "permissions";
  if (hash === "reset-requests") return "reset-requests";
  if (hash === "settings" || hash === "") return "general";
  return null;
}

export function SettingsView({ initialTab = "general" }: { initialTab?: SettingsTab }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  // Skip-first-mount : ne pas écraser le hash au tout premier render
  // (il vient d'être défini par page.tsx ou par l'URL entrante).
  const skipHashSync = useRef(true);

  // Synchronise l'URL hash quand l'onglet actif change (replaceState pour
  // ne pas polluer l'historique back — l'utilisateur reste libre de
  // utiliser le bouton precedent du navigateur via popstate ci-dessous).
  useEffect(() => {
    if (skipHashSync.current) {
      skipHashSync.current = false;
      return;
    }
    const target = tabToHash(tab);
    if (`#${window.location.hash.slice(1)}` !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [tab]);

  // Écoute back/forward du navigateur : met à jour l'onglet actif si le
  // hash correspond à un sous-onglet Settings.
  useEffect(() => {
    const onNav = () => {
      const hash = window.location.hash.slice(1);
      const newTab = hashToTab(hash);
      if (newTab && newTab !== tab) {
        // On met à jour l'état interne — pas de replaceState (sinon boucle).
        setTab(newTab);
      }
    };
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("hashchange", onNav);
    };
  }, [tab]);

  return (
    <div className="space-y-6">
      {/* En-tête de page */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-primary" />
          Paramètres
        </h1>
        <p className="text-sm text-muted-foreground">
          Configuration globale de SYGREN — système, permissions et réinitialisations
          de mot de passe.
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as SettingsTab)}
        className="space-y-4"
      >
        <TabsList
          aria-label="Sections des paramètres"
          className="flex h-auto flex-wrap w-full sm:w-fit"
        >
          <TabsTrigger value="general" aria-label="Paramètres généraux (système, mentions, coefficients)">
            <SettingsIcon className="w-4 h-4" />
            Général
          </TabsTrigger>
          <TabsTrigger value="permissions" aria-label="Matrice de permissions RBAC (rôles × modules)">
            <ShieldCheck className="w-4 h-4" />
            Permissions
          </TabsTrigger>
          <TabsTrigger value="reset-requests" aria-label="Demandes de réinitialisation de mot de passe">
            <KeyRound className="w-4 h-4" />
            Réinitialisations
          </TabsTrigger>
        </TabsList>

        {/* Onglet Général : la liste des settings groupés par catégorie +
            le badge de santé du backend (statut système + warning impact). */}
        <TabsContent value="general">
          <GeneralSettingsTab />
        </TabsContent>

        {/* Onglet Permissions : embarque PermissionsView en mode embedded
            (le H1 + intro sont masqués — l'onglet fournit déjà ce contexte). */}
        <TabsContent value="permissions">
          <PermissionsView embedded />
        </TabsContent>

        {/* Onglet Réinitialisations : embarque ResetRequestsView en mode embedded. */}
        <TabsContent value="reset-requests">
          <ResetRequestsView embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Onglet "Général" — contenu de l'ancienne SettingsView (statut système,
 * avertissement impact calculs, paramètres par catégorie, barèmes).
 */
function GeneralSettingsTab() {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.list,
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: healthApi.check,
    refetchInterval: 30000,
  });

  const updateMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      settingsApi.update(key, value),
    onSuccess: async (_, vars) => {
      toast.success("Paramètre mis à jour", {
        description: `${vars.key} = ${vars.value}`,
      });
      setEditingKey(null);
      // Invalider settings + computation (les seuils impactent les calculs)
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["computation"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => {
      toast.error("Échec de la mise à jour", {
        description: e instanceof Error ? e.message : "Erreur inconnue",
      });
    },
  });

  const handleEdit = (s: Setting) => {
    setEditingKey(s.key);
    setEditValue(s.value);
  };

  const handleSave = async (key: string) => {
    if (!editValue) return;
    await updateMut.mutateAsync({ key, value: editValue });
  };

  const handleReset = async (key: string) => {
    const defaultValue = DEFAULT_VALUES[key];
    if (!defaultValue) return;
    setEditValue(defaultValue);
    await updateMut.mutateAsync({ key, value: defaultValue });
  };

  if (isLoading) return <LoadingState />;

  if (error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-10 text-center">
          <p className="text-sm text-destructive font-medium">
            Impossible de charger les paramètres
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {(error as Error).message}
          </p>
        </CardContent>
      </Card>
    );

  const settings = data?.settings ?? {};
  const categories = Object.keys(settings).sort();

  return (
    <div className="space-y-4">
      {/* Statut système (badge de santé du backend) */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="w-4 h-4 text-primary" />
            Statut du système
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center gap-2.5 rounded-lg border p-3">
              <Check className="w-4 h-4 text-emerald-600" />
              <div>
                <p className="text-xs text-muted-foreground">Backend Go</p>
                <p className="font-medium text-sm">
                  {health ? `${health.service} v${health.version}` : "Vérification…"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border p-3">
              <Database className="w-4 h-4 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Statut API</p>
                <p className="font-medium text-sm capitalize">
                  {health?.status ?? "—"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border p-3">
              <Sliders className="w-4 h-4 text-amber-600" />
              <div>
                <p className="text-xs text-muted-foreground">Paramètres actifs</p>
                <p className="font-medium text-sm">{data?.count ?? 0} configurés</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Avertissement */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="py-3 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium">Impact sur les calculs</p>
            <p className="text-xs mt-0.5">
              La modification des seuils de mentions affecte immédiatement les
              résultats de classement, les bulletins PDF et les statistiques du
              tableau de bord. Les changements sont rétroactifs.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Paramètres par catégorie */}
      {categories.map((cat) => {
        const catConfig = CATEGORY_LABELS[cat] ?? {
          label: cat,
          icon: <SettingsIcon className="w-4 h-4" />,
          description: "",
        };
        const items = settings[cat] ?? [];
        return (
          <Card key={cat} className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-primary">{catConfig.icon}</span>
                {catConfig.label}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{catConfig.description}</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.map((s) => (
                <div
                  key={s.key}
                  className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.label}</p>
                    <p className="text-[11px] text-muted-foreground font-mono truncate">
                      {s.key}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {editingKey === s.key ? (
                      <>
                        <Input
                          type="number"
                          step="0.5"
                          min="0"
                          max="20"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-24 h-9 text-center font-mono"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSave(s.key);
                            if (e.key === "Escape") setEditingKey(null);
                          }}
                        />
                        <Button
                          size="sm"
                          onClick={() => handleSave(s.key)}
                          disabled={updateMut.isPending}
                          className="h-9"
                        >
                          {updateMut.isPending ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Save className="w-3.5 h-3.5" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingKey(null)}
                          className="h-9"
                        >
                          Annuler
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="font-mono font-bold text-base text-primary min-w-[3rem] text-right">
                          {s.value}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(s)}
                          className="h-9"
                        >
                          <SettingsIcon className="w-3.5 h-3.5 mr-1" />
                          Modifier
                        </Button>
                        {DEFAULT_VALUES[s.key] && s.value !== DEFAULT_VALUES[s.key] && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleReset(s.key)}
                            disabled={updateMut.isPending}
                            className="h-9"
                            title="Réinitialiser à la valeur par défaut"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      {/* Section Barèmes de notation (admin uniquement, cahier des charges §3 Module 2) */}
      <GradeScalesPanel />
    </div>
  );
}

function LoadingState() {
  return (
    <Card>
      <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm">Chargement des paramètres…</p>
      </CardContent>
    </Card>
  );
}
