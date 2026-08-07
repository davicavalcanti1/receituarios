-- ─────────────────────────────────────────────────────────────────────────────
-- "Situações" passa a ser lista do que ENTRA, não do que é descartado
--
-- `situacoes_excluir` obrigava a pensar ao contrário ("marque o que NÃO quero").
-- Agora existe `situacoes`: escolha as que entram; vazio = todas.
--
-- O campo antigo continua sendo respeitado quando `situacoes` está vazia, para
-- os filtros já configurados não mudarem de comportamento sozinhos.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE receituarios.templates
   SET filtro_netris = filtro_netris
                     || jsonb_build_object('situacoes', coalesce(filtro_netris -> 'situacoes', '[]'::jsonb));

NOTIFY pgrst, 'reload schema';
