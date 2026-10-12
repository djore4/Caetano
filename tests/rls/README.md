# Testes de RLS

Emulam o Supabase num Postgres puro (roles `anon`/`authenticated`, `auth.jwt()`, esquema mínimo)
e verificam, perfil a perfil, o que cada operação da app consegue fazer.

    export PGHOST=/tmp PGPORT=54329 PGUSER=<superuser>     # qualquer Postgres 14+ local
    tests/rls/run.sh            # aplica security/06 e corre 83 verificações
    tests/rls/run.sh antes      # estado atual (só 01): mostra o buraco (esperam-se falhas)

Não ligam ao Supabase de produção. Antes de aplicar a migration em produção, correr também
o pré-requisito indicado no cabeçalho de `security/06_rls_por_perfil.sql`.
