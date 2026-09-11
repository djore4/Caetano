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

## Ainda em aberto (não incluído aqui)
- **Rotação das 6 passwords legacy** (podem já ter sido lidas). Incident-response manual.
- **Fase 2 — contas individuais**: substituir `utilizadores` pelo sistema `app_users`/
  `app_roles` já existente, e refinar as políticas RLS por perfil/local. Devolve
  sentido à auditoria (`historico` passa a distinguir pessoas).
- **Segundo projeto Supabase (specs/opcionais)**: fora do alcance deste conector.
  Verificar o RLS lá também.
- **Isolar o "AI Trading Lab"** (tabelas `cs_*`) noutro projeto, para reduzir o raio
  de dano da chave partilhada.
