"use client";

import { useState, useEffect, type ReactNode } from "react";
import {
  GraduationCap,
  LayoutDashboard,
  School,
  Users,
  BookOpen,
  ClipboardList,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  Trophy,
  ChevronRight,
  ChevronDown,
  UserCog,
  History,
  Lock,
  KeyRound,
  Network,
  Phone,
  Megaphone,
} from "lucide-react";

import { api } from "@/lib/api";

import { useAuthStore } from "@/lib/auth-store";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ChangePasswordButton, ChangePasswordDialog } from "@/components/change-password-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Home } from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  roles: Role[]; // fallback legacy (utilisé si modules[] est vide)
  // Architecture D — module keys (le nav item est visible si AU MOINS UN
  // de ces keys est dans l'array `modules[]` du user). Pour les items qui
  // correspondent à un seul module, c'est un seul key. Pour "users" (qui
  // regroupe teachers + directors + inspectors), c'est plusieurs.
  moduleKeys: string[];
  badge?: string;
}

// Navigation RBAC — chaque item n'est visible que pour les modules accessibles
// du user courant (Architecture D — nav dynamique).
export const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "Tableau de bord",
    icon: <LayoutDashboard className="w-4 h-4" />,
    roles: ["admin", "director", "inspector", "teacher"],
    moduleKeys: ["dashboard"],
  },
  {
    id: "iep",
    label: "Inspections (IEP)",
    icon: <BarChart3 className="w-4 h-4" />,
    roles: ["admin", "inspector"],
    moduleKeys: ["iep"],
  },
  {
    id: "schools",
    label: "Écoles",
    icon: <School className="w-4 h-4" />,
    roles: ["admin", "inspector", "director"],
    // v2 : module "schools" uniquement — l'enseignant (classes en lecture
    // seule pour le contexte de saisie) ne voit plus l'entrée Écoles.
    moduleKeys: ["schools"],
  },
  {
    id: "students",
    label: "Élèves",
    icon: <Users className="w-4 h-4" />,
    roles: ["admin", "inspector", "director", "teacher"],
    moduleKeys: ["students"],
  },
  {
    id: "users",
    label: "Utilisateurs",
    icon: <UserCog className="w-4 h-4" />,
    roles: ["admin", "inspector", "director"],
    // v5 (session 26) — "users.conseillers" : onglet Conseillers
    // (admin + inspector). Le conseiller LUI-MÊME n'a pas ce module :
    // il ne voit que sa vue « Mon Secteur » ci-dessous.
    moduleKeys: [
      "users.teachers",
      "users.directors",
      "users.inspectors",
      "users.conseillers",
      "users-admin",
    ],
  },
  // === v5 (session 26) — Vue conseiller « Mon Secteur » : périmètre
  // STRICT du conseiller pédagogique (directeurs et adjoints au
  // directeur des écoles de SON secteur). Item visible uniquement pour
  // le rôle conseiller (module "users.conseiller"). ===
  {
    id: "conseiller",
    label: "Mon Secteur",
    icon: <Network className="w-4 h-4" />,
    roles: ["conseiller"],
    moduleKeys: ["users.conseiller"],
  },
  {
    id: "subjects",
    label: "Matières",
    icon: <BookOpen className="w-4 h-4" />,
    roles: ["admin", "director", "teacher", "inspector"],
    moduleKeys: ["subjects"],
  },
  {
    id: "evaluations",
    label: "Évaluations",
    icon: <ClipboardList className="w-4 h-4" />,
    roles: ["admin", "director", "inspector", "teacher"],
    moduleKeys: ["sessions", "grades"],
  },
  {
    id: "results",
    label: "Résultats",
    icon: <Trophy className="w-4 h-4" />,
    roles: ["teacher", "director", "admin", "inspector"],
    moduleKeys: ["reports"],
  },
  {
    id: "bulletins",
    label: "Bulletins",
    icon: <FileText className="w-4 h-4" />,
    roles: ["admin", "director", "inspector"],
    moduleKeys: ["report-cards"],
  },
  // === v2 — Portail Parent (rôle parent : bulletin individuel de l'enfant) ===
  {
    id: "parent-portal",
    label: "Portail Parent",
    icon: <Home className="w-4 h-4" />,
    roles: ["parent"],
    moduleKeys: ["parent-portal"],
  },
  {
    id: "settings",
    label: "Paramètres",
    icon: <Settings className="w-4 h-4" />,
    roles: ["admin"],
    // Architecture D-Phase3 — Paramètres est désormais une page unique qui
    // regroupe 3 sous-onglets (Général, Permissions, Réinitialisations).
    // L'item est visible si l'user a accès à AU MOINS UN de ces modules.
    // En pratique les 3 sont admin-only aujourd'hui, mais c'est plus correct
    // pour l'avenir (ex: un rôle pourrait voir ResetRequests sans voir Settings).
    moduleKeys: ["settings", "permissions", "reset-requests"],
  },
  // === Architecture D — modules admin ===
  {
    id: "audit",
    label: "Journal d'audit",
    icon: <History className="w-4 h-4" />,
    roles: ["admin"],
    moduleKeys: ["audit"],
  },
];

