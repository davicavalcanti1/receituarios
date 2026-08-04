// Auth por Bearer do Supabase — o frontend manda o access_token da sessão.
// (O sistema de origem também aceitava sessão Express; aqui não há sessão.)

import type { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabase.js";

export async function requireSupabaseAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (!error && user) return next();
  }
  return res.status(401).json({ error: "Não autorizado." });
}
