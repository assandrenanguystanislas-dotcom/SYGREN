"use client";

import { Loader2, type LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface EntityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  loading?: boolean;
}

/**
 * Dialog générique pour créer/modifier une entité (IEP, école, classe, élève…).
 * Affiche un loader pendant la soumission.
 */
export function EntityDialog({
  open,
  onOpenChange,
  title,
  description,
  icon: Icon,
  children,
  loading = false,
}: EntityDialogProps) {
  return (
    <Dialog open={open} onOpenChange={loading ? () => {} : onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {Icon && (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary mb-2">
              <Icon className="w-5 h-5" />
            </div>
          )}
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="relative">
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