// === Task 23 + 24 — Périmètre UI des rôles Directeur et Enseignant ===
// Le directeur (Task 23) et l'enseignant (Task 24) se connectent via leur
// interface dédiée (onglets « Directeur » / « Enseignant » de l'écran de
// connexion) et ATTERGISSENT directement sur le module Utilisateurs. Ils
// travaillent ensuite dans LEURS modules uniquement :
//   - Résultats (plan IEPP centres, document officiel, synthèses PDF,
//     relevés PDF), Élèves, Évaluations (saisie des notes), Bulletins ;
//   - ils ouvrent les documents en CONSULTATION mais l'impression reste
//     verrouillée (zone Imprimer / PDF grisée — cf. print-guard.tsx).
// Dans la navigation, TOUS les modules restent visibles : ceux hors de ce
// périmètre sont automatiquement GRISÉS (non cliquables). La matrice RBAC
// backend est inchangée (les deux rôles gardent la lecture des documents
// via les endpoints /api/reports/* et /api/pda/* — scope vérifié dans les
// handlers).
const WORKSPACE_VIEWS: ReadonlySet<string> = new Set([
  "users", // module Utilisateurs (page d'atterrissage + bande déroulante)
  "students", // module Élèves
  "evaluations", // module Évaluations (saisie des notes)
  "results", // module Résultats (plan IEPP centres, document officiel, synthèses/relevés PDF)
  "bulletins", // module Bulletins (imprimer les bulletins)
]);

/** Task 23 — périmètre UI du Directeur (atterrissage Utilisateurs). */
export const DIRECTOR_ALLOWED_VIEWS: ReadonlySet<string> = WORKSPACE_VIEWS;

/** Task 24 — périmètre UI de l'Enseignant (même espace de travail que le
 *  Directeur : atterrissage Utilisateurs, modules grisés, bande déroulante,
 *  zone Imprimer / PDF grisée). */
export const TEACHER_ALLOWED_VIEWS: ReadonlySet<string> = WORKSPACE_VIEWS;

/** Task 26 — périmètre UI du PARENT : TOUT est grisé SAUF le Portail
 *  Parent. Dans la navigation, tous les modules restent affichés (comme
 *  pour le Directeur / l'Enseignant) mais seul « Portail Parent » est
 *  cliquable — le parent atterrit directement dessus. */
export const PARENT_ALLOWED_VIEWS: ReadonlySet<string> = new Set([
  "parent-portal",
]);

