// GET /api/config — configuração pública do runtime.
//
// Existe porque as integrações são opcionais (Fase 5) e o front precisa saber
// quais estão ligadas para decidir o que renderizar. Ficar em RUNTIME, e não
// numa VITE_* de build time, é o ponto: ligar ou desligar o NetRis passa a ser
// mudar env var e reiniciar, sem rebuildar a imagem.
//
// Não exige auth e não devolve segredo nenhum — só flags booleanas.

import { Router } from "express";
import { netrisConfigurado } from "../lib/netris.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    integracoes: {
      netris: netrisConfigurado(),
    },
  });
});

export default router;
