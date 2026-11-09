const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./harness');

// cliente Supabase falso: devolve as linhas que o RLS devolveria a esta sessão
function clienteFalso(utilizadores, estado) {
  const q = (tabela) => ({
    select: () => ({ then: r => r({ data: tabela === 'utilizadores' ? utilizadores : [], error: null }), order: () => ({ limit: () => ({ then: r => r({ data: [] }) }) }) }),
    insert: async () => ({}),
  });
  return { from: q, auth: { signOut: async () => { estado.saiu = true; }, getSession: async () => ({ data: { session: null } }) }, functions: { invoke: async () => ({}) } };
}

test('conta com perfil: entra com o perfil da tabela', async () => {
  const estado = {};
  const app = carregarApp({ supabaseClient: clienteFalso([{ id: 3, nome: 'V', email: 'vend@x.pt', perfil: 'Vendedor', local: ['Gaia'] }], estado) });
  await app.run("estabelecerSessao({ email: 'VEND@x.pt' })");
  assert.equal(app.run('currentUser && currentUser.perfil'), 'Vendedor');
  assert.ok(!estado.saiu);
});

test('conta sem perfil (ex.: CRM): sessão terminada e sem acesso', async () => {
  const estado = {};
  const app = carregarApp({ supabaseClient: clienteFalso([], estado) });
  await app.run("estabelecerSessao({ email: 'crm@x.pt' })");
  assert.equal(app.run('currentUser'), null);
  assert.ok(estado.saiu, 'devia terminar a sessão');
  assert.match(app.alertas.join('\n'), /Acesso Negado/);
});

// ── Perfil "Inserção" (permissão 'demos:inserir-viaturas' da plataforma Baviera) ──
function clienteComRpc(rpcData, estado) {
  const c = clienteFalso([], estado);
  c.rpc = async (nome) => { (estado.rpcs ||= []).push(nome); return nome === 'sf_perfil_insercao' ? { data: rpcData, error: rpcData === 'erro' ? { message: 'x' } : null } : { data: [], error: null }; };
  return c;
}

test('sem linha em utilizadores mas com o perfil de Inserção: entra só com a gestão VD', async () => {
  const estado = {};
  const app = carregarApp({ supabaseClient: clienteComRpc({ id: 'u1', nome: 'Carolina', email: 'carolina.soares@caetano.pt', local: ['Feira'], negocio: ['VD'], marca: ['BMW'] }, estado) });
  await app.run("estabelecerSessao({ email: 'carolina.soares@caetano.pt' })");
  assert.equal(app.run('currentUser && currentUser.perfil'), 'Inserção');
  assert.ok(!estado.saiu);
  assert.ok(!(estado.rpcs || []).some(n => n.startsWith('sf_vu')), 'não carrega o stock VU');
  assert.equal(app.run("hasPerm('local', 'Feira')"), true);
  assert.equal(app.run("hasPerm('local', 'Aveiro')"), false);
  app.alertas.length = 0;
  app.run("mudarTab('historico')");
  assert.match(app.alertas.join('\n'), /Acesso Restrito/);
});

test('Inserção não arquiva viaturas', async () => {
  const estado = {};
  const app = carregarApp({ supabaseClient: clienteComRpc({ id: 'u1', nome: 'C', email: 'c@x.pt', local: ['Feira'], negocio: ['VD'], marca: ['BMW'] }, estado) });
  await app.run("estabelecerSessao({ email: 'c@x.pt' })");
  app.alertas.length = 0;
  await app.run("arquivarViatura('ABC')");
  assert.match(app.alertas.join('\n'), /só introduz e corrige/);
});

test('sem linha e sem perfil de Inserção (RPC nula ou com erro): continua sem acesso', async () => {
  for (const rpcData of [null, 'erro']) {
    const estado = {};
    const app = carregarApp({ supabaseClient: clienteComRpc(rpcData, estado) });
    await app.run("estabelecerSessao({ email: 'crm@x.pt' })");
    assert.equal(app.run('currentUser'), null);
    assert.ok(estado.saiu);
  }
});
