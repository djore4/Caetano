# Correção de segurança — plataforma de vendas (projeto Supabase `yifxgiwmibjaornighvt`)

## O problema
O `index.html` autenticava por comparação de passwords em JavaScript e falava com o
Supabase usando só a chave `anon` (pública, embutida no HTML). Com **RLS desligado**
nas tabelas `viaturas`, `utilizadores`, `historico`, `locais` e `precos_inputs`,
qualquer pessoa com o URL conseguia **ler e escrever toda a base de dados** a partir
da consola do browser — incluindo os emails e as **passwords em texto simples** de
todos os utilizadores. Como 3 desses emails têm também conta no CRM autenticado do
mesmo projeto, a reutilização de password permitia saltar para dados de clientes (NIF,
telefone, negócios).

## A correção
Mover a fronteira de confiança para o servidor:
1. **Autenticação real** via Supabase Auth (`signInWithPassword`) — feito no `index.html`.
2. **RLS** nas 5 tabelas: `anon` negado, `authenticated` permitido (`01_enable_rls.sql`).
3. **Remover** a coluna `password` em texto simples (`03_drop_password_column.sql`).

O modelo mantém o **login partilhado** atual; muda apenas onde a password é verificada.

## Ordem de deploy (sem downtime)

| # | Passo | Ficheiro | Notas |
|---|-------|----------|-------|
| 1 | Criar a conta de acesso partilhado | `02_seed_auth_from_legacy.sql` **ou** dashboard | Recomendado: dashboard (Authentication > Users > Add user, com *Auto Confirm*). O script reutiliza as passwords atuais para transição invisível, mas é frágil — testar com 1 email. |
| 2 | Publicar o `index.html` novo | (git) | Passa a usar `signInWithPassword`. Enquanto o RLS estiver desligado, tudo continua a funcionar. |
| 3 | Ativar RLS | `01_enable_rls.sql` | **Aqui o buraco fecha**: anon deixa de ver a base de dados. Sessões autenticadas continuam. |
| 4 | Confirmar app a funcionar (logado) | — | Testar login, parque, reservas, gestão VN, histórico. |
| 5 | Remover a coluna password | `03_drop_password_column.sql` | Só depois do passo 4. Irreversível. |

## Ronda 2 — RLS por perfil (`06_rls_por_perfil.sql`)
O `01_enable_rls.sql` fechou o acesso anónimo mas deixou **qualquer sessão autenticada** com
acesso total (incl. promover-se a Administrador em `utilizadores`, e contas do CRM/Trading Lab
do mesmo projeto). A migration `06` faz o servidor aplicar as mesmas regras que a interface já
aplica (Vendedor só lê; Chefe de Vendas gere viaturas/vendidas; Administrador gere tudo e lê o
histórico; quem não tem linha em `utilizadores` não vê nada). Não altera preços nem a lógica de
concessões (continua no cliente — Fase 2).

Ordem de deploy:
1. Correr o pré-requisito do cabeçalho do `06` (contas Auth sem perfil → ficam sem acesso).
2. Desligar o signup público em Authentication > Providers > Email ("Allow new users to sign up").
3. Publicar o `index.html` novo (conta sem perfil é recusada com mensagem clara).
4. Aplicar `06_rls_por_perfil.sql` (rollback: `06_rollback.sql`).
5. Fazer deploy das Edge Functions `sf-assistente` e `sf-gestao-utilizadores`
   (opcionais: secrets `ASSISTENTE_MAX_POR_HORA`, `ASSISTENTE_MAX_CONTEXTO`).
6. Testar, com um utilizador de cada perfil: login, parque, detalhe, reserva, edição, vendida/recuperar,
   histórico, criar utilizador, assistente.

Testes: `npm test` (preços/permissões/HTML vs. baseline + XSS + sessão) e `tests/rls/run.sh`.

## Ronda 3 — camada Tipo (VD/VU) x Marca (BMW / BMW Motorrad) nos perfis
Cada utilizador passa a ter, além da concessão, os **tipos** e as **marcas** a que acede (Utilizadores >
perfil). Quem não os tem **não vê nem gere** essas viaturas (Parque, Gestão, Vendidos, assistente);
o Administrador vê sempre tudo. O servidor aplica a mesma regra (`08`).

