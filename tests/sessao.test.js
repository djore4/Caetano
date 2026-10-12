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
