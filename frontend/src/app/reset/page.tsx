"use client";

import { useState, useEffect } from "react";
import { authApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Lock, CheckCircle2, AlertCircle, GraduationCap } from "lucide-react";
import { toast } from "sonner";

export default function ResetPage() {
  const [token, setToken] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token") || "";
    setToken(t);
    if (!t) {
      setError("Token manquant. Le lien de réinitialisation est invalide.");
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (newPwd !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    if (newPwd.length < 6) {
      setError("Le mot de passe doit faire au moins 6 caractères.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await authApi.resetPasswordWithToken({ token, new_password: newPwd });
      setDone(true);
      toast.success("Mot de passe changé", { description: "Vous pouvez vous connecter." });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background p-4">
      <div className="absolute inset-x-0 top-0 h-1.5 ci-flag-stripe" />
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 mb-2">
        <GraduationCap className="w-8 h-8" />
      </div>

      {done ? (
        <div className="w-full max-w-md text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <h1 className="text-xl font-bold">Mot de passe changé</h1>
          <p className="text-sm text-muted-foreground">
            Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant
            vous connecter avec votre nouveau mot de passe.
          </p>
          <Button onClick={() => (window.location.href = "/")} className="w-full">
            Aller à la page de connexion
          </Button>
        </div>
      ) : (
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 mb-4">
            <Lock className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold">Réinitialiser le mot de passe</h1>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Définissez votre nouveau mot de passe ci-dessous.
          </p>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mb-4">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium mb-1 block">Nouveau mot de passe (6 caractères min.)</label>
              <Input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="••••••••"
                disabled={loading || !token}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Confirmer le nouveau mot de passe</label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                disabled={loading || !token}
                required
              />
            </div>
            <Button
              type="submit"
              disabled={loading || !token || !newPwd || !confirm}
              className="w-full"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
              ) : (
                <Lock className="w-4 h-4 mr-1.5" />
              )}
              Réinitialiser le mot de passe
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
