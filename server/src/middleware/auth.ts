// Auth por Bearer do Supabase — o frontend manda o access_token da sessão.
// (O sistema de origem também aceitava sessão Express; aqui não há sessão.)

import type { Request, Response, NextFunction } from "express";
import { rx } from "../lib/supabase.js";

export interface RequestComUsuario extends Request {
  usuarioId?: string;
  tenantId?: string;
  papel?: string;
}

async function usuarioDoBearer(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const { data: { user }, error } = await rx.auth.getUser(authHeader.slice(7));
  return !error && user ? { id: user.id } : null;
}

export async function requireSupabaseAuth(req: Request, res: Response, next: NextFunction) {
  const user = await usuarioDoBearer(req);
  if (!user) return res.status(401).json({ error: "Não autorizado." });
  (req as RequestComUsuario).usuarioId = user.id;
  next();
}

/**
 * Exige admin do módulo. Necessário para as rotas de configuração: elas leem e
 * gravam o token do NetRis, que é segredo — estar apenas autenticado não basta,
 * ainda mais com o auth.users compartilhado com o sistema da Imago.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await usuarioDoBearer(req);
  if (!user) return res.status(401).json({ error: "Não autorizado." });

  const { data, error } = await rx
    .from("usuarios")
    .select("tenant_id, papel, ativo")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data || !data.ativo || data.papel !== "admin") {
    return res.status(403).json({ error: "Apenas administradores." });
  }

  const r = req as RequestComUsuario;
  r.usuarioId = user.id;
  r.tenantId = data.tenant_id;
  r.papel = data.papel;
  next();
}
