import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Fase 3: o papel deixou de vir de `public.user_roles` (que permitia N linhas
// por usuário e quebrava com .maybeSingle()) e passou a ser determinado por
// QUAL tabela do schema `receituarios` tem o usuário:
//   receituarios.usuarios → staff  (papel 'admin' | 'operador')
//   receituarios.medicos  → médico prescritor
// Quem não está em nenhuma das duas fica sem acesso (ver <SemAcesso />).

export interface Usuario {
  id: string;
  nome: string;
  email: string | null;
  papel: "admin" | "operador";
  ativo: boolean;
}

export interface Medico {
  id: string;
  nome: string;
  email: string | null;
  crm: string;
  especialidade: string | null;
  assinatura_png: string | null;
  ativo: boolean;
}

export type Papel = "admin" | "operador" | "medico";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  usuario: Usuario | null;
  medico: Medico | null;
  papel: Papel | null;
  loading: boolean;
  signOut: () => Promise<void>;
  /** Relê usuário/médico — usado após o bootstrap e após salvar a assinatura. */
  recarregar: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [medico, setMedico] = useState<Medico | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async (userId: string) => {
    const [{ data: u }, { data: m }] = await Promise.all([
      supabase.from("usuarios").select("*").eq("id", userId).maybeSingle(),
      supabase.from("medicos").select("*").eq("id", userId).maybeSingle(),
    ]);
    setUsuario((u as Usuario | null) ?? null);
    setMedico((m as Medico | null) ?? null);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        // setTimeout evita deadlock: chamadas ao Supabase dentro do callback do
        // onAuthStateChange travam enquanto o lock interno de auth está preso.
        setTimeout(() => carregar(newSession.user.id), 0);
      } else {
        setUsuario(null);
        setMedico(null);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      if (existing?.user) await carregar(existing.user.id);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [carregar]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const recarregar = useCallback(async () => {
    if (user?.id) await carregar(user.id);
  }, [user?.id, carregar]);

  const papel: Papel | null =
    usuario?.ativo ? usuario.papel
    : medico?.ativo ? "medico"
    : null;

  return (
    <AuthContext.Provider
      value={{ user, session, usuario, medico, papel, loading, signOut, recarregar }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