Ordem de deploy (importa — os perfis atuais têm valores antigos fixos em `negocio`/`marca`):
1. `07_perfis_tipo_marca.sql` — **primeiro**. Dá a todos os utilizadores existentes acesso completo
   (é o que veem hoje) e é inofensivo para a app antiga. Depois a Administração restringe por pessoa.
2. Publicar o `index.html` novo + deploy da Edge Function `sf-gestao-utilizadores`.
3. Restringir os perfis em Utilizadores e confirmar o que cada um vê.
4. `08_rls_tipo_marca.sql` — só depois (requer o `06`). Rollback: `08_rollback.sql`.

Testes do servidor: `tests/rls/run.sh` (107 verificações, inclui a camada tipo/marca e o backfill do 07).

## Ronda 4 — Stock VU (Gestão VU + Parque VU) — `09_stock_vu.sql`
O stock de usados é **uma só tabela**: `public.retomas` (a mesma do tab Stock do Baviera Vision Pro, no mesmo
projeto Supabase). A migration estende-a (versão, ano, chassis, concessão, proveniência, data de revisão do preço,
reserva) e dá acesso ao Caetano por funções `security definer`, **sem tocar nas políticas RLS da `retomas`**:

| Função | Quem | O quê |
|---|---|---|
| `sf_vu_parque()` | qualquer perfil (com VU + marca no perfil) | stock ativo **sem** proveniência, observações, link Maxterauto nem `created_by` |
| `sf_vu_gestao(arquivadas)` | Chefe de Vendas / Administrador | tudo |
| `sf_vu_guardar(json)` | Chefe de Vendas / Administrador | criar/editar (matrícula única no stock ativo; regista a data de revisão do preço) |
| `sf_vu_arquivar(id, bool)` | Chefe de Vendas / Administrador | vendida / recuperar (limpa a reserva) |
| `sf_vu_reservar(id, cancelar)` | Chefe de Vendas / Administrador | reserva de 48h **atómica** (duas pessoas não reservam a mesma) / cancelar |

É **autónoma**: não depende do 06 nem do 08 (define `sf_perfil` e `sf_pode_ver`, idênticas às desses ficheiros).
Em produção só estava aplicado o 01, e a app continua a funcionar sem a 09 — a Gestão VU mostra um aviso de
"Stock VU indisponível" em vez de partir.

Ordem de deploy:
1. Correr `09_stock_vu.sql` no Supabase (idempotente; rollback em `09_rollback.sql`).
2. Publicar o `index.html` (ou publicar primeiro: sem a 09 só aparece o aviso na Gestão VU).
3. Testar com um Chefe de Vendas (criar, reservar, vendida/recuperar) e um Vendedor (vê o stock, sem proveniência,
   sem botão de reservar).

Notas:
- **Limite conhecido:** quem também estiver em `app_users` do Baviera com acesso aos tabs stock/wip/vendedores lê
  a `retomas` diretamente (políticas do Baviera) e vê a proveniência. Resolver exige alterar o RLS do Baviera.
- As 3 viaturas VU antigas que estão em `viaturas` (criadas pela Gestão VD) **não** migram sozinhas: continuam no
  Parque como VD/VU legado até serem recriadas na Gestão VU e arquivadas na Gestão VD. A Gestão VD já não cria VU novas.
- Testes do servidor: `tests/rls/run.sh` (inclui 46 verificações da 09); da interface: `npm test` (`tests/vu.test.js`).

## Ainda em aberto (não incluído aqui)
- **Margens/custos** (`inputs`, `stats`) continuam visíveis no browser a todos os perfis que leem
  `viaturas`: separar em tabela/view com RLS próprio (altera o modelo de dados).
- **Restrição por concessão no servidor** para Chefe de Vendas (hoje só no cliente).
- **Operações atómicas** (venda, reposição, mudança de chassis) e **auditoria no servidor**.
- **Rotação das 6 passwords legacy** (podem já ter sido lidas). Incident-response manual.
- **Fase 2 — contas individuais**: substituir `utilizadores` pelo sistema `app_users`/
  `app_roles` já existente, e refinar as políticas RLS por perfil/local. Devolve
  sentido à auditoria (`historico` passa a distinguir pessoas).
- **Segundo projeto Supabase (specs/opcionais)**: fora do alcance deste conector.
  Verificar o RLS lá também.
- **Isolar o "AI Trading Lab"** (tabelas `cs_*`) noutro projeto, para reduzir o raio
  de dano da chave partilhada.
