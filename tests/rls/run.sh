#!/usr/bin/env bash
# Uso: tests/rls/run.sh <ficheiro-de-migração.sql> [estado]   (estado: "antes" mostra o buraco do 01)
# Requer um Postgres acessível por PGHOST/PGPORT/PGUSER (ver tests/rls/README.md).
set -u
cd "$(dirname "$0")"
DB=${DB:-rlstest}; PSQL="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
MODO=${1:-completo}     # antes (só 01) | 06 | completo (01+06+08)
dropdb --if-exists $DB >/dev/null 2>&1; createdb $DB
$PSQL -f 00_shim.sql >/dev/null; $PSQL -f 01_dados.sql >/dev/null
$PSQL -f ../../security/01_enable_rls.sql >/dev/null          # estado atual de produção
[ "$MODO" != "antes" ] && $PSQL -f ../../security/06_rls_por_perfil.sql >/dev/null
[ "$MODO" = "completo" ] && $PSQL -f ../../security/08_rls_tipo_marca.sql >/dev/null

PASS=0; FAIL=0
# q <email|anon> "<sql que devolve 1 valor>" -> imprime o valor ("ERRO" se a query falhar)
q() {
  local who=$1 sql=$2 role=authenticated claims out
  if [ "$who" = anon ]; then role=anon; claims='{}'; else claims="{\"email\":\"$who\",\"sub\":\"00000000-0000-0000-0000-000000000001\"}"; fi
  out=$(psql -X -q -t -A -d $DB -v ON_ERROR_STOP=1 2>/dev/null <<SQL
begin; set local role $role;
select set_config('request.jwt.claims', '$claims', true) \\g /dev/null
$sql
rollback;
SQL
) || { echo ERRO; return; }
  echo "$out" | tr -d ' '
}
chk() { # chk "descrição" esperado obtido
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FALHA: $1 (esperado=$2 obtido='$3')"; fi
}
n() { echo "with x as ($1 returning 1) select count(*) from x;"; }   # nº de linhas afetadas
S() { echo "select count(*) from $1;"; }

