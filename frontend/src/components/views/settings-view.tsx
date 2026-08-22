"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings as SettingsIcon,
  Loader2,
  Save,
  RotateCcw,
  RefreshCw,
  Award,
  Sliders,
  Database,
  Info,
  AlertCircle,
  ShieldCheck,
  KeyRound,
  Ruler,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { settingsApi, healthApi, authApi } from "@/lib/api";
import type { Setting } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { GradeScalesPanel } from "./grade-scales-view";
import { PermissionsView } from "./permissions-view";
import { ResetRequestsView } from "./reset-requests-view";

// Labels lisibles pour les catégories
const CATEGORY_LABELS: Record<
  string,
  { label: string; icon: React.ReactNode; description: string }
> = {
  mention: {
    label: "Mentions & seuils",
    icon: <Award className="w-4 h-4" />,
    description:
      "Définit les seuils (≥) pour chaque niveau de mention. Utilisés dans le calcul des moyennes et classements.",
  },
  system: {
    label: "Système",
    icon: <Sliders className="w-4 h-4" />,
    description:
      "Année scolaire, seuil de réussite et seuil de distinction.",
  },
  coefficient: {
    label: "Coefficients",
    icon: <Database className="w-4 h-4" />,
    description:
      "Coefficient par défaut appliqué aux nouvelles matières (modifiable individuellement par matière).",
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

export type SettingsTab =
  | "general"
  | "baremes"
  | "permissions"
  | "reset-requests";

/**
 * Mappe l'onglet actif vers le hash URL (pour bookmarks + back/forward).
 * - "general"        → "#settings"
 * - "baremes"        → "#baremes"
 * - "permissions"    → "#permissions"
 * - "reset-requests" → "#reset-requests"
 */
function tabToHash(tab: SettingsTab): string {
  if (
    tab === "baremes" ||
    tab === "permissions" ||
    tab === "reset-requests"
  ) {
    return `#${tab}`;
  }
  return "#settings";
}

/**
 * Lit le hash URL courant et renvoie l'onglet Settings correspondant.
 * Retourne null si le hash ne correspond à aucun sous-onglet (page.tsx
 * garde la mainmise sur le routing top-level).
 */
function hashToTab(hash: string): SettingsTab | null {
  if (hash === "baremes") return "baremes";
  if (hash === "permissions") return "permissions";
  if (hash === "reset-requests") return "reset-requests";
  if (hash === "settings" || hash === "") return "general";
  return null;
}

/**
 * Formatage du timestamp de dernière vérification en texte relatif :
 * 0-2s      → "à l'instant"
 * 2-60s     → "il y a Xs"
 * 1-60min   → "il y a Xmin"
 * >1h       → "il y a Xh"
 *
 * Utilisé par la Card "Statut du système" pour montrer quand le backend
 * a été vérifié pour la dernière fois (sans polluer l'UI avec une heure
 * absolue peu lisible).
 */
function formatLastCheck(timestampMs: number): string {
  if (!timestampMs) return "à l'instant";
  const diffSec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  if (diffSec < 2) return "à l'instant";
  if (diffSec < 60) return `il y a ${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `il y a ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  return `il y a ${diffH}h`;
}

export function SettingsView({
  initialTab = "general",
}: {
  initialTab?: SettingsTab;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  // Query dédiée : compte des demandes de réinitialisation en attente.
  // Utilisée pour afficher un badge count sur l'onglet "Réinitialisations".
  // TanStack déduplique cette query avec celle embarquée par ResetRequestsView
  // quand l'onglet est actif (même queryKey ["reset-requests", "pending"]).
  const { data: pendingData } = useQuery({
    queryKey: ["reset-requests", "pending"],
    queryFn: () => authApi.listResetRequests("pending"),
    refetchInterval: 30000,
  });
  const pendingCount = pendingData?.count ?? 0;

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
      {/* En-tête de page — icône shadowée + titre + description.
          Reprend le pattern de login-view.tsx / FullScreenLoader :
          inline-flex rounded-2xl bg-primary + shadow-lg shadow-primary/30. */}
      <div className="flex items-start gap-3.5">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 shrink-0">
          <SettingsIcon className="w-6 h-6" />
        </div>
        <div className="space-y-1 pt-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Paramètres</h1>
          <p className="text-sm text-muted-foreground">
            Configuration globale de SYGREN — système, barèmes, permissions et
            réinitialisations.
          </p>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as SettingsTab)}
        className="space-y-4"
      >
        {/* TabsList responsive : flex-wrap pour passer à la ligne sur petits
            écrans (4 onglets + icônes = ~520px en mode texte). */}
        <TabsList
          aria-label="Sections des paramètres"
          className="flex h-auto flex-wrap w-full sm:w-fit"
        >
          <TabsTrigger
            value="general"
            aria-label="Paramètres généraux (système, mentions, coefficients)"
          >
            <SettingsIcon className="w-4 h-4" />
            Général
          </TabsTrigger>
          <TabsTrigger
            value="baremes"
            aria-label="Barèmes de notation par niveau (CP, CE, CM, exception Dictée)"
          >
            <Ruler className="w-4 h-4" />
            Barèmes
          </TabsTrigger>
          <TabsTrigger
            value="permissions"
            aria-label="Matrice de permissions RBAC (rôles × modules)"
          >
            <ShieldCheck className="w-4 h-4" />
            Permissions
          </TabsTrigger>
          <TabsTrigger
            value="reset-requests"
            aria-label="Demandes de réinitialisation de mot de passe"
          >
            <KeyRound className="w-4 h-4" />
            Réinitialisations
            {pendingCount > 0 && (
              <Badge
                variant="secondary"
                className="ml-1 h-5 px-1.5 text-[10px] tabular-nums font-semibold"
              >
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Onglet Général : Statut système + Cards par catégorie
            (Mentions & seuils / Système / Coefficients). */}
        <TabsContent
          value="general"
          className="animate-in fade-in-50 duration-150"
        >
          <GeneralSettingsTab />
        </TabsContent>

        {/* Onglet Barèmes : GradeScalesPanel (CRUD barèmes CP/CE/CM +
            exception Dictée /20). Panneau déjà autonome (loading + erreur
            + header inline). */}
        <TabsContent
          value="baremes"
          className="animate-in fade-in-50 duration-150"
        >
          <GradeScalesPanel />
        </TabsContent>

        {/* Onglet Permissions : embarque PermissionsView en mode embedded
            (le H1 + intro sont masqués — l'onglet fournit déjà ce contexte). */}
        <TabsContent
          value="permissions"
          className="animate-in fade-in-50 duration-150"
        >
          <PermissionsView embedded />
        </TabsContent>

        {/* Onglet Réinitialisations : embarque ResetRequestsView en mode
            embedded. */}
        <TabsContent
          value="reset-requests"
          className="animate-in fade-in-50 duration-150"
        >
          <ResetRequestsView embedded />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Onglet "Général" — Statut système (toujours rendu, indépendant du
 * chargement des settings) + Cards par catégorie avec header (icône +
 * titre + description + badge count) + skeleton pendant le chargement.
 *
 * Avertissement "Impact sur les calculs" : affiché en bas de la Card
 * "Mentions & seuils" seulement (contextuel — spécifique aux seuils).
 */
function GeneralSettingsTab() {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.list,
  });

  const {
    data: health,
    refetch: refetchHealth,
    isFetching: isHealthFetching,
    isError: isHealthError,
    error: healthError,
    dataUpdatedAt: healthUpdatedAt,
  } = useQuery({
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

  const settings = data?.settings ?? {};
  const categories = Object.keys(settings).sort();

  return (
    <div className="space-y-4">
      {/* === Card 1 : Statut du système ===
          Affiche l'état du backend SYGREN (en ligne / hors ligne / vérification).
          Une seule ligne riche : statut + service + version + dernière vérif.
          Bouton "Vérifier" pour re-check manuel.
          Pas de compteur de paramètres (redondant avec les Cards ci-dessous). */}
      <Card
        role="region"
        aria-label="Statut du système"
        className={cn(
          "border-border/60 transition-colors",
          isHealthError
            ? "border-destructive/40 bg-destructive/5"
            : "hover:border-emerald-200",
        )}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Info className="w-4 h-4" />
            </span>
            Statut du système
          </CardTitle>
          <CardDescription className="text-xs">
            Santé du backend SYGREN — vérification automatique toutes les 30s.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {/* Indicateur d'état (pastille colorée) */}
              {isHealthError ? (
                <span className="flex h-3 w-3 rounded-full bg-destructive ring-2 ring-destructive/20 shrink-0" />
              ) : !health ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
              ) : (
                <span className="flex h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20 shrink-0 animate-pulse" />
              )}
              <div className="min-w-0 flex-1">
                {isHealthError ? (
                  <>
                    <p className="font-medium text-sm text-destructive">
                      Backend hors ligne
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {healthError instanceof Error
                        ? healthError.message
                        : "Connexion impossible — vérifiez le réseau ou le backend Render"}
                    </p>
                  </>
                ) : !health ? (
                  <p className="font-medium text-sm text-muted-foreground">
                    Vérification en cours…
                  </p>
                ) : (
                  <>
                    <p className="font-medium text-sm">
                      Backend en ligne{" "}
                      <span className="text-muted-foreground font-normal">
                        · {health.service} v{health.version}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Vérifié {formatLastCheck(healthUpdatedAt)}
                    </p>
                  </>
                )}
              </div>
            </div>
            {/* Bouton Refresh — re-check manuel */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchHealth()}
              disabled={isHealthFetching}
              className="shrink-0 h-8"
              aria-label="Revérifier la santé du backend"
            >
              <RefreshCw
                className={cn("w-3.5 h-3.5", isHealthFetching && "animate-spin")}
              />
              <span className="hidden sm:inline ml-1.5">Vérifier</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* === Cards 2-4 : Paramètres par catégorie === */}
      {isLoading ? (
        <SettingsSkeleton />
      ) : error ? (
        <Card className="border-destructive/40">
          <CardContent className="py-10 text-center flex flex-col items-center gap-2">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-sm text-destructive font-medium">
              Impossible de charger les paramètres
            </p>
            <p className="text-xs text-muted-foreground">
              {(error as Error).message}
            </p>
          </CardContent>
        </Card>
      ) : categories.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Search className="w-6 h-6 opacity-50" />
            <p className="text-sm font-medium">Aucun paramètre configuré</p>
            <p className="text-xs text-center max-w-sm">
              Les paramètres par défaut seront créés automatiquement à la
              première utilisation du système.
            </p>
          </CardContent>
        </Card>
      ) : (
        categories.map((cat, idx) => {
          const catConfig = CATEGORY_LABELS[cat] ?? {
            label: cat,
            icon: <SettingsIcon className="w-4 h-4" />,
            description: "",
          };
          const items = settings[cat] ?? [];
          return (
            <Card
              key={cat}
              role="region"
              aria-label={`Catégorie ${catConfig.label}`}
              className="border-border/60 transition-colors hover:border-emerald-200 animate-in fade-in-50 duration-150"
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                      {catConfig.icon}
                    </span>
                    {catConfig.label}
                  </CardTitle>
                  <Badge
                    variant="secondary"
                    className="text-[10px] tabular-nums font-medium"
                  >
                    {items.length} paramètre{items.length > 1 ? "s" : ""}
                  </Badge>
                </div>
                {catConfig.description && (
                  <p className="text-xs text-muted-foreground">
                    {catConfig.description}
                  </p>
                )}
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
                          {DEFAULT_VALUES[s.key] &&
                            s.value !== DEFAULT_VALUES[s.key] && (
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

                {/* Alerte impact calculs — affichée uniquement pour la
                    catégorie "mention" (contextuel : les seuils impactent
                    rétroactivement les calculs). */}
                {cat === "mention" && (
                  <div className="mt-2 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800">
                      <p className="font-medium">Impact sur les calculs</p>
                      <p className="mt-0.5">
                        La modification des seuils de mentions affecte
                        immédiatement les résultats de classement, les bulletins
                        PDF et les statistiques du tableau de bord. Les
                        changements sont rétroactifs.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

/**
 * Skeleton : structure attendue pendant le chargement initial des
 * paramètres. On imite la forme d'une Card de catégorie (header + 2 rows)
 * pour minimiser la dissonance visuelle au moment du mount.
 */
function SettingsSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="border-border/60" aria-hidden="true">
          <CardHeader className="pb-3 space-y-2">
            <div className="flex items-center justify-between">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-5 w-20" />
            </div>
            <Skeleton className="h-3 w-72" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
