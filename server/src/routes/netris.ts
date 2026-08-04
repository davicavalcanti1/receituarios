// GET /api/netris/atendimentos — mesma interface da rota do sistema de origem
// (o frontend copiado chama exatamente este endpoint em buscarAtendimentos).

import { Router } from "express";
import { z } from "zod";
import { requireSupabaseAuth } from "../middleware/auth.js";
import { fetchAtendimentosCacheado, NETRIS_FILIAL } from "../lib/netris.js";

const router = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/atendimentos", requireSupabaseAuth, async (req, res) => {
  try {
    const parsed = z
      .object({
        dataInicial: z.string().regex(ISO_DATE),
        dataFinal:   z.string().regex(ISO_DATE),
        filialId:    z.string().optional(),
      })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Parâmetros inválidos" });

    const { dataInicial, dataFinal, filialId = NETRIS_FILIAL } = parsed.data;
    const data = await fetchAtendimentosCacheado(dataInicial, dataFinal, filialId);
    res.json({ data });
  } catch (err: any) {
    console.error("[netris] GET /atendimentos:", { message: err?.message, query: req.query });
    res.status(500).json({ error: "Erro ao buscar atendimentos NetRis", detail: err?.message ?? String(err) });
  }
});

export default router;
