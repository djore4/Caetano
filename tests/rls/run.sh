#!/usr/bin/env bash
# Uso: tests/rls/run.sh <ficheiro-de-migração.sql> [estado]   (estado: "antes" mostra o buraco do 01)
# Requer um Postgres acessível por PGHOST/PGPORT/PGUSER (ver tests/rls/README.md).
set -u
cd "$(dirname "$0")"
DB=${DB:-rlstest}; PSQL="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
MODO=${1:-../../security/06_rls_por_perfil.sql}
dropdb --if-exists $DB >/dev/null 2>&1; createdb $DB
$PSQL -f 00_shim.sql >/dev/null; $PSQL -f 01_dados.sql >/dev/null
$PSQL -f ../../security/01_enable_rls.sql >/dev/null          # estado atual de produção
[ "$MODO" != "antes" ] && $PSQL -f "$MODO" >/dev/null

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
    Administrador) v=2 vd=1 ut=3 hi=1 w=1 ;;
    Chefe)         v=2 vd=1 ut=1 hi=0 w=1 ;;
    Vendedor)      v=2 vd=0 ut=1 hi=0 w=0 ;;
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
echo "RLS: $PASS passaram, $FAIL falharam"; [ $FAIL = 0 ]