/** v5 (session 26) — périmètre UI du CONSEILLER : sa vue « Mon Secteur »
 *  (demande utilisateur : « ces conseillers pourront voir seulement leurs
 *  directeurs et leurs adjoints aux directeurs »). Le conseiller atterrit
 *  directement dessus.
 *  v6 (session 34) — demande utilisateur : « les conseillers pourront voir
 *  tous les documents PDF de leurs secteurs mais ne pourront pas les
 *  imprimer car grisés » : les modules Résultats et Bulletins deviennent
 *  cliquables (CONSULTATION des documents des écoles de son secteur — le
 *  sélecteur d'écoles est borné au secteur côté serveur) ; l'impression
 *  reste verrouillée (print-guard.tsx : zone « Imprimer / PDF » grisée +
 *  blocage @media print — le rôle conseiller n'est pas autorisé). */
export const CONSEILLER_ALLOWED_VIEWS: ReadonlySet<string> = new Set([
  "conseiller",
  "results", // v6 — documents du secteur (synthèses, relevés, fin d'année, PDA)
  "bulletins", // v6 — bulletins A5 du secteur (consultation seule)
]);

/** Task 23 + 24 + 26 — périmètre UI par rôle : retourne l'ensemble des vues
 *  autorisées pour les rôles « espace restreint » (Directeur, Enseignant,
 *  Parent, Conseiller v6) ou null pour les autres rôles (admin / inspector
 *  → filtrage dynamique par modules[] inchangé, tout est actif). */
function allowedViewsForRole(role: Role): ReadonlySet<string> | null {
  if (role === "director" || role === "teacher") return WORKSPACE_VIEWS;
  if (role === "parent") return PARENT_ALLOWED_VIEWS;
  // v5 (session 26) + v6 (session 34) — le conseiller : « Mon Secteur »
  // + consultation des documents de son secteur (Résultats / Bulletins,
  // impression verrouillée)
  if (role === "conseiller") return CONSEILLER_ALLOWED_VIEWS;
  return null;
}

// === Bande « Infos SYGREN » (demandes utilisateur) ===
// Annonces par défaut affichées si le setting infos.sygren est vide ou si
// l'appel échoue (l'en-tête doit toujours montrer la bande défilante).
const DEFAULT_INFOS_TEXT =
  "Année scolaire 2026-2027 | Les Directeurs et Adjoints au Directeur s'inscrivent sur la plateforme SYGREN à partir de la création de leurs accès. Pour toutes informations complémentaires appeler le 0101263515";

/** Contenu défilant : le texte est DOUBLÉ pour une boucle sans couture —
 *  l'animation CSS translate le conteneur de -50 % (exactement une copie). */
function MarqueeContent({ text }: { text: string }) {
  return (
    <>
      <span className="pr-14">{text}</span>
      <span className="pr-14" aria-hidden="true">
        {text}
      </span>
    </>
  );
}

/** Task 30 — Menu déroulant « code école » EN HAUT ET À DROITE des pages
 *  Directeur / Enseignant (demande utilisateur). Le déclencheur affiche le
 *  CODE ÉCOLE de l'établissement auquel le compte est fiché (résolu par le
 *  backend — school_code du profil) ; le menu déroulant contient les deux
 *  actions demandées : « Modifier votre mot de passe » et « Déconnexion ».
 *  Pour les rôles non rattachés à une école (admin, inspecteur, parent) le
 *  menu ne rend rien — l'en-tête garde le badge de rôle existant. */
function SchoolAccountMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [pwdOpen, setPwdOpen] = useState(false);
  if (!user?.school_code) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Compte — code école ${user.school_code}. Menu : modifier votre mot de passe, déconnexion`}
            title={
              user.school_name
                ? `${user.school_name} (${user.school_code})`
                : user.school_code
            }
            className="h-9 gap-1.5 border-primary/40 bg-primary/5 hover:bg-primary/10"
          >
            <School className="w-4 h-4 text-primary" aria-hidden />
            <span className="font-mono font-bold tracking-wide">
              {user.school_code}
            </span>
            <ChevronDown
              className="w-3.5 h-3.5 opacity-60"
              aria-hidden
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate font-semibold">{user.full_name}</span>
            <span className="text-xs font-normal text-muted-foreground truncate">
              {ROLE_LABELS[user.role]}
              {user.school_name ? ` · ${user.school_name}` : ""}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              Code école :{" "}
              <span className="font-mono font-semibold text-foreground">
                {user.school_code}
              </span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPwdOpen(true)}>
            <KeyRound className="w-4 h-4 mr-2" aria-hidden />
            Modifier votre mot de passe
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={logout}
            className="text-destructive focus:text-destructive focus:bg-destructive/10"
          >
            <LogOut className="w-4 h-4 mr-2" aria-hidden />
            Déconnexion
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </>
  );
}

interface DashboardShellProps {
  activeView: string;
  onViewChange: (view: string) => void;
  children: ReactNode;
}

// Helper : détermine si un nav item doit être affiché selon l'array modules
function isItemVisible(item: NavItem, modules: string[], role: Role): boolean {
  // Si modules[] est vide (still loading ou premier render), fallback au legacy
  if (modules.length === 0) {
    return item.roles.includes(role);
  }
  return item.moduleKeys.some((k) => modules.includes(k));
}

function SidebarContent({
  activeView,
  onViewChange,
}: {
  activeView: string;
  onViewChange: (v: string) => void;
}) {
  const user = useAuthStore((s) => s.user);
  const modules = useAuthStore((s) => s.modules);
  const logout = useAuthStore((s) => s.logout);
  if (!user) return null;

  // Task 23 + 24 + 26 — Directeur, Enseignant et Parent : TOUS les modules
  // restent affichés, ceux hors de leur périmètre sont GRISÉS (voir
  // TEACHER_ALLOWED_VIEWS / DIRECTOR_ALLOWED_VIEWS / PARENT_ALLOWED_VIEWS).
  // Le parent ne peut cliquer QUE « Portail Parent » — tout le reste est
  // cadenassé. Les autres rôles conservent le filtrage existant (modules
  // masqués, tout actif).
  const allowedViews = allowedViewsForRole(user.role);
  const items = allowedViews
    ? NAV_ITEMS
    : NAV_ITEMS.filter((i) => isItemVisible(i, modules, user.role));

  return (
    <div className="flex h-full flex-col text-sidebar-foreground">
      {/* En-tête de marque */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-sidebar-border">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shrink-0">
          <GraduationCap className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-base leading-tight">SYGREN</p>
          <p className="text-[11px] opacity-70 leading-tight">
            Gestion des Notes
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scroll-sygren px-3 py-4 space-y-0.5">
        {items.map((item) => {
          const active = item.id === activeView;
          // Task 23 + 24 + 26 — module GRISÉ : hors du périmètre du rôle
          // (Directeur / Enseignant : espace de travail — Parent : Portail
          // Parent uniquement). Visible mais non cliquable, curseur
          // interdit, cadenassé.
          const grayed = allowedViews
            ? !allowedViews.has(item.id)
            : false;
          return (
            <button
              key={item.id}
              onClick={() => !grayed && onViewChange(item.id)}
              disabled={grayed}
              aria-disabled={grayed}
              title={
                grayed
                  ? user.role === "parent"
                    ? "Réservé au personnel — le parent accède uniquement au Portail Parent"
                    : user.role === "conseiller"
                      ? "Module non inclus dans votre périmètre — Mon Secteur + consultation des documents de votre secteur"
                      : "Module réservé — accès non autorisé pour votre fonction"
                  : undefined
              }
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : grayed
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {item.badge && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sidebar-accent/60">
                  {item.badge}
                </span>
              )}
              {grayed && (
                <Lock className="w-3 h-3 shrink-0 opacity-70" aria-hidden />
              )}
              {active && <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          );
        })}
      </nav>

      {/* Pied : profil + déconnexion */}
      <div className="border-t border-sidebar-border p-3 space-y-2">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
          <Avatar className="w-9 h-9 border-2 border-sidebar-accent">
            <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground text-xs font-semibold">
              {user.full_name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{user.full_name}</p>
            <p className="text-[11px] opacity-70 truncate">
              {ROLE_LABELS[user.role]}
              {user.service ? ` · ${user.service}` : ""}
            </p>
          </div>
        </div>
        {/* Task 25 — action « Modifier votre mot de passe » : disponible à
            tout moment pour tout utilisateur connecté (en particulier le
            Directeur et l'Enseignant dont le mot de passe standard est le
            numéro de téléphone). */}
        <ChangePasswordButton className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Déconnexion
        </Button>
      </div>
    </div>
  );
}

export function DashboardShell({
  activeView,
  onViewChange,
  children,
}: DashboardShellProps) {
  const user = useAuthStore((s) => s.user);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Bande « Infos SYGREN » — annonces défilantes (haut à gauche)
  // + téléphone de l'administrateur (haut à droite), lus depuis les settings via
  // /api/public/infos (accessible à tout utilisateur connecté). En cas
  // d'échec : valeurs par défaut (bande toujours affichée, chip masquée).
  const [adminPhone, setAdminPhone] = useState("");
  const [infosText, setInfosText] = useState(DEFAULT_INFOS_TEXT);
  useEffect(() => {
    let alive = true;
    api.infos
      .get()
      .then((d) => {
        if (!alive) return;
        if (d.admin_phone) setAdminPhone(d.admin_phone);
        if (d.infos) setInfosText(d.infos);
      })
      .catch(() => {
        /* silencieux — valeurs par défaut affichées */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Gestion centralisée du changement de vue : ferme aussi le drawer mobile
  const handleViewChange = (view: string) => {
    onViewChange(view);
    setMobileOpen(false);
  };

  if (!user) return null;

  const activeItem = NAV_ITEMS.find((i) => i.id === activeView);

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-64 shrink-0 glass-green border-r border-sidebar-border sticky top-0 h-screen">
        <SidebarContent
          activeView={activeView}
          onViewChange={handleViewChange}
        />
      </aside>

      {/* Sidebar mobile (Sheet) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0 border-sidebar-border bg-sidebar"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Menu de navigation</SheetTitle>
          </SheetHeader>
          <SidebarContent
            activeView={activeView}
            onViewChange={handleViewChange}
          />
        </SheetContent>
      </Sheet>

      {/* Contenu principal */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-30 flex items-center gap-3 px-4 lg:px-6 h-16 bg-card/80 glass border-b border-border">
          {/* Bouton menu mobile */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(true)}
            className="lg:hidden"
          >
            <Menu className="w-5 h-5" />
          </Button>

          {/* En haut et à GAUCHE — bande « Infos SYGREN » (demande
              utilisateur) : étiquette verte + annonces DÉFILANTES (marquee
              CSS — boucle sans couture, pause au survol). Version mobile :
              pleine largeur sous l'en-tête (voir plus bas). */}
          <div
            className="hidden md:flex items-stretch shrink-0 overflow-hidden rounded-md border border-primary/30 h-9 w-[300px] lg:w-[420px] xl:w-[540px]"
            role="region"
            aria-label="Infos SYGREN — annonces défilantes"
          >
            <span className="flex items-center gap-1 px-2.5 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wide shrink-0">
              <Megaphone className="w-3 h-3" aria-hidden />
              Infos SYGREN
            </span>
            <div className="relative overflow-hidden flex-1 min-w-0 bg-primary/5">
              <div className="marquee-sygren h-full items-center text-xs font-medium text-foreground/80">
                <MarqueeContent text={infosText} />
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">
              {activeItem?.label ?? "Tableau de bord"}
            </h1>
          </div>

          {/* En haut et à DROITE — téléphone de l'administrateur (demande
              utilisateur). Chip cliquable (tel:) masqué tant que le setting
              infos.admin_phone est vide ; icône seule sur mobile (dans la
              bande Infos sous l'en-tête). */}
          {adminPhone && (
            <a
              href={`tel:${adminPhone.replace(/\s+/g, "")}`}
              title="Téléphone de l'administrateur"
              aria-label={`Téléphone de l'administrateur ${adminPhone}`}
              className="hidden sm:flex items-center gap-1.5 shrink-0 h-9 px-3 rounded-md border border-emerald-300/70 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 transition-colors"
            >
              <Phone className="w-3.5 h-3.5" aria-hidden />
              <span className="text-xs font-semibold whitespace-nowrap tabular-nums">
                {adminPhone}
              </span>
            </a>
          )}

          {/* Task 30 — en haut et à droite : menu déroulant CODE ÉCOLE
              (Directeur / Enseignant — actions « Modifier votre mot de
              passe » et « Déconnexion ») ; les autres rôles gardent le
              badge de fonction. */}
          <div className="flex items-center gap-2 shrink-0">
            <SchoolAccountMenu />
            <Badge
              variant="secondary"
              className="hidden sm:inline-flex capitalize"
            >
              {ROLE_LABELS[user.role]}
            </Badge>
          </div>

          {/* Bande tricolore ivoirien — TÊTE de l'en-tête (orange · blanc ·
              vert). Elle est calée sur la largeur EXACTE du contenu des
              modules (marges p-4/lg:p-6 + max-w-[1800px] centré, comme <main>) :
              un cran MOINS LARGE que la colonne de contenu — elle ne touche
              ni la barre latérale verte ni le bord droit de l'écran et ne
              peut donc plus dépasser le cadre des modules (demande
              utilisateur : « une dimension moins que celle en vert »). */}
          <div
            className="absolute inset-x-4 top-0 flex justify-center lg:inset-x-6"
            aria-hidden="true"
          >
            <div className="h-1.5 w-full max-w-[1800px] ci-flag-stripe" />
          </div>

          {/* Liseré tricolore ivoirien sous l'en-tête (orange · blanc ·
              vert) — identité de la République, même retrait que la bande
              supérieure : largeur du contenu des modules uniquement. */}
          <div
            className="absolute inset-x-4 bottom-0 flex justify-center lg:inset-x-6"
            aria-hidden="true"
          >
            <div className="h-[3px] w-full max-w-[1800px] ci-flag-stripe" />
          </div>
        </header>

        {/* Mobile — bande « Infos SYGREN » en pleine largeur SOUS l'en-tête
            (sur desktop elle est intégrée à gauche de l'en-tête) + téléphone
            de l'administrateur en icône à droite de la bande (le chip
            complet est sm+). */}
        <div className="md:hidden flex items-stretch overflow-hidden border-b border-border bg-card">
          <span className="flex items-center gap-1 px-2 py-1.5 bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wide shrink-0">
            <Megaphone className="w-3 h-3" aria-hidden />
            Infos
          </span>
          <div className="relative overflow-hidden flex-1 min-w-0 bg-primary/5">
            <div className="marquee-sygren h-full items-center text-xs font-medium text-foreground/80">
              <MarqueeContent text={infosText} />
            </div>
          </div>
          {adminPhone && (
            <a
              href={`tel:${adminPhone.replace(/\s+/g, "")}`}
              className="flex items-center px-2.5 bg-emerald-50 text-emerald-800 border-l border-border shrink-0"
              aria-label={`Téléphone de l'administrateur ${adminPhone}`}
            >
              <Phone className="w-3.5 h-3.5" aria-hidden />
            </a>
          )}
        </div>

        {/* Zone de contenu */}
        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden">
          <div className="max-w-[1800px] mx-auto animate-in-up">{children}</div>
        </main>

        {/* Footer sticky */}
        <footer className="mt-auto border-t border-border bg-card py-3 px-4 lg:px-6 text-xs text-muted-foreground">
          <div className="max-w-[1800px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>© {new Date().getFullYear()} SYGREN — Côte d'Ivoire</span>
            <span className="text-[11px]">
              v0.1.0 · Architecture D · RBAC dynamique + Audit
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
