"use client";

// Task 25 — Action « Modifier votre mot de passe ».
//
// Composant réutilisable (dialog + bouton déclencheur) permettant à TOUT
// utilisateur connecté — en particulier le Directeur et l'Enseignant — de
// changer son mot de passe à tout moment (mot de passe standard = numéro
// de téléphone à la création du compte).
//
// Backend : POST /api/auth/change-password (AUTH) — vérifie le mot de passe
// actuel, impose 6 caractères minimum, lève must_change_password.

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { authApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Dialog de changement de mot de passe (contrôlé par le parent). */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const canSubmit =
    current.length > 0 && next.length >= 6 && next === confirm && !loading;

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setLoading(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      toast.error("Erreur", {
        description:
          "Le nouveau mot de passe et la confirmation doivent être identiques.",
      });
      return;
    }
    if (next.length < 6) {
      toast.error("Mot de passe trop court", {
        description: "6 caractères minimum.",
      });
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword({
        current_password: current,
        new_password: next,
      });
      toast.success("Mot de passe modifié", {
        description:
          "Votre nouveau mot de passe est actif. Utilisez-le à votre prochaine connexion.",
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error("Échec du changement", {
        description:
          err instanceof Error ? err.message : "Erreur inconnue",
      });
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" aria-hidden />
            Modifier votre mot de passe
          </DialogTitle>
          <DialogDescription>
            Saisissez votre mot de passe actuel, puis choisissez un nouveau
            mot de passe (6 caractères minimum).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cpd-current">Mot de passe actuel</Label>
            <Input
              id="cpd-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cpd-next">Nouveau mot de passe</Label>
            <Input
              id="cpd-next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="6 caractères minimum"
              disabled={loading}
              required
              minLength={6}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cpd-confirm">Confirmer le nouveau mot de passe</Label>
            <Input
              id="cpd-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Répétez le nouveau mot de passe"
              disabled={loading}
              required
              minLength={6}
            />
            {confirm.length > 0 && next !== confirm && (
              <p className="text-xs text-destructive">
                Les deux mots de passe ne correspondent pas.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
              disabled={loading}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Enregistrement…
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4 mr-1.5" />
                  Modifier le mot de passe
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Bouton déclencheur auto-contenu : ouvre le dialog de changement. */
export function ChangePasswordButton({
  variant = "ghost",
  className,
  children,
}: {
  variant?: "ghost" | "outline" | "default" | "secondary" | "link";
  className?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className={className}
        onClick={() => setOpen(true)}
      >
        <KeyRound className="w-4 h-4 mr-2" aria-hidden />
        {children ?? "Modifier votre mot de passe"}
      </Button>
      <ChangePasswordDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
