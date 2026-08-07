import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("[server] SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias (server/.env).");
}

// Fase 3: as tabelas do módulo vivem no schema `receituarios`, não em `public`.
// `db.schema` afeta só o PostgREST — auth.admin.* continua funcionando normal,
// por isso o mesmo client serve para as duas coisas.
export const rx = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "receituarios" },
});

/** @deprecated use `rx` — mantido para não quebrar imports antigos. */
export const supabaseAdmin = rx;
