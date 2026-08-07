-- ─────────────────────────────────────────────────────────────────────────────
-- Tudo que vem do NetRis vira configuração + regras de setor saem do código
--
-- Sobrou hardcoded depois da migration anterior:
--   • derivarSetor() em gerarPdf.ts — mapeava "RESSON"→RESSONÂNCIA,
--     "TOMO"→TOMOGRAFIA, "MAMO", "DENSITO", "ULTRA"/"USG". Regra da Imago.
--   • o filtro só olhava exame, modalidade, médico e situação. O NetRis também
--     devolve sala e convênio, que não dava para usar.
--
-- `filtro_netris` passa a aceitar:
--   termos_exame, modalidades, termos_medico, termos_sala, termos_convenio,
--   situacoes_excluir
--
-- `setor_regras` é uma lista ordenada; vence a primeira que casar:
--   [{"termos": ["RESSON"], "setor": "RESSONÂNCIA"}, …]
-- Casa contra sala + procedimento, como fazia o código.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE receituarios.templates
  ADD COLUMN IF NOT EXISTS setor_regras jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Completa os filtros existentes com as chaves novas, sem perder o que já está.
UPDATE receituarios.templates
   SET filtro_netris = filtro_netris
                     || jsonb_build_object('termos_sala', '[]'::jsonb)
   WHERE NOT (filtro_netris ? 'termos_sala');

UPDATE receituarios.templates
   SET filtro_netris = filtro_netris
                     || jsonb_build_object('termos_convenio', '[]'::jsonb)
   WHERE NOT (filtro_netris ? 'termos_convenio');

-- Seed das regras de setor: exatamente o que derivarSetor() fazia, na mesma
-- ordem (a primeira que casar vence).
UPDATE receituarios.templates
   SET setor_regras = '[
         {"termos": ["RESSON"],          "setor": "RESSONÂNCIA"},
         {"termos": ["TOMO"],            "setor": "TOMOGRAFIA"},
         {"termos": ["MAMO"],            "setor": "MAMOGRAFIA"},
         {"termos": ["DENSITO"],         "setor": "DENSITOMETRIA"},
         {"termos": ["ULTRA"],           "setor": "ULTRASSONOGRAFIA"},
         {"termos": ["USG"],             "setor": "ULTRASSONOGRAFIA"}
       ]'::jsonb
 WHERE derivar_setor IS TRUE
   AND setor_regras = '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