for U in admin@x.pt chefe@x.pt vend@x.pt crm@x.pt anon; do
  case $U in
    admin@x.pt) P=Administrador;; chefe@x.pt) P=Chefe;; vend@x.pt) P=Vendedor;; *) P=$U;;
  esac
  case $P in
    Administrador) v=3 vd=1 ut=8 hi=1 w=1 ;;
    Chefe)         v=3 vd=1 ut=1 hi=0 w=1 ;;
    Vendedor)      v=3 vd=0 ut=1 hi=0 w=0 ;;
    *)             v=0 vd=0 ut=0 hi=0 w=0 ;;
  esac
  [ $U = anon ] && { v=ERRO; vd=ERRO; ut=ERRO; hi=ERRO; }
  chk "$P lê viaturas"            $v  "$(q $U "$(S public.viaturas)")"
  chk "$P lê viaturas_vendidas"   $vd "$(q $U "$(S public.viaturas_vendidas)")"
  chk "$P lê utilizadores"        $ut "$(q $U "$(S public.utilizadores)")"
  chk "$P lê historico"           $hi "$(q $U "$(S public.historico)")"
  # escritas (reserva = update; venda = insert vendidas + delete viaturas; reposição = upsert)
  r=$([ $w = 1 ] && echo 1 || echo 0); [ $U = anon ] && r=ERRO
  chk "$P reserva viatura (update)"  $r "$(q $U "$(n "update public.viaturas set reserva_user='t' where chassis='CH1'")")"
  chk "$P apaga viatura"             $r "$(q $U "$(n "delete from public.viaturas where chassis='CH2'")")"
  ins=$([ $w = 1 ] && echo 1 || echo ERRO)
  chk "$P insere viatura"            $ins "$(q $U "$(n "insert into public.viaturas(chassis,modelo) values ('NOVO','Z4')")")"
  chk "$P insere em vendidas"        $ins "$(q $U "$(n "insert into public.viaturas_vendidas(chassis,modelo) values ('V','Z4')")")"
  # upsert tal como o supabase-js (on conflict do update)
  chk "$P upsert viatura"            $ins "$(q $U "$(n "insert into public.viaturas(chassis,modelo) values ('CH1','X1b') on conflict (chassis) do update set modelo=excluded.modelo")")"
  # historico: todos os perfis com perfil inserem; ninguém edita/apaga
  hins=$([ "$P" = Administrador -o "$P" = Chefe -o "$P" = Vendedor ] && echo 1 || echo ERRO)
  chk "$P regista historico"         $hins "$(q $U "$(n "insert into public.historico(tabela,acao,registo_id) values ('viaturas','LOGIN','x')")")"
  chk "$P edita historico"           $([ $U = anon ] && echo ERRO || echo 0) "$(q $U "$(n "update public.historico set acao='X'")")"
  chk "$P apaga historico"           $([ $U = anon ] && echo ERRO || echo 0) "$(q $U "$(n "delete from public.historico")")"
  # utilizadores: só Administrador escreve (inclui a escalada de privilégios)
  ua=$([ $P = Administrador ] && echo 1 || echo 0); [ $U = anon ] && ua=ERRO
  chk "$P promove-se (update perfil)" $ua "$(q $U "$(n "update public.utilizadores set perfil='Administrador' where email='vend@x.pt'")")"
  chk "$P apaga utilizador"           $ua "$(q $U "$(n "delete from public.utilizadores where id=3")")"
  ui=$([ $P = Administrador ] && echo 1 || echo ERRO)
  chk "$P cria utilizador"            $ui "$(q $U "$(n "insert into public.utilizadores(id,nome,email,perfil) values (99,'n','n@x.pt','Vendedor')")")"
  # assistente_uso: ninguém exceto service_role
  chk "$P lê assistente_uso"          ERRO "$(q $U "$(S public.assistente_uso)")"
done
# a própria linha é sempre a do próprio (a app resolve o perfil por email)
chk "vendedor vê o seu perfil"  Vendedor "$(q vend@x.pt "select perfil from public.utilizadores where email='vend@x.pt';")"
chk "vendedor não vê o do admin" 0 "$(q vend@x.pt "select count(*) from public.utilizadores where email='admin@x.pt';")"
chk "email com maiúsculas"      Chefe\ de\ Vendas "$(q CHEFE@X.pt "select public.sf_perfil();" | sed 's/Chefede/Chefe de /')"

