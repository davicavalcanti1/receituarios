# Migrations legadas (schema da Imago) — NÃO aplicar

Estes 4 arquivos vieram junto no spinoff e descrevem o schema **antigo**, em
`public`, do tempo em que o módulo era parte do controleoperacional:

| Arquivo | Conteúdo |
|---|---|
| `20260526170000_receituarios_initial_structure.sql` | `prescription_*`, bucket `receituarios-pdfs`, RLS por tenant |
| `20260614000000_schema_manual_reconstruido.sql` | reconstrução inferida do que foi aplicado à mão no banco da Imago |
| `20260615000000_medico_rls_fix.sql` | policies para o médico assinar |
| `20260617000000_add_medico_role.sql` | role `medico` no enum `app_role` |

Eles saíram de `supabase/migrations/` na Fase 1 por dois motivos:

1. **Já estão aplicados** no banco da Imago, e por outro repositório
   (`controleoperacional`). Este repo nunca foi o dono deles.
2. Rodar `supabase db push` daqui tentaria reaplicá-los e **falharia** — eles
   dependem de `tenants`, `profiles`, `user_roles`, `role_permissions` e
   `get_user_tenant_id()`, que são do core da Imago e não existem neste projeto.

A partir da Fase 1 o módulo vive no schema `receituarios`. Estes arquivos ficam
só como documentação da origem — e como referência para o script de cópia dos
dados da Fase 2.

As tabelas `public.prescription_*` continuam de pé e **em uso pelo sistema da
Imago**, que ainda tem o módulo na `main`. Só depois da Fase 4 (merge da branch
`chore-spinoff-receituarios` no controleoperacional) é que elas podem ser
consideradas mortas.
