// ─────────────────────────────────────────────────────────────────────────────
// POST /api/public/medico/cadastro
//
// Rota pública (sem auth) para o médico completar o cadastro via link de convite.
// Usa supabaseAdmin (service_role) para:
//   1. Criar a conta no Supabase Auth
//   2. Validar e consumir o token de convite
//   3. Atualizar o perfil (crm, especialidade, signature_data)
//   4. Inserir role "medico" em user_roles
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { supabaseAdmin } from "../lib/supabase.js";

const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 10,                    // 10 cadastros por IP por hora
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente em 1 hora." },
});

const schema = z.object({
  token:          z.string().min(10),
  fullName:       z.string().min(3).max(120),
  email:          z.string().email(),
  password:       z.string().min(6).max(72),
  crm:            z.string().min(3).max(30),
  especialidade:  z.string().min(3).max(80),
  signaturePng:   z.string().min(100), // base64 PNG
});

router.post("/cadastro", limiter, async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", detail: parsed.error.flatten() });
  }

  const { token, fullName, email, password, crm, especialidade, signaturePng } = parsed.data;

  // 1. Valida o token de convite
  const { data: invite, error: inviteErr } = await supabaseAdmin
    .from("medico_invite_tokens" as any)
    .select("id, tenant_id, used_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (inviteErr || !invite) {
    return res.status(400).json({ error: "Token de convite inválido" });
  }
  if ((invite as any).used_at) {
    return res.status(400).json({ error: "Este link de convite já foi utilizado" });
  }
  if (new Date((invite as any).expires_at) < new Date()) {
    return res.status(400).json({ error: "Este link de convite expirou" });
  }

  const tenantId = (invite as any).tenant_id as string;

  // 2. Cria o usuário no Supabase Auth
  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,          // confirma automaticamente (sem email de verificação)
    user_metadata: { full_name: fullName },
  });

  if (authErr || !authData.user) {
    const msg = authErr?.message ?? "Erro ao criar conta";
    const isDuplicate = msg.toLowerCase().includes("already") || msg.toLowerCase().includes("duplicate");
    return res.status(isDuplicate ? 409 : 500).json({
      error: isDuplicate ? "Email já cadastrado no sistema" : msg,
    });
  }

  const userId = authData.user.id;

  try {
    // 3. Aguarda o trigger criar o perfil (~500ms) e atualiza
    await new Promise(r => setTimeout(r, 600));

    const { error: profErr } = await supabaseAdmin
      .from("profiles" as any)
      .upsert({
        id:                      userId,
        tenant_id:               tenantId,
        full_name:               fullName,
        email,
        crm,
        especialidade,
        signature_data:          signaturePng,
        signature_configured_at: new Date().toISOString(),
        approved:                true,
        is_active:               true,
      }, { onConflict: "id" });

    if (profErr) throw new Error(`Perfil: ${profErr.message}`);

    // 4. Role medico em user_roles
    const { error: roleErr } = await supabaseAdmin
      .from("user_roles" as any)
      .upsert({ user_id: userId, tenant_id: tenantId, role: "medico" }, { onConflict: "user_id,tenant_id" });

    if (roleErr) throw new Error(`Role: ${roleErr.message}`);

    // 5. Marca o token como usado
    await supabaseAdmin
      .from("medico_invite_tokens" as any)
      .update({ used_at: new Date().toISOString(), used_by: userId })
      .eq("token", token);

    return res.json({ ok: true });

  } catch (e: any) {
    // Rollback: remove o usuário criado para não deixar conta "zumbi"
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
    console.error("[medico-cadastro]", e?.message);
    return res.status(500).json({ error: "Erro ao configurar o cadastro", detail: e?.message });
  }
});

export default router;
