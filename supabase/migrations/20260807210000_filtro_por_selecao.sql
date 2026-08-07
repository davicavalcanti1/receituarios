-- ─────────────────────────────────────────────────────────────────────────────
-- Filtro do NetRis por SELEÇÃO, não por texto digitado
--
-- Os campos `termos_*` exigiam digitar e acertar a grafia — se alguém escrevesse
-- "ANASTESIA" o filtro silenciosamente não traria ninguém. Passam a existir
-- listas de valores ESCOLHIDOS a partir do que o NetRis devolve de verdade.
--
-- Chaves novas em filtro_netris (casamento EXATO, normalizado):
--   "exames":    ["ANESTESIA RM", "ANESTESIA TC"]   -- nomeProcedimento
--   "medicos":   ["1234"]                            -- idMedicoExecutor
--   "salas":     ["RESSONANCIA 1"]                   -- nomeSala
--   "convenios": ["UNIMED"]                          -- nomeConvenio
--
-- Os `termos_*` continuam sendo respeitados pelo motor como LEGADO, para os
-- filtros já configurados não pararem de funcionar de um dia para o outro. A
-- interface mostra o que restou de legado e permite limpar depois de reconfigurar
-- por seleção.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE receituarios.templates
   SET filtro_netris = filtro_netris
                     || jsonb_build_object(
                          'exames',    coalesce(filtro_netris -> 'exames',    '[]'::jsonb),
                          'medicos',   coalesce(filtro_netris -> 'medicos',   '[]'::jsonb),
                          'salas',     coalesce(filtro_netris -> 'salas',     '[]'::jsonb),
                          'convenios', coalesce(filtro_netris -> 'convenios', '[]'::jsonb)
                        );

NOTIFY pgrst, 'reload schema';
