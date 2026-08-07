// ─────────────────────────────────────────────────────────────────────────────
// POST /api/public/medico/cadastro
//
// Rota pública (sem auth) para o médico completar o cadastro via link de convite.
// Usa supabaseAdmin (service_role) para:
//   1. Validar e consumir o token de convite (receituarios.convites)
//   2. Criar a conta no Supabase Auth
//   3. Criar o registro em receituarios.medicos (com CRM e assinatura)
//
// Fase 3: não mexe mais em public.profiles nem em public.user_roles — o papel
// do usuário agora é determinado por estar em receituarios.medicos.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { rx } from "../lib/supabase.js";

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

  // 1. Valida o convite
  // O convite carrega o tenant: é ele que diz em qual clínica o médico entra.
  const { data: convite, error: conviteErr } = await rx
    .from("convites")
    .select("id, tenant_id, tipo, usado_em, expira_em")
    .eq("token", token)
    .maybeSingle();

  if (conviteErr || !convite) {
    return res.status(400).json({ error: "Token de convite inválido" });
  }
  if (convite.tipo !== "medico") {
    return res.status(400).json({ error: "Este convite não é de médico" });
  }
  if (convite.usado_em) {
    return res.status(400).json({ error: "Este link de convite já foi utilizado" });
  }
  if (new Date(convite.expira_em) < new Date()) {
    return res.status(400).json({ error: "Este link de convite expirou" });
  }

  // 2. Cria o usuário no Supabase Auth
  const { data: authData, error: authErr } = await rx.auth.admin.createUser({
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
    // 3. Cria o médico. Não há mais espera por trigger: a linha em
    //    receituarios.medicos é criada aqui, explicitamente.
    const { error: medicoErr } = await rx
      .from("medicos")
      .upsert({
        id:                       userId,
        tenant_id:                convite.tenant_id,
        nome:                     fullName,
        email,
        crm,
        especialidade,
        assinatura_png:           signaturePng,
        assinatura_atualizada_em: new Date().toISOString(),
        ativo:                    true,
      }, { onConflict: "id" });

    if (medicoErr) throw new Error(`Médico: ${medicoErr.message}`);

    // 4. Consome o convite
    const { error: conviteUpdErr } = await rx
      .from("convites")
      .update({ usado_em: new Date().toISOString(), usado_por: userId })
      .eq("id", convite.id);

    if (conviteUpdErr) throw new Error(`Convite: ${conviteUpdErr.message}`);

    return res.json({ ok: true });

  } catch (e: any) {
    // Rollback: remove o usuário criado para não deixar conta "zumbi"
    await rx.auth.admin.deleteUser(userId).catch(() => {});
    console.error("[medico-cadastro]", e?.message);
    return res.status(500).json({ error: "Erro ao configurar o cadastro", detail: e?.message });
  }
});

export default router;