if [ "$MODO" = completo ]; then
  # --- camada tipo (VD/VU) x marca ---
  V="select count(*) from public.viaturas"
  chk "VD+BMW vê só a CH1"                 1     "$(q vd@x.pt "$V;")"
  chk "VD+BMW não vê VU nem Motorrad"      0     "$(q vd@x.pt "$V where chassis in ('CH2','CH3');")"
  chk "Chefe VU vê só a CH2"               1     "$(q vu@x.pt "$V;")"
  chk "Chefe VU edita a CH2"               1     "$(q vu@x.pt "$(n "update public.viaturas set reserva_user='t' where chassis='CH2'")")"
  chk "Chefe VU não edita a CH1 (VD)"      0     "$(q vu@x.pt "$(n "update public.viaturas set reserva_user='t' where chassis='CH1'")")"
  chk "Chefe VU não apaga a CH1 (VD)"      0     "$(q vu@x.pt "$(n "delete from public.viaturas where chassis='CH1'")")"
  chk "Chefe VU não cria VD"               ERRO  "$(q vu@x.pt "$(n "insert into public.viaturas(chassis,modelo,estado_negocio,marca) values ('N1','Z4','VD','[\"BMW\"]')")")"
  chk "Chefe VU cria VU Motorrad"          1     "$(q vu@x.pt "$(n "insert into public.viaturas(chassis,modelo,estado_negocio,marca) values ('N2','R','VU','[\"BMW Motorrad\"]')")")"
  chk "Chefe VU não move a CH2 para VD"    ERRO  "$(q vu@x.pt "$(n "update public.viaturas set estado_negocio='VD' where chassis='CH2'")")"
  chk "perfil sem tipo/marca não vê nada"  0     "$(q nulo@x.pt "$V;")"
  chk "'Todas' vê tudo"                    3     "$(q todas@x.pt "$V;")"
  chk "Administrador vê tudo"              3     "$(q admin@x.pt "$V;")"
  chk "Chefe VD vê a vendida VD"           1     "$(q chefevd@x.pt "select count(*) from public.viaturas_vendidas;")"
  chk "Chefe VU não vê a vendida VD"       0     "$(q vu@x.pt "select count(*) from public.viaturas_vendidas;")"
  chk "Chefe VD não arquiva viatura Motorrad" ERRO "$(q chefevd@x.pt "$(n "insert into public.viaturas_vendidas(chassis,estado_negocio,marca) values ('Z','VD','[\"BMW Motorrad\"]')")")"
  # tolerância de formatos: marca escalar, vazia ou nula; tipo nulo = VD
  chk "marca em texto escalar"             t     "$(q vd@x.pt "select public.sf_pode_ver('VD','\"BMW\"'::jsonb);")"
  chk "marca vazia conta como BMW"         t     "$(q vd@x.pt "select public.sf_pode_ver('VD','[]'::jsonb);")"
  chk "marca nula conta como BMW"          t     "$(q vd@x.pt "select public.sf_pode_ver(null, null);")"
  chk "VU recusado a quem só tem VD"       f     "$(q vd@x.pt "select public.sf_pode_ver('VU','[\"BMW\"]'::jsonb);")"
  chk "conta sem perfil nunca pode"        f     "$(q crm@x.pt "select public.sf_pode_ver('VD','[\"BMW\"]'::jsonb);")"
  chk "anon não executa a função"          ERRO  "$(q anon "select public.sf_pode_ver('VD','[]'::jsonb);")"
  # --- 09: stock VU (Gestão VU + Parque VU) sobre a retomas ---
  $PSQL -f ../../security/09_stock_vu.sql >/dev/null
  $PSQL -c "insert into public.retomas(id,marca,modelo,matricula,preco,proveniencia,observacoes,local,pvp_atualizado_em) values
    ('00000000-0000-0000-0000-0000000000a1','BMW','X1','AA-11-BB',20000,'LEILÃO','custo 15000','{Porto}','2026-01-01'),
    ('00000000-0000-0000-0000-0000000000a2','BMW Motorrad','R1300','CC-22-DD',15000,'RETOMA','nota interna','{Gaia}',now())" >/dev/null
  $PSQL -c "insert into public.retomas(id,marca,modelo,matricula,arquivada) values ('00000000-0000-0000-0000-0000000000a3','BMW','X3','EE-33-FF',true)" >/dev/null
  A1=00000000-0000-0000-0000-0000000000a1; A2=00000000-0000-0000-0000-0000000000a2; A3=00000000-0000-0000-0000-0000000000a3
  PQ="select count(*) from public.sf_vu_parque()"; GQ="select count(*) from public.sf_vu_gestao(false)"
  chk "09 vendedor vê o stock ativo no Parque"   2     "$(q vend@x.pt "$PQ;")"
  chk "09 arquivadas não vão para o Parque"      0     "$(q vend@x.pt "select count(*) from public.sf_vu_parque() where id='$A3';")"
  chk "09 só-VD não vê stock VU"                 0     "$(q vd@x.pt "$PQ;")"
  chk "09 perfil sem camada não vê stock VU"     0     "$(q nulo@x.pt "$PQ;")"
  chk "09 conta de outra app não vê nada"        0     "$(q crm@x.pt "$PQ;")"
  chk "09 anon não executa o Parque"             ERRO  "$(q anon "$PQ;")"
  chk "09 vendedor NÃO recebe proveniência"      f     "$(q vend@x.pt "select to_jsonb(p) ? 'proveniencia' from public.sf_vu_parque() p limit 1;")"
  chk "09 vendedor NÃO recebe observações"       f     "$(q vend@x.pt "select to_jsonb(p) ? 'observacoes' from public.sf_vu_parque() p limit 1;")"
  chk "09 vendedor NÃO recebe link Maxterauto"   f     "$(q vend@x.pt "select to_jsonb(p) ? 'link_maxterauto' from public.sf_vu_parque() p limit 1;")"
  chk "09 vendedor não lê a retomas diretamente" 0     "$(q vend@x.pt "select count(*) from public.retomas;")"
  chk "09 vendedor não lê a gestão"              0     "$(q vend@x.pt "$GQ;")"
  chk "09 chefe lê a gestão"                     2     "$(q chefe@x.pt "$GQ;")"
  chk "09 chefe vê a proveniência"               LEILÃO "$(q chefe@x.pt "select proveniencia from public.sf_vu_gestao(false) where id='$A1';")"
  chk "09 chefe lê as arquivadas"                1     "$(q chefe@x.pt "select count(*) from public.sf_vu_gestao(true);")"
  chk "09 chefe só-VD não gere VU"               0     "$(q chefevd@x.pt "$GQ;")"
  chk "09 admin lê a gestão"                     2     "$(q admin@x.pt "$GQ;")"
  # reserva: só Chefe de Vendas / Administrador, atómica
  chk "09 vendedor não reserva"                  ERRO  "$(q vend@x.pt "select public.sf_vu_reservar('$A1');")"
  chk "09 chefe reserva (48h)"                   t     "$(q chefe@x.pt "select (public.sf_vu_reservar('$A1')).reserva_expira > now() + interval '47 hours';")"
  chk "09 reserva guarda quem reservou"          Chefe "$(q chefe@x.pt "select (public.sf_vu_reservar('$A1')).reserva_user;")"
  chk "09 segunda reserva da mesma viatura falha" ERRO "$(q chefe@x.pt "select public.sf_vu_reservar('$A1'); select public.sf_vu_reservar('$A1');")"
  chk "09 reserva expirada pode ser refeita"     t     "$(q chefe@x.pt "update public.retomas set reserva_expira=now()-interval '1 hour' where id='$A1'; select (public.sf_vu_reservar('$A1')).reserva_expira > now();")"
  chk "09 reserva aparece ao vendedor"           Chefe "$(q chefe@x.pt "select public.sf_vu_reservar('$A1'); set local role authenticated; select reserva_user from public.sf_vu_parque() where id='$A1';" | tail -1)"
  chk "09 cancelar reserva limpa"                t     "$(q chefe@x.pt "select public.sf_vu_reservar('$A1'); select (public.sf_vu_reservar('$A1', true)).reserva_expira is null;" | tail -1)"
  chk "09 vendedor não cancela reserva"          ERRO  "$(q vend@x.pt "select public.sf_vu_reservar('$A1', true);")"
  chk "09 não reserva arquivada"                 ERRO  "$(q chefe@x.pt "select public.sf_vu_reservar('$A3');")"
  chk "09 só-VD não reserva stock VU"            ERRO  "$(q chefevd@x.pt "select public.sf_vu_reservar('$A1');")"
  # gravar
  NOVA='{"marca":"BMW","modelo":"X3","versao":"20d","matricula":"ZZ-99-ZZ","preco":"31000","proveniencia":"retoma","local":["Porto"],"ano":2022}'
  chk "09 vendedor não grava"                    ERRO  "$(q vend@x.pt "select public.sf_vu_guardar('$NOVA');")"
  chk "09 chefe cria viatura"                    31000.00 "$(q chefe@x.pt "select (public.sf_vu_guardar('$NOVA')).preco;")"
  chk "09 criar normaliza a proveniência"        RETOMA "$(q chefe@x.pt "select (public.sf_vu_guardar('$NOVA')).proveniencia;")"
  chk "09 criar regista o preço como revisto"    t     "$(q chefe@x.pt "select (public.sf_vu_guardar('$NOVA')).pvp_atualizado_em > now() - interval '1 minute';")"
  chk "09 matrícula repetida é recusada"         ERRO  "$(q chefe@x.pt "select public.sf_vu_guardar('{\"marca\":\"BMW\",\"modelo\":\"X1\",\"matricula\":\"aa 11 bb\"}');")"
  chk "09 editar a própria não conta como duplicada" X1b "$(q chefe@x.pt "select (public.sf_vu_guardar('{\"id\":\"$A1\",\"marca\":\"BMW\",\"modelo\":\"X1b\",\"matricula\":\"AA-11-BB\",\"preco\":20000}')).modelo;")"
  chk "09 mesmo preço mantém a data de revisão"  t     "$(q chefe@x.pt "select (public.sf_vu_guardar('{\"id\":\"$A1\",\"marca\":\"BMW\",\"modelo\":\"X1\",\"preco\":20000}')).pvp_atualizado_em = '2026-01-01';")"
  chk "09 novo preço atualiza a data de revisão" t     "$(q chefe@x.pt "select (public.sf_vu_guardar('{\"id\":\"$A1\",\"marca\":\"BMW\",\"modelo\":\"X1\",\"preco\":19000}')).pvp_atualizado_em > now() - interval '1 minute';")"
  chk "09 gravar não mexe na reserva"            Chefe "$(q chefe@x.pt "select public.sf_vu_reservar('$A1'); select (public.sf_vu_guardar('{\"id\":\"$A1\",\"marca\":\"BMW\",\"modelo\":\"X1\"}')).reserva_user;" | tail -1)"
  chk "09 marca fora do perfil é recusada"       ERRO  "$(q vu@x.pt "select public.sf_vu_guardar('{\"marca\":\"MINI\",\"modelo\":\"Cooper\"}');")"
  chk "09 chefe VU cria Motorrad"                R2    "$(q vu@x.pt "select (public.sf_vu_guardar('{\"marca\":\"BMW Motorrad\",\"modelo\":\"R2\"}')).modelo;")"
  chk "09 só-VD não grava VU"                    ERRO  "$(q chefevd@x.pt "select public.sf_vu_guardar('$NOVA');")"
  chk "09 modelo é obrigatório"                  ERRO  "$(q chefe@x.pt "select public.sf_vu_guardar('{\"marca\":\"BMW\"}');")"
  chk "09 proveniência inválida"                 ERRO  "$(q chefe@x.pt "select public.sf_vu_guardar('{\"marca\":\"BMW\",\"modelo\":\"X\",\"proveniencia\":\"OUTRA\"}');")"
  chk "09 preço negativo"                        ERRO  "$(q chefe@x.pt "select public.sf_vu_guardar('{\"marca\":\"BMW\",\"modelo\":\"X\",\"preco\":-1}');")"
  chk "09 motorização inválida"                  ERRO  "$(q chefe@x.pt "select public.sf_vu_guardar('{\"marca\":\"BMW\",\"modelo\":\"X\",\"motorizacao\":\"diesel\"}');")"
  # vendida / recuperar
  chk "09 vendedor não arquiva"                  ERRO  "$(q vend@x.pt "select public.sf_vu_arquivar('$A1');")"
  chk "09 chefe arquiva e sai do Parque"         1     "$(q chefe@x.pt "select public.sf_vu_arquivar('$A1'); select count(*) from public.sf_vu_parque();" | tail -1)"
  chk "09 arquivar limpa a reserva"              t     "$(q chefe@x.pt "select public.sf_vu_reservar('$A1'); select (public.sf_vu_arquivar('$A1')).reserva_expira is null;" | tail -1)"
  chk "09 recuperar volta ao Parque"             3     "$(q chefe@x.pt "select public.sf_vu_arquivar('$A3', false); select count(*) from public.sf_vu_parque();" | tail -1)"
  # --- 10: ver é por marca; o tipo só limita a escrita ---
  $PSQL -f ../../security/10_ver_todos_os_tipos.sql >/dev/null
  chk "10 Chefe VU passa a ver a VD (CH1)"       1     "$(q vu@x.pt "$V where chassis='CH1';")"
  chk "10 Chefe VU vê VD e VU (BMW+Motorrad)"    3     "$(q vu@x.pt "$V;")"
  chk "10 Chefe VU continua sem editar a CH1"    0     "$(q vu@x.pt "$(n "update public.viaturas set reserva_user='t' where chassis='CH1'")")"
  chk "10 Chefe VU continua sem apagar a CH1"    0     "$(q vu@x.pt "$(n "delete from public.viaturas where chassis='CH1'")")"
  chk "10 Chefe VU continua a editar a CH2"      1     "$(q vu@x.pt "$(n "update public.viaturas set reserva_user='t' where chassis='CH2'")")"
  chk "10 Chefe VU continua sem criar VD"        ERRO  "$(q vu@x.pt "$(n "insert into public.viaturas(chassis,modelo,estado_negocio,marca) values ('N9','Z4','VD','[\"BMW\"]')")")"
  chk "10 só-VD BMW vê VD e VU da BMW, não Motorrad" 2 "$(q vd@x.pt "$V;")"
  chk "10 marca continua a limitar a leitura"    0     "$(q vd@x.pt "$V where chassis='CH3';")"
  chk "10 só-VD vê o stock VU da sua marca"      1     "$(q vd@x.pt "select count(*) from public.sf_vu_parque() where marca='BMW';")"
  chk "10 só-VD continua sem gerir VU"           0     "$(q chefevd@x.pt "$GQ;")"
  chk "10 chefe só-VD vê a vendida (leitura)"    1     "$(q chefevd@x.pt "select count(*) from public.viaturas_vendidas;")"
  chk "10 chefe VU vê a vendida VD (leitura)"    1     "$(q vu@x.pt "select count(*) from public.viaturas_vendidas;")"
  chk "10 chefe VU não grava vendida VD"         ERRO  "$(q vu@x.pt "$(n "insert into public.viaturas_vendidas(chassis,estado_negocio,marca) values ('Y','VD','[\"BMW\"]')")")"
  chk "10 vendedor continua sem ler vendidas"    0     "$(q vend@x.pt "select count(*) from public.viaturas_vendidas;")"
  chk "10 sem perfil continua sem ver nada"      0     "$(q crm@x.pt "$V;")"
  # 07: backfill dá acesso completo aos utilizadores existentes (inclui legado ['VN'])
  $PSQL -c "update public.utilizadores set negocio='[\"VN\"]', marca='[\"BMW\"]' where email='vend@x.pt'" >/dev/null
  $PSQL -f ../../security/07_perfis_tipo_marca.sql >/dev/null
  chk "07 dá acesso completo ao legado"    "[\"VD\",\"VU\"]|[\"BMW\",\"BMWMotorrad\"]" "$(psql -X -q -t -A -d $DB -c "select negocio::text||'|'||marca::text from public.utilizadores where email='vend@x.pt'" | tr -d ' ')"
  chk "07 não deixa ninguém sem camada"    0     "$(psql -X -q -t -A -d $DB -c "select count(*) from public.utilizadores where negocio is null or marca is null" | tr -d ' ')"
  # rollback do 10 volta ao 08; depois o do 08 ao comportamento do 06 (vendedor VD+BMW volta a ver tudo)
  $PSQL -f ../../security/10_rollback.sql >/dev/null
  $PSQL -f ../../security/08_rollback.sql >/dev/null
  chk "rollback 08: sem camada, vê tudo"   3     "$(q vd@x.pt "$V;")"
fi
echo "RLS: $PASS passaram, $FAIL falharam"; [ $FAIL = 0 ]
