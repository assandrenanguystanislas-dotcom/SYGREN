"use client";

// Task 30 — Bannière d'identification à l'établissement.
//
// Demande utilisateur : lorsqu'il entre dans le module Utilisateurs — plus
// précisément dans les onglets « Directeurs » et « Enseignants » — le
// compte connecté (directeur / enseignant) doit voir l'établissement auquel
// il est FICHÉ (le code école du module École + le nom de l'école).
//
// Le composant lit le profil depuis le store d'authentification :
// school_code / school_name sont résolus par le backend sur /api/auth/login
// et /api/me (Task 30). Pour les rôles non rattachés à une école (admin,
// inspecteur, parent) la bannière ne rend RIEN — les onglets restent
// inchangés pour eux (vision multi-écoles).

import { School } from "lucide-react";

import { useAuthStore } from "@/lib/auth-store";
import { ROLE_LABELS } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

export function SchoolIdentityBanner() {
  const user = useAuthStore((s) => s.user);
  if (!user?.school_code) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2"
      role="status"
      aria-label={`Votre établissement : ${user.school_code}`}
    >
      <School className="w-4 h-4 text-primary shrink-0" aria-hidden />
      <span className="text-sm">
        Vous êtes fiché dans l&apos;établissement :{" "}
        <span className="font-mono font-bold tracking-wide">
          {user.school_code}
        </span>
        {user.school_name ? (
          <span className="text-muted-foreground"> — {user.school_name}</span>
        ) : null}
      </span>
      <Badge
        variant="outline"
        className="ml-auto capitalize shrink-0"
      >
        {ROLE_LABELS[user.role]}
      </Badge>
    </div>
  );
}
