"use client";

import { useState, type ReactNode } from "react";
import { Users, Building2, ShieldCheck, UserCog, UserRound, UsersRound, Pause, Play, Loader2, Navigation, Lock, Copy, Download, KeyRound } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useAuthStore } from "@/lib/auth-store";
import { usersAdminApi } from "@/lib/api";
import { ROLE_LABELS, type Role, type UserAdminRow, type UserPasswordRow } from "@/lib/types";
import { ChangePasswordButton } from "@/components/change-password-dialog";
import { SchoolIdentityBanner } from "@/components/school-identity-banner";
import { MyProfileCard } from "@/components/my-profile-card";
import { TeachersView } from "./teachers-view";
import { DirectorsView } from "./directors-view";
import { InspectorsView } from "./inspectors-view";
import { ParentsView } from "./parents-view";
import { ConseillersView } from "./conseillers-view";

interface UsersViewProps {
  /** Task 23 + 24 — bande déroulante « Accès direct à vos modules »
   *  (rôles Directeur et Enseignant) : navigue vers la vue cible (et vers
   *  l'onglet du module Résultats le cas échéant). Absent pour les autres
   *  rôles (bande déroulante masquée). */
  onNavigate?: (view: string, resultsTab?: "classement" | "pda") => void;
}

/**
 * Vue unifiée "Utilisateurs" — fusionne Enseignants + Directeurs + Admins IEP
 * + (admin seulement) Tous les comptes avec boutons Suspendre/Réactiver.
 *
 * RBAC (Architecture D — dynamique via `modules[]`) :
 *   - "users.teachers"    → onglet Enseignants
 *   - "users.directors"   → onglet Directeurs
 *   - "users.inspectors"  → onglet Admin IEP
 *   - "users.parents"     → onglet Parents (v2 — Portail Parent)
 *   - "users.conseillers" → onglet Conseillers (v5 — secteurs d'écoles)
 *   - "users-admin"        → onglet "Tous les comptes" (super admin seul)
 *                            + onglet "Mots de passe" (contrôle admin —
 *                            super admin seul : mots de passe EN CLAIR du
 *                            personnel, demande utilisateur « faire
 *                            apparaître les mots de passe changés par les
 *                            directeurs et des adjoints aux directeurs »).
 *
 * Task 23 + 24 — le DIRECTEUR et l'ENSEIGNANT atterrissent directement sur
 * ce module : une bande déroulante y liste LEURS modules (demande
 * utilisateur, dans cet ordre) et y navigue en un clic :
 *   1. Résultats — Plan IEPP (centres) & document officiel (onglet « pda »)
 *   2. Élèves
 *   3. Évaluations — Saisie des notes
 *   4. Résultats — Synthèses PDF & Relevés PDF (onglet « classement »)
 *   5. Bulletins — Imprimer les bulletins
 * (Les documents s'ouvrent en consultation ; l'impression reste verrouillée.)
 * L'enseignant ne disposant d'aucun module users.* (les onglets de gestion
 * des comptes restent réservés), une carte d'accueil l'accompagne sous la
 * bande déroulante.
 */
