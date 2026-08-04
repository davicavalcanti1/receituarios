// Login simples por e-mail + senha (Supabase Auth).
// Médicos criam conta pelo link de convite (/cadastro/medico?token=…).

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // ReceituariosPage redireciona médico prescritor pro portal dele
      navigate("/receituarios", { replace: true });
    } catch (err: any) {
      toast.error("Não foi possível entrar", { description: err?.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-muted/30 p-6 font-sans">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <span className="inline-grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ScrollText className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Receituários</h1>
          <p className="text-sm text-muted-foreground">Entre com sua conta para continuar</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-card">
          <Input
            type="email" placeholder="E-mail" value={email} autoComplete="email"
            onChange={(e) => setEmail(e.target.value)} required
          />
          <Input
            type="password" placeholder="Senha" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} required
          />
          <Button type="submit" disabled={loading} className="w-full gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Entrar
          </Button>
        </form>
      </div>
    </div>
  );
}
