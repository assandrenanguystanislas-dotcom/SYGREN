"use client";

import { Loader2, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface EntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  loading?: boolean;
  /**
   * Largeur maximale du dialog. Par défaut "sm:max-w-md" (28rem / 448px).
   * Pour les formulaires larges (grilles 2 colonnes), passer "sm:max-w-lg"
   * (32rem) ou "sm:max-w-xl" (36rem).
   */
  maxWidth?: string;
}

/**
 * Dialog générique pour créer/modifier une entité (IEP, école, classe, élève…).
 * Affiche un loader pendant la soumission.
 *
 * Gestion du contenu long : le dialog utilise une layout flex column avec une
 * hauteur maximale de 90vh. L'en-tête (titre + description) reste fixe en haut,
 * et le corps (children) devient scrollable si son contenu dépasse la hauteur
 * disponible. Cela évite que les champs de bas de formulaire (notamment les
 * boutons d'action) soient invisibles/inaccessibles sur les petits écrans ou
 * les formulaires longs (ex : création de session avec exemptions).
 */
export function EntityDialog({
  open,
  onOpenChange,
  title,
  description,
  icon: Icon,
  children,
  loading = false,
  maxWidth = "sm:max-w-md",
}: EntityDialogProps) {
  return (
    <Dialog open={open} onOpenChange={loading ? () => {} : onOpenChange}>
      <DialogContent
        className={cn(
          maxWidth,
          // Layout flex column : en-tête fixe + corps scrollable.
          // twMerge garantit que "flex flex-col" remplace le "grid" par défaut
          // de DialogContent (shadcn) sans conflit.
          "flex flex-col max-h-[90vh] gap-4 overflow-hidden",
        )}
      >
        {/* En-tête fixe (ne défile pas) */}
        <DialogHeader className="shrink-0">
          {Icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
              <Icon className="w-5 h-5" />
            </div>
          )}
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/* Corps scrollable : les longs formulaires défilent verticalement.
            pr-1 / -mr-1 : garde le contenu aligné à droite malgré la scrollbar
            (évite un saut de layout quand elle apparaît). scroll-sygren applique
            la scrollbar personnalisée définie dans globals.css. */}
        <div className="relative flex-1 min-h-0 overflow-y-auto pr-1 -mr-1 scroll-sygren">
          {children}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/40 rounded-md backdrop-blur-sm">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