export function UsersView({ onNavigate }: UsersViewProps) {
  const user = useAuthStore((s) => s.user);
  const modules = useAuthStore((s) => s.modules);
  const [tab, setTab] = useState("teachers");

  // Architecture D — visibility based on modules[] (with legacy fallback)
  const hasModule = (key: string) =>
    modules.length === 0 ? false : modules.includes(key);
  const hasLegacyRole = (roles: Role[]) =>
    modules.length === 0 && user ? roles.includes(user.role) : false;

  const canSeeTeachers =
    hasModule("users.teachers") || hasLegacyRole(["admin", "director", "inspector"]);
  const canSeeDirectors =
    hasModule("users.directors") || hasLegacyRole(["admin", "inspector"]);
  const canSeeInspectors = hasModule("users.inspectors") || hasLegacyRole(["admin"]);
  // v2 — Onglet Parents (Portail Parent) : admin + inspector
  const canSeeParents = hasModule("users.parents") || hasLegacyRole(["admin", "inspector"]);
  // v5 (session 26) — Onglet Conseillers : admin + inspector. Le conseiller
  // lui-même n'a PAS ce module (isolation : il ne voit que « Mon Secteur »).
  const canSeeConseillers =
    hasModule("users.conseillers") || hasLegacyRole(["admin", "inspector"]);
  const canSeeAllAccounts = hasModule("users-admin") || hasLegacyRole(["admin"]);
  // CONTRÔLE ADMIN DES MOTS DE PASSE — même périmètre que "Tous les
  // comptes" (module users-admin = super admin seul).
  const canSeePasswords = canSeeAllAccounts;

  const visibleTabs = [
    canSeeTeachers && "teachers",
    canSeeDirectors && "directors",
    canSeeInspectors && "inspectors",
    canSeeParents && "parents",
    canSeeConseillers && "conseillers",
    canSeePasswords && "passwords",
    canSeeAllAccounts && "all-accounts",
  ].filter(Boolean) as string[];

  // Si l'onglet courant n'est plus accessible, utiliser le 1er disponible
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0] ?? "teachers";

  // === Task 23 + 24 — bande déroulante « Accès direct à vos modules » ===
  // Le directeur et l'enseignant atterrissent sur Utilisateurs ; cette bande
  // déroulante liste LEURS modules (demande utilisateur, dans cet ordre) et
  // y navigue en un clic :
  //   1. Résultats — Plan IEPP (centres) & document officiel (onglet « pda »)
  //   2. Élèves
  //   3. Évaluations — Saisie des notes
  //   4. Résultats — Synthèses PDF & Relevés PDF (onglet « classement »)
  //   5. Bulletins — Imprimer les bulletins
  // (Les documents s'ouvrent en consultation ; l'impression reste verrouillée.)
  const isWorkspaceUser =
    user?.role === "director" || user?.role === "teacher";
  const [goTo, setGoTo] = useState("");
  const workspaceShortcuts: Array<{
    value: string;
    label: string;
    view: string;
    resultsTab?: "classement" | "pda";
  }> = [
    {
      value: "results-pda",
      label: "Résultats — Plan IEPP (centres) & document officiel",
      view: "results",
      resultsTab: "pda",
    },
    { value: "students", label: "Élèves", view: "students" },
    {
      value: "evaluations",
      label: "Évaluations — Saisie des notes",
      view: "evaluations",
    },
    {
      value: "results-classement",
      label: "Résultats — Synthèses PDF & Relevés PDF",
      view: "results",
      resultsTab: "classement",
    },
    {
      value: "bulletins",
      label: "Bulletins — Imprimer les bulletins",
      view: "bulletins",
    },
  ];

  const workspaceGo = isWorkspaceUser ? (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-center gap-2 shrink-0">
          <Navigation className="w-4 h-4 text-primary" aria-hidden />
          <span className="text-sm font-medium">
            Accès direct à vos modules :
          </span>
        </div>
        <Select
          value={goTo}
          onValueChange={(v) => {
            setGoTo("");
            const target = workspaceShortcuts.find((s) => s.value === v);
            if (target) onNavigate?.(target.view, target.resultsTab);
          }}
        >
          <SelectTrigger
            className="w-full sm:max-w-md"
            aria-label="Aller à un module"
          >
            <SelectValue placeholder="Aller au module…" />
          </SelectTrigger>
          <SelectContent>
            {workspaceShortcuts.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Task 25 — action « Modifier votre mot de passe » directement dans
            le module d'atterrissage (mot de passe standard = téléphone). */}
        <ChangePasswordButton
          variant="outline"
          className="sm:ml-auto shrink-0"
        />
      </CardContent>
    </Card>
  ) : null;

  // Task 24 — Aucun onglet de gestion des comptes accessible (cas de
  // l'ENSEIGNANT : il ne dispose d'aucun module users.*) → on affiche la
  // bande déroulante + une carte d'accueil, JAMAIS la liste des enseignants
  // (évite des appels API 403 et du contenu hors périmètre).
  if (visibleTabs.length === 0) {
    return (
      <div className="space-y-4">
        {/* Task 30 — identification à l'établissement : le code école de
            SON école est affiché en tête du module Utilisateurs. */}
        <SchoolIdentityBanner />
        {workspaceGo}
        {/* Isolation des données : l'enseignant ne voit ici QUE SES
            propres informations (aucun onglet de gestion des comptes). */}
        <MyProfileCard />
        <WorkspaceWelcomeCard roleLabel={user ? ROLE_LABELS[user.role] : ""} />
      </div>
    );
  }

  // Si un seul onglet visible → rendu direct (pas de barre d'onglets)
  if (visibleTabs.length <= 1) {
    let inner: ReactNode;
    if (visibleTabs[0] === "teachers") inner = <TeachersView />;
    else if (visibleTabs[0] === "directors") inner = <DirectorsView />;
    else if (visibleTabs[0] === "inspectors") inner = <InspectorsView />;
    else if (visibleTabs[0] === "parents") inner = <ParentsView />;
    else if (visibleTabs[0] === "conseillers") inner = <ConseillersView />;
    else if (visibleTabs[0] === "passwords") inner = <PasswordsTab />;
    else if (visibleTabs[0] === "all-accounts") inner = <AllAccountsTab />;
    else inner = <TeachersView />;
    return (
      <div className="space-y-4">
        {workspaceGo}
        {/* Isolation des données (directeur) : SES informations + les
            enseignants de SON école (onglet ci-dessous). */}
        {isWorkspaceUser && <MyProfileCard />}
        {inner}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {workspaceGo}
      {/* Isolation des données (directeur) : SES informations + les
          enseignants de SON école (onglets ci-dessous). */}
      {isWorkspaceUser && <MyProfileCard />}
      <Tabs value={activeTab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        {canSeeTeachers && (
          <TabsTrigger value="teachers">
            <Users className="w-4 h-4 mr-1.5" />
            Adjoint(e)s au directeur
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
        {canSeeParents && (
          <TabsTrigger value="parents">
            <UserRound className="w-4 h-4 mr-1.5" />
            Parents
          </TabsTrigger>
        )}
        {canSeeConseillers && (
          <TabsTrigger value="conseillers">
            <UsersRound className="w-4 h-4 mr-1.5" />
            Conseillers
          </TabsTrigger>
        )}
        {canSeePasswords && (
          <TabsTrigger value="passwords">
            <KeyRound className="w-4 h-4 mr-1.5" />
            Mots de passe
          </TabsTrigger>
        )}
        {canSeeAllAccounts && (
          <TabsTrigger value="all-accounts">
            <UserCog className="w-4 h-4 mr-1.5" />
            Tous les comptes
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
      <TabsContent value="parents">
        <ParentsView />
      </TabsContent>
      <TabsContent value="conseillers">
        <ConseillersView />
      </TabsContent>
      <TabsContent value="passwords">
        <PasswordsTab />
      </TabsContent>
      <TabsContent value="all-accounts">
        <AllAccountsTab />
      </TabsContent>
    </Tabs>
    </div>
  );
}

/**
 * CONTRÔLE ADMIN DES MOTS DE PASSE (demande utilisateur : « désormais faire
 * apparaître les mots de passe changés par les directeurs et des adjoints
 * aux directeurs pour mieux contrôler leur travail ») — onglet super admin
 * seul (module users-admin). Liste le personnel des écoles (directeurs +
 * adjoints au directeur / enseignants) avec le mot de passe EN CLAIR courant
 * (copie users.password_visible maintenue par le backend à CHAQUE définition
 * du mot de passe) et sa date de définition.
 *
 * « personnalisé — non visible » = mot de passe défini avant la
 * fonctionnalité et non conforme au standard téléphone : inconnu de
 * l'administration. Il redeviendra visible dès la prochaine définition du
 * mot de passe (changement volontaire ou réinitialisation — l'option
 * « standard téléphone » des demandes de réinitialisation le ramène au
 * standard, qui est visible).
 */
function PasswordsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["users-passwords"],
    queryFn: () => usersAdminApi.passwords(),
  });
  const [search, setSearch] = useState("");

  const users = data?.users ?? [];
  const visibleCount = users.filter((u) => u.password_visible).length;
  const customCount = users.length - visibleCount;

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      u.full_name.toLowerCase().includes(q) ||
      (u.school_name ?? "").toLowerCase().includes(q) ||
      (u.school_code ?? "").toLowerCase().includes(q) ||
      (u.phone ?? "").includes(q) ||
      (u.fonction ?? "").toLowerCase().includes(q)
    );
  });

  const copyPassword = (pwd: string) => {
    navigator.clipboard?.writeText(pwd);
    toast.success("Mot de passe copié");
  };

  const exportCsv = () => {
    const header = [
      "N°",
      "NOM ET PRENOMS",
      "FONCTION",
      "ECOLE",
      "CODE ECOLE",
      "TELEPHONE (IDENTIFIANT)",
      "MOT DE PASSE",
      "DEFINI LE",
      "STATUT",
    ];
    const lines = filtered.map((u, i) =>
      [
        String(i + 1),
        u.full_name,
        passwordFonctionLabel(u),
        u.school_name ?? "",
        u.school_code ?? "",
        u.phone ?? "",
        u.password_visible ?? "PERSONNALISE - NON VISIBLE",
        u.password_changed_at
          ? new Date(u.password_changed_at).toLocaleDateString("fr-FR")
          : "",
        u.active ? "ACTIF" : "SUSPENDU",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(";"),
    );
    const blob = new Blob(["\ufeff" + [header.join(";"), ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mots-de-passe-personnel-SYGREN.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Export CSV téléchargé", {
      description: `${filtered.length} ligne(s) exportée(s).`,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-emerald-600" />
          Mots de passe du personnel ({users.length})
        </CardTitle>
        <CardDescription>
          Contrôle des accès : DIRECTEURS et ADJOINT(E)S AU DIRECTEUR — mot de
          passe courant en clair, mis à jour automatiquement à chaque création
          (standard : le numéro de téléphone), changement volontaire
          (« Modifier votre mot de passe ») ou réinitialisation.{" "}
          <span className="font-medium text-emerald-700">
            {visibleCount} au standard / visible
          </span>{" "}
          ·{" "}
          <span className="font-medium text-amber-700">
            {customCount} personnalisé(s) non visible(s)
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Rechercher : nom, école, code école, téléphone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-sm"
          />
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="shrink-0"
          >
            <Download className="w-4 h-4 mr-1.5" /> Exporter CSV
          </Button>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded border">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-50 z-10">
                <TableRow>
                  <TableHead className="w-10">N°</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Fonction</TableHead>
                  <TableHead>École</TableHead>
                  <TableHead>Téléphone (identifiant)</TableHead>
                  <TableHead>Mot de passe</TableHead>
                  <TableHead>Défini le</TableHead>
                  <TableHead>Statut</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u, i) => (
                  <TableRow key={u.id} className={!u.active ? "bg-red-50/40" : ""}>
                    <TableCell className="text-xs text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="font-medium">{u.full_name}</TableCell>
                    <TableCell className="text-xs">
                      {passwordFonctionLabel(u)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {u.school_name ? (
                        <span>
                          {u.school_name}
                          {u.school_code && (
                            <span className="block text-muted-foreground font-mono">
                              {u.school_code}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {u.phone ?? "—"}
                    </TableCell>
                    <TableCell>
                      {u.password_visible ? (
                        <span className="flex items-center gap-1">
                          <code className="font-mono text-xs bg-slate-100 border rounded px-1.5 py-0.5">
                            {u.password_visible}
                          </code>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            aria-label="Copier le mot de passe"
                            onClick={() => copyPassword(u.password_visible!)}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          {u.must_change_password && (
                            <Badge
                              variant="outline"
                              className="ml-1 border-amber-300 text-amber-700 bg-amber-50"
                            >
                              à changer à la 1re connexion
                            </Badge>
                          )}
                        </span>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-amber-300 text-amber-700 bg-amber-50"
                          title="Mot de passe personnalisé défini avant la fonctionnalité — inconnu de l'administration. Utilisez la réinitialisation (standard téléphone) pour le ramener au standard."
                        >
                          personnalisé — non visible
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.password_changed_at
                        ? new Date(u.password_changed_at).toLocaleDateString("fr-FR")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {u.active ? (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                          Actif
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Suspendu</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center text-sm text-muted-foreground py-8"
                    >
                      Aucun compte ne correspond à la recherche.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground flex items-start gap-1.5 border-t border-border pt-3">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
          Accès réservé au Super Admin — consultation tracée dans le journal
          d&apos;audit. Un mot de passe « personnalisé — non visible » peut être
          ramené au standard (le numéro de téléphone) via le module
          Réinitialisations (option « standard téléphone »).
        </p>
      </CardContent>
    </Card>
  );
}

/** Libellé FONCTION d'une ligne du contrôle des mots de passe : dossier
 *  personnel (DIRECTEUR | ADJOINT(E)) en priorité, rôle en repli. */
function passwordFonctionLabel(u: UserPasswordRow): string {
  if (u.fonction) return u.fonction;
  return u.role === "director" ? "DIRECTEUR" : "ADJOINT(E)";
}

/**
 * Task 24 — Carte d'accueil de l'espace de travail (module Utilisateurs)
 * affichée aux rôles qui ne disposent d'aucun onglet de gestion des comptes
 * (cas de l'enseignant). Rappelle ses modules (bande déroulante ci-dessus)
 * et la politique d'impression (consultation oui, impression non).
 */
function WorkspaceWelcomeCard({ roleLabel }: { roleLabel: string }) {
  const workspaceModules = [
    "Résultats — Plan IEPP (centres) & document officiel",
    "Élèves",
    "Évaluations — Saisie des notes",
    "Résultats — Synthèses PDF & Relevés PDF",
    "Bulletins",
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="w-5 h-5 text-primary" aria-hidden />
          Bienvenue dans votre espace{roleLabel ? ` — ${roleLabel}` : ""}
        </CardTitle>
        <CardDescription>
          Ce module centralise l&apos;accès à vos outils de travail. Utilisez
          la bande déroulante ci-dessus pour rejoindre vos modules :
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5">
          {workspaceModules.map((m) => (
            <li key={m} className="flex items-center gap-2 text-sm">
              <span
                className="h-1.5 w-1.5 rounded-full bg-primary shrink-0"
                aria-hidden
              />
              {m}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground flex items-start gap-1.5 border-t border-border pt-3">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
          Vos documents s&apos;ouvrent en consultation ; la zone « Imprimer /
          PDF » reste grisée — l&apos;impression est réservée à l&apos;Admin
          IEP et au Super Admin.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Onglet "Tous les comptes" — visible par le super admin seulement.
 * Liste tous les utilisateurs avec boutons Suspendre/Réactiver.
 */
function AllAccountsTab() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [suspendTarget, setSuspendTarget] = useState<UserAdminRow | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["users-admin"],
    queryFn: () => usersAdminApi.list(),
  });

  const suspendMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      usersAdminApi.suspend(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-admin"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      toast.success("Utilisateur suspendu", {
        description: "Il sera déconnecté à sa prochaine action.",
      });
      setSuspendTarget(null);
      setSuspendReason("");
    },
    onError: (e: Error) => toast.error("Erreur", { description: e.message }),
  });

  const reactivateMut = useMutation({
    mutationFn: (id: string) => usersAdminApi.reactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-admin"] });
      queryClient.invalidateQueries({ queryKey: ["audit"] });
      toast.success("Utilisateur réactivé");
    },
    onError: (e: Error) => toast.error("Erreur", { description: e.message }),
  });

  const users = data?.users ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCog className="w-5 h-5 text-emerald-600" />
          Tous les comptes ({users.length})
        </CardTitle>
        <CardDescription>
          Suspendez ou réactivez un compte en un clic. Le compte reste en base
          (historique conservé). La suspension prend effet immédiatement.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded border">
            <Table>
              <TableHeader className="sticky top-0 bg-slate-50 z-10">
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Email / Téléphone</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} className={!u.active ? "bg-red-50/40" : ""}>
                    <TableCell className="font-medium">{u.full_name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {u.email ?? u.phone ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={roleBadgeClass(u.role)}>
                        {ROLE_LABELS[u.role as Role] ?? u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.service ?? "—"}
                    </TableCell>
                    <TableCell>
                      {u.active ? (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                          Actif
                        </Badge>
                      ) : (
                        <Badge variant="destructive" title={u.suspended_reason ?? ""}>
                          Suspendu
                          {u.suspended_at && (
                            <span className="ml-1 font-normal opacity-70">
                              {new Date(u.suspended_at).toLocaleDateString("fr-FR")}
                            </span>
                          )}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {u.id === me?.id ? (
                        <span className="text-xs text-muted-foreground italic">Vous</span>
                      ) : u.active ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSuspendTarget(u)}
                        >
                          <Pause className="w-3 h-3 mr-1" /> Suspendre
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reactivateMut.mutate(u.id)}
                          disabled={reactivateMut.isPending}
                        >
                          <Play className="w-3 h-3 mr-1" /> Réactiver
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Suspend confirmation dialog */}
      <AlertDialog
        open={!!suspendTarget}
        onOpenChange={(o) => !o && setSuspendTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Suspendre {suspendTarget?.full_name} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              L'utilisateur sera immédiatement déconnecté et ne pourra plus se
              connecter. Son compte reste en base (historique conservé). La
              réactivation est possible à tout moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="suspend-reason" className="text-sm">
              Motif (optionnel)
            </Label>
            <Textarea
              id="suspend-reason"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Ex: fin de contrat, congé disciplinaire..."
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                suspendTarget &&
                suspendMut.mutate({
                  id: suspendTarget.id,
                  reason: suspendReason || undefined,
                })
              }
              className="bg-red-600 hover:bg-red-700"
              disabled={suspendMut.isPending}
            >
              {suspendMut.isPending ? "Suspension..." : "Confirmer la suspension"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function roleBadgeClass(role: string): string {
  switch (role) {
    case "admin":
      return "border-emerald-300 text-emerald-700 bg-emerald-50";
    case "inspector":
      return "border-amber-300 text-amber-700 bg-amber-50";
    case "director":
      return "border-sky-300 text-sky-700 bg-sky-50";
    case "teacher":
      return "border-slate-300 text-slate-700 bg-slate-50";
    default:
      return "";
  }
}
