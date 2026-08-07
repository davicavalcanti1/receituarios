# Roadmap — o que falta para o Receituários virar produto vendável

Levantado em 07/ago/2026, depois das fases 1-8 e da validação das migrations no
banco real. **Não é lista genérica de SaaS** — cada item abaixo saiu de algo
observado no código ou no banco durante o trabalho, com o ponto exato anotado.

Estado hoje: o módulo é um microserviço com repo, deploy, schema, migrations e
multi-tenant próprios. Falta o que está aqui.

---

## Antes de qualquer item: dívida imediata

Não é roadmap, é o que está aberto agora.

- [ ] **Fluxo de assinatura nunca foi exercitado.** Login e listagem dos 46 lotes
      passaram. PDF, convite, cadastro de médico e assinatura (upload + hash +
      `documentos`) não. É onde está o código mais novo e a RLS mais restrita.
- [ ] **Deploy do standalone está com build velho** — ainda lê
      `public.prescription_*`. Não quebrou porque aquelas tabelas continuam lá,
      mas hoje o deploy e o ambiente local **gravam em lugares diferentes**.
      Ninguém deve usar aquele endereço até redeployar.
- [ ] **`feat-schema-proprio` não mergeada** (11 commits).
- [ ] **Não redeployar a Imago** até o standalone estar validado: o merge já foi
      feito na main de lá, então o redeploy tira o módulo do ar.

---

## P0 — bloqueia vender para outra clínica

### 1. Onboarding de cliente novo está quebrado de ponta a ponta

`provisionar_tenant()` cria um convite `tipo = 'admin'`
(`20260807150000_multi_tenant.sql:342`), mas **não existe tela que consuma esse
convite**: a única rota pública de cadastro é `/cadastro/medico`, e ela recusa
qualquer coisa que não seja `tipo === 'medico'` (`CadastroMedico.tsx:155`).

Ou seja: hoje dá para criar a clínica no banco, mas **o admin dela não tem como
entrar**. O schema já prevê `'medico' | 'operador' | 'admin'` — falta a interface.

**O que fazer:** generalizar o cadastro por convite para os três tipos (uma rota
`/cadastro?token=…` que decide o formulário pelo `tipo` devolvido por
`validar_convite`, já que ela retorna isso). CRM/assinatura só no fluxo de médico.

### 2. Não há como adicionar staff

Mesmo dentro de uma clínica já ativa, um admin não consegue criar um operador.
O botão "Convidar médico" é o único que gera convite, e fixa `tipo: 'medico'`
(`ReceituariosPage.tsx:33`). Resolve junto com o item 1.

### 3. ~~Templates só por SQL~~ — FEITO em 07/ago

Tela `/templates` (só admin): identificação, medicações, setor, bloco de
assinatura, médico padrão e o filtro do NetRis. Com botão de **testar o filtro
contra os atendimentos de hoje**, para não configurar às cegas.

### 4. Marca da Imago fixa no produto

`imago-logo.png` aparece no PDF (`gerarPdf.ts`), no portal do médico, no
cadastro e na tela SemAcesso. Para white-label de verdade, logo e nome precisam
sair de `tenants` (ou de storage por tenant).

### 5. ~~Regra de negócio de um cliente dentro do código~~ — FEITO em 07/ago

`ehAnestesia()`, `ehEegIgorGondim()`, `SITUACOES_EXCLUIR`, o mapa de setor
(`"RESSON"→RESSONÂNCIA`) e os rótulos por tipo saíram do código. Tudo que vem do
NetRis é configurável por template: termos de exame, modalidades, médico, sala,
convênio e situações descartadas — mais as regras de derivação de setor.

---

## P1 — bloqueia operar bem

### 6. A assinatura do médico é legível por qualquer staff

A policy `medicos_select` permite `eh_staff()` ler a linha inteira, incluindo
`assinatura_png` (`20260807150000_multi_tenant.sql`). Ou seja: **qualquer
operador da clínica pode extrair a imagem da assinatura do médico** e aplicá-la
em qualquer documento.

Em receituário de controle especial isso é sério. Correção: tirar
`assinatura_png` do alcance do staff — coluna em tabela separada com policy só
do dono, ou view sem a coluna para quem não é o próprio médico.

### 7. Sem gestão de médicos

Não existe tela para listar, desativar, corrigir CRM ou reenviar convite. Médico
cadastrado errado hoje só se conserta por SQL. Os 2 médicos de teste migrados
como `ativo = false` também só voltariam por SQL.

### 8. Sem recuperação de senha

`Login.tsx` é e-mail + senha, sem "esqueci minha senha". Com Auth compartilhado
dá para contornar pela Imago; com Auth próprio (P2) vira bloqueio real.

### 9. Estados de lote sem interface

O schema aceita `draft`, `partially_signed` e `cancelled`, mas nenhuma tela
produz ou trata esses estados. Ou implementa (cancelar lote é o mais útil) ou
tira do CHECK para o modelo não mentir.

### 10. Sem paginação

`ReceituariosPage` busca `limit(100)`. Com 46 lotes ninguém sente; em um ano de
uso, sim — e o corte é silencioso.

---

## P2 — estrutural

### 11. Projeto Supabase próprio

O `auth.users` ainda é compartilhado com a Imago. Roteiro pronto em
[`MIGRAR-PROJETO.md`](MIGRAR-PROJETO.md). **Quanto antes, mais barato** — o
custo está nas contas de usuário, e hoje são 3.

### 12. Sem CI, lint ou testes

Nenhum dos dois repos tem. O mínimo útil: workflow de typecheck + build (o
`controleoperacional` tem um que serve de modelo, mas a lint dele está vermelha
há tempos — não copiar o hábito). Testes de `parseLote` seriam os de melhor
retorno: é lógica pura, cheia de casos de borda do NetRis, e um erro ali gera
receita errada.

### 13. Cobrança e planos

Nada existe. Só faz sentido depois do P0.

### 14. Assinatura sem valor jurídico forte

A "assinatura digital" é um PNG desenhado embutido no PDF. A Fase 6 acrescentou
hash SHA-256 do arquivo, o que dá **tamper-evidence**, mas não é ICP-Brasil nem
carimbo de tempo. Vale confirmar com a clínica o que a vigilância sanitária
exige para receituário de controle especial antes de vender para terceiros.

### 15. Aposentar as tabelas de origem

`public.prescription_*` seguem no banco da Imago como origem histórica. Quando o
standalone estiver validado e a Imago redeployada, elas ficam órfãs. Ver
[`../supabase/legado/README.md`](../supabase/legado/README.md).

---

## Sugestão de ordem

1. Fechar a dívida imediata (validar assinatura → mergear → redeployar).
2. P0 itens 1 e 2 juntos — cadastro por convite generalizado. Destrava o
   onboarding, que hoje é impossível.
3. P0 item 3 — editor de templates. Destrava a escala.
4. P1 item 6 — a assinatura exposta. É o único item com cara de incidente.
5. P2 item 11 — projeto próprio, enquanto ainda são 3 contas.

Os itens 4 e 5 do P0 (marca e regras hardcoded) só importam quando houver um
segundo cliente concreto; antes disso são trabalho especulativo.
