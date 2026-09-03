"use client";

// === Task 26 — Auto-inscription « Créer vos accès » (fin de la phase pilote) ===
//
// Les DIRECTEURS et les ENSEIGNANTS créent eux-mêmes leurs accès SYGREN
// depuis l'écran de connexion :
//   - le CODE ÉCOLE désigne leur établissement (chacun sur SON école) ;
//   - le mot de passe STANDARD est le numéro de téléphone (laisser vide),
//     modifiable à tout moment via « Modifier votre mot de passe » ;
//   - une fois les accès établis, ils se connectent via l'interface qui
//     leur est dédiée et atterrissent sur le module Utilisateurs.
//
// Le PARENT n'a pas d'auto-inscription : son compte est créé par
// l'administration (module Utilisateurs → onglet Parents) avec son numéro
// de téléphone comme code ET mot de passe.

import { useState } from "react";
import { Loader2, UserPlus, School, Phone, Lock, Info } from "lucide-react";
import { toast } from "sonner";

import { authApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface RegisterAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fonction de l'utilisateur : fixée par l'onglet actif de la connexion. */
  role: "director" | "teacher";
  /** Pré-remplit le formulaire de connexion après création réussie. */
  onRegistered?: (schoolCode: string, phone: string) => void;
}

const EMPTY_FORM = {
  school_code: "",
  full_name: "",
  phone: "",
  email: "",
  password: "",
};

export function RegisterAccessDialog({
  open,
  onOpenChange,
  role,
  onRegistered,
}: RegisterAccessDialogProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  const roleLabel = role === "director" ? "Directeur" : "Enseignant";

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !form.school_code.trim() ||
      !form.full_name.trim() ||
      !form.phone.trim()
    ) {
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.registerAccess({
        role,
        school_code: form.school_code.trim(),
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        // Vide → mot de passe standard = numéro de téléphone (backend)
        password: form.password || undefined,
      });
      toast.success("Accès créés avec succès", {
        description:
          res.message ||
          `Vos accès ${roleLabel} sont établis. Connectez-vous maintenant.`,
      });
      onRegistered?.(form.school_code.trim(), form.phone.trim());
      setForm(EMPTY_FORM);
      onOpenChange(false);
    } catch (err) {
      toast.error("Création impossible", {
        description: err instanceof Error ? err.message : "Erreur inconnue",
      });
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    !!form.school_code.trim() && !!form.full_name.trim() && !!form.phone.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Créer vos accès — {roleLabel}
          </DialogTitle>
          <DialogDescription>
            Créez vos accès SYGREN avec le code école de VOTRE établissement.
            Une fois les accès établis, connectez-vous via l&apos;onglet{" "}
            {roleLabel} : vous accédez directement au module Utilisateurs.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3.5">
          <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[11px] text-muted-foreground">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
            <span>
              Fin de la phase pilote : chaque directeur et chaque enseignant
              établit ses propres accès. Le mot de passe standard est votre
              numéro de téléphone — modifiable à tout moment via «&nbsp;Modifier
              votre mot de passe&nbsp;» après connexion.
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-school">
              <School className="w-3 h-3 inline mr-1 -mt-0.5" />
              Code école *
            </Label>
            <Input
              id="reg-school"
              value={form.school_code}
              onChange={(e) => set("school_code", e.target.value)}
              placeholder="ex : EPPCP001"
              className="font-mono"
              disabled={loading}
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-name">Nom complet *</Label>
            <Input
              id="reg-name"
              value={form.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              placeholder="ex : KOUAME Awa"
              disabled={loading}
              autoComplete="name"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-phone">
              <Phone className="w-3 h-3 inline mr-1 -mt-0.5" />
              Téléphone *
            </Label>
            <Input
              id="reg-phone"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+225 07 00 00 00 00"
              disabled={loading}
              autoComplete="tel"
            />
            <p className="text-[11px] text-muted-foreground">
              Sert d&apos;identifiant et de mot de passe standard.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-email">Email (optionnel)</Label>
            <Input
              id="reg-email"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="vous@exemple.ci"
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reg-password">
              <Lock className="w-3 h-3 inline mr-1 -mt-0.5" />
              Mot de passe (optionnel)
            </Label>
            <Input
              id="reg-password"
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder="Laisser vide → votre numéro de téléphone"
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={loading || !canSubmit}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Création…
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-1.5" />
                  Créer mes accès
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
