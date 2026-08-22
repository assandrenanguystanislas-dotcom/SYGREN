"use client";

import { useState, type ReactNode } from "react";
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
  UserCog,
} from "lucide-react";

import { useAuthStore } from "@/lib/auth-store";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  roles: Role[];
  badge?: string;
}

// Navigation RBAC — chaque item n'est visible que pour les rôles autorisés
export const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "Tableau de bord",
    icon: <LayoutDashboard className="w-4 h-4" />,
    roles: ["admin", "director", "inspector", "teacher"],
  },
  {
    id: "iep",
    label: "Inspections (IEP)",
    icon: <BarChart3 className="w-4 h-4" />,
    roles: ["admin", "inspector"],
  },
  {
    id: "schools",
    label: "Écoles",
    icon: <School className="w-4 h-4" />,
    roles: ["admin", "inspector", "director"],
  },
  {
    id: "students",
    label: "Élèves",
    icon: <Users className="w-4 h-4" />,
    roles: ["admin", "inspector", "director", "teacher"],
  },
  {
    id: "users",
    label: "Utilisateurs",
    icon: <UserCog className="w-4 h-4" />,
    roles: ["admin", "inspector", "director"],
  },
  {
    id: "subjects",
    label: "Matières",
    icon: <BookOpen className="w-4 h-4" />,
    roles: ["admin", "director", "teacher", "inspector"],
  },
  {
    id: "evaluations",
    label: "Évaluations",
    icon: <ClipboardList className="w-4 h-4" />,
    roles: ["admin", "director", "inspector", "teacher"],
  },
  {
    id: "results",
    label: "Résultats",
    icon: <Trophy className="w-4 h-4" />,
    roles: ["teacher", "director", "admin", "inspector"],
  },
  {
    id: "bulletins",
    label: "Bulletins",
    icon: <FileText className="w-4 h-4" />,
    roles: ["admin", "director", "inspector"],
  },
  {
    id: "settings",
    label: "Paramètres",
    icon: <Settings className="w-4 h-4" />,
    roles: ["admin"],
  },
];

interface DashboardShellProps {
  activeView: string;
  onViewChange: (view: string) => void;
  children: ReactNode;
}

function SidebarContent({
  activeView,
  onViewChange,
}: {
  activeView: string;
  onViewChange: (v: string) => void;
}) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  if (!user) return null;

  const items = NAV_ITEMS.filter((i) => i.roles.includes(user.role));

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
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
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
            </p>
          </div>
        </div>
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

          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">
              {activeItem?.label ?? "Tableau de bord"}
            </h1>
          </div>

          <Badge
            variant="secondary"
            className="hidden sm:inline-flex capitalize"
          >
            {ROLE_LABELS[user.role]}
          </Badge>
        </header>

        {/* Zone de contenu */}
        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden">
          <div className="max-w-7xl mx-auto animate-in-up">{children}</div>
        </main>

        {/* Footer sticky */}
        <footer className="mt-auto border-t border-border bg-card py-3 px-4 lg:px-6 text-xs text-muted-foreground">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>© {new Date().getFullYear()} SYGREN — Côte d'Ivoire</span>
            <span className="text-[11px]">
              v0.1.0 · Backend Go sur port 8080
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
