import { createClient } from "@supabase/supabase-js";

const _supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const _supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!_supabaseUrl || !_supabaseKey) {
  throw new Error("[Supabase] VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY são obrigatórias.");
}

export const SUPABASE_URL: string = _supabaseUrl;

export const supabase = createClient(_supabaseUrl, _supabaseKey, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
  // Todas as tabelas do módulo vivem no schema `receituarios` (Fase 1), não em
  // `public`. Isso vale só para PostgREST — auth e storage não são afetados.
  // Se algum dia for preciso ler algo de public, use .schema("public") no
  // ponto de uso.
  db: { schema: "receituarios" },
});
