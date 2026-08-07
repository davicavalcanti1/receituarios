-- ─────────────────────────────────────────────────────────────────────────────
-- Filtro do NetRis e médico padrão como CONFIGURAÇÃO do template
--
-- Hoje, para trocar o médico da "Anestesia Dr. Félix" ou mudar quais
-- atendimentos o NetRis traz, é preciso editar código e fazer deploy:
--   • ehAnestesia()      — procura "ANESTESIA" no exame ou modalidade id 3
--   • ehEegIgorGondim()  — procura literalmente "IGOR" + "GONDIM"/"CASTRO"
--   • SITUACOES_EXCLUIR  — [MARCADO, CANCELADO]
-- tudo em NovoLoteReceituario.tsx. Passa para cá.
--
-- Formato de `filtro_netris`:
--   {
--     "termos_exame":      ["ANESTESIA"],        -- casa no nome do procedimento
--     "modalidades":       [3],                  -- idModalidade do NetRis
--     "termos_medico":     ["IGOR GONDIM"],      -- casa no médico executor
--     "situacoes_excluir": [1, 5]                -- idSituacao descartados
--   }
--
-- Regra de aplicação:
--   (qualquer termo_exame OU qualquer modalidade)
--   E (qualquer termo_medico, se a lista não estiver vazia)
--   E situação fora de situacoes_excluir
--
-- Dentro de UM termo, palavras separadas por espaço precisam aparecer TODAS;
-- entre termos, basta um casar. É o que permite exprimir a regra do Dr. Igor
-- ("IGOR" e "GONDIM" no mesmo nome) sem expor regex na interface.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE receituarios.templates
  ADD COLUMN IF NOT EXISTS filtro_netris jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Sem FK para medicos de propósito, pelo mesmo motivo de lotes.medico_id:
  -- o template pode apontar para um médico que ainda não aceitou o convite.
  ADD COLUMN IF NOT EXISTS medico_padrao_id uuid;

-- Seed: reproduz EXATAMENTE o comportamento hardcoded de hoje.
UPDATE receituarios.templates
   SET filtro_netris = jsonb_build_object(
         'termos_exame',      jsonb_build_array('ANESTESIA'),
         'modalidades',       jsonb_build_array(3),
         'termos_medico',     '[]'::jsonb,
         'situacoes_excluir', jsonb_build_array(1, 5)
       )
 WHERE codigo = 'anestesia_dr_felix'
   AND filtro_netris = '{}'::jsonb;

-- "IGOR GONDIM" e "IGOR CASTRO" casam com "IGOR SILVEIRA DE CASTRO GONDIM"
-- porque as duas palavras de cada termo aparecem no nome.
UPDATE receituarios.templates
   SET filtro_netris = jsonb_build_object(
         'termos_exame',      jsonb_build_array('ELETROENCEFALOGRAMA', 'EEG'),
         'modalidades',       '[]'::jsonb,
         'termos_medico',     jsonb_build_array('IGOR GONDIM', 'IGOR CASTRO'),
         'situacoes_excluir', jsonb_build_array(1, 5)
       )
 WHERE codigo = 'longactil'
   AND filtro_netris = '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
