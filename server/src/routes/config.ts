// Configuração do runtime e da integração NetRis.
//
//   GET  /api/config          — público, só flags booleanas (o front decide o que renderizar)
//   GET  /api/config/netris   — admin, estado da conexão SEM o token
//   PUT  /api/config/netris   — admin, grava a conexão
//   POST /api/config/netris/testar — admin, testa credenciais antes de salvar
//
// O token do NetRis NUNCA sai daqui para o navegador. A tabela `integracoes`
// tem RLS ligada sem policy para `authenticated`: só o service_role lê.

import { Router } from "express";
import { z } from "zod";
import { rx } from "../lib/supabase.js";
import { netrisConfigurado, configNetris, invalidarConfigNetris } from "../lib/netris.js";
import { requireAdmin, type RequestComUsuario } from "../middleware/auth.js";

const router = Router();

router.get("/", async (_req, res) => {
  res.json({
    integracoes: {
      netris: await netrisConfigurado(),
    },
  });
});

router.get("/netris", requireAdmin, async (req, res) => {
  const { tenantId } = req as RequestComUsuario;
  const { data } = await rx
    .from("integracoes")
    .select("ativo, base_url, filial_id, atualizado_em")
    .eq("tenant_id", tenantId).eq("provedor", "netris")
    .maybeSingle();

  const cfg = await configNetris();
  res.json({
    ativo:             data?.ativo ?? false,
    baseUrl:           data?.base_url ?? "",
    filialId:          data?.filial_id ?? "1",
    atualizadoEm:      data?.atualizado_em ?? null,
    // Nunca o token: só se existe um guardado.
    temTokenGuardado:  await temToken(tenantId),
    // De onde a conexão em uso está vindo agora: ajuda a explicar por que a
    // integração está ligada mesmo sem nada salvo na tela (fallback do env).
    origemEmUso:       cfg.origem,
  });
});

async function temToken(tenantId?: string): Promise<boolean> {
  if (!tenantId) return false;
  const { data } = await rx
    .from("integracoes").select("token")
    .eq("tenant_id", tenantId).eq("provedor", "netris").maybeSingle();
  return Boolean(data?.token);
}

const schemaNetris = z.object({
  ativo:    z.boolean(),
  baseUrl:  z.string().url().or(z.literal("")),
  filialId: z.string().min(1).max(20),
  // Ausente = mantém o token já guardado. É o que permite editar a URL sem
  // precisar redigitar o segredo.
  token:    z.string().min(1).optional(),
});

router.put("/netris", requireAdmin, async (req, res) => {
  const { tenantId, usuarioId } = req as RequestComUsuario;
  const parsed = schemaNetris.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Dados inválidos", detail: parsed.error.flatten() });
  }
  const { ativo, baseUrl, filialId, token } = parsed.data;

  if (ativo && !baseUrl) {
    return res.status(400).json({ error: "Para ativar, informe a URL base." });
  }
  if (ativo && !token && !(await temToken(tenantId))) {
    return res.status(400).json({ error: "Para ativar, informe o token." });
  }

  const payload: Record<string, unknown> = {
    tenant_id: tenantId,
    provedor: "netris",
    ativo,
    base_url: baseUrl || null,
    filial_id: filialId,
    atualizado_em: new Date().toISOString(),
    atualizado_por: usuarioId ?? null,
  };
  if (token) payload.token = token;

  const { error } = await rx
    .from("integracoes")
    .upsert(payload, { onConflict: "tenant_id,provedor" });

  if (error) return res.status(500).json({ error: "Erro ao salvar", detail: error.message });

  invalidarConfigNetris();
  res.json({ ok: true });
});

// Testa antes de salvar: sem isso, só se descobre que o token está errado na
// hora de montar um lote.
router.post("/netris/testar", requireAdmin, async (req, res) => {
  const { tenantId } = req as RequestComUsuario;
  const baseUrl = String(req.body?.baseUrl ?? "").trim();
  let token = String(req.body?.token ?? "").trim();
  const filialId = String(req.body?.filialId ?? "1").trim();

  if (!baseUrl) return res.status(400).json({ error: "Informe a URL base." });

  if (!token) {
    const { data } = await rx
      .from("integracoes").select("token")
      .eq("tenant_id", tenantId).eq("provedor", "netris").maybeSingle();
    token = data?.token ?? "";
  }
  if (!token) return res.status(400).json({ error: "Informe o token." });

  const hoje = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const params = new URLSearchParams({
    filialId, limit: "1", page: "1", dataInicial: hoje, dataFinal: hoje,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const r = await fetch(`${baseUrl}/netris/api/atendimentos?${params}`, {
      headers: { "Content-Type": "application/json", Authorization: token },
      signal: controller.signal,
    });
    if (!r.ok) {
      const corpo = await r.text().catch(() => r.statusText);
      return res.status(200).json({ ok: false, status: r.status, detalhe: corpo.slice(0, 200) });
    }
    return res.json({ ok: true, status: r.status });
  } catch (e: any) {
    return res.status(200).json({ ok: false, detalhe: e?.message ?? String(e) });
  } finally {
    clearTimeout(timer);
  }
});

export default router;
