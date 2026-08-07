// Tela de quem está logado mas não é nem staff nem médico.
//
// Existe por causa de um detalhe da Fase 1: o auth.users é compartilhado com o
// sistema da Imago, então "estar autenticado" não significa ter acesso a este
// módulo. Quem não tem linha em receituarios.usuarios nem em
// receituarios.medicos cai aqui.
//
// É também o único caminho de entrada do PRIMEIRO admin: a RPC
// bootstrap_admin() só funciona enquanto a tabela usuarios estiver vazia, então
// o botão é oferecido e, se já houver alguém, a própria RPC recusa.

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldQuestion, KeyRound, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/contexts/AuthContext";
import imagoLogo from "@/assets/imago-logo.png";

export default function SemAcesso() {
  const { user, signOut, recarregar } = useAuth();
  const [carregando, setCarregando] = useState(false);
  const [nomeClinica, setNomeClinica] = useState("");

  async function assumirAdmin() {
    setCarregando(true);
    try {
      const { error } = await supabase.rpc("bootstrap_admin", {
        p_nome: user?.user_metadata?.full_name ?? null,
        p_tenant_nome: nomeClinica || null,
      });
      if (error) throw error;
      toast.success("Pronto — você agora é o administrador do módulo.");
      await recarregar();
    } catch (e: any) {
      toast.error("Não foi possível assumir como admin", {
        description: e?.message ?? String(e),
      });
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-6">
      <div className="w-full max-w-md bg-card rounded-xl border border-border shadow-lg p-8 space-y-6 text-center">
        <img src={imagoLogo} alt="Imago" className="h-10 mx-auto" />
        <ShieldQuestion className="h-12 w-12 mx-auto text-muted-foreground/40" />

        <div className="space-y-1">
          <h1 className="text-xl font-extrabold tracking-tight text-foreground">
            Sem acesso aos Receituários
          </h1>
          <p className="text-sm text-muted-foreground">
            Sua conta ({user?.email}) está autenticada, mas ainda não foi vinculada
            a este módulo. Peça um convite a um administrador.
          </p>
        </div>

        <div className="space-y-2 pt-2">
          <Input
            value={nomeClinica}
            onChange={e => setNomeClinica(e.target.value)}
            placeholder="Nome da clínica"
            className="text-center"
          />
          <Button onClick={assumirAdmin} disabled={carregando} className="w-full gap-2">
            {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Sou o primeiro administrador
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Cria a clínica e o primeiro administrador. Só funciona na primeira
            configuração, enquanto não houver nenhum usuário no módulo — clientes
            novos são abertos pelo backend, com <code>provisionar_tenant</code>.
          </p>
        </div>

        <Button variant="ghost" onClick={signOut} className="w-full gap-2 text-muted-foreground">
          <LogOut className="h-4 w-4" /> Sair
        </Button>
      </div>
    </div>
  );
}
