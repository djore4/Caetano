// Camada Tipo (VD/VU) x Marca (BMW / BMW Motorrad) nos perfis: visibilidade, filtros, edição e utilizadores.
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./harness');

const J = JSON.stringify;
const inp = { pvb: 40000, opc: 0, bsi: 0, eco: 0, leg: 0, isv: 0, mgb: 0, esf: 0, pac: 0, dem: 0, sup: 0, pvp_desc: 50000, depreciacoes: 0 };
const car = (chassis, tipo, marca, local = ['Porto']) => ({ chassis, matricula: 'AA-11-BB', modelo: 'X1', versao: 'v', encomenda: 'E', estado_negocio: tipo, marca: [marca], local, tipologia: ['ICE'], inputs: inp });
const FROTA = [car('C1', 'VD', 'BMW'), car('C2', 'VU', 'BMW'), car('C3', 'VD', 'BMW Motorrad'), car('C4', 'VU', 'BMW Motorrad')];
const user = (perfil, negocio, marca, local = ['Todas']) => ({ id: 5, nome: 'U', email: 'u@x.pt', perfil, local, negocio, marca });
const ADMIN = user('Administrador', ['VD', 'VU'], ['BMW', 'BMW Motorrad']);

function fake(utilizadores, viaturas, vendidas = [], log = []) {
  const cadeia = (d) => ({ then: r => r({ data: d, error: null }), order() { return cadeia(d); }, limit() { return cadeia(d); }, eq() { return cadeia(d); } });
  return {
    from: t => ({
      select: () => cadeia(t === 'utilizadores' ? utilizadores : t === 'viaturas' ? viaturas : t === 'viaturas_vendidas' ? vendidas : []),
      insert: async p => { log.push(['insert', t, p]); return {}; }, upsert: async p => { log.push(['upsert', t, p]); return {}; },
      update: () => ({ eq: async () => ({}) }), delete: () => ({ eq: async () => ({}) }),
    }),
    auth: { signOut: async () => {} }, functions: { invoke: async (n, o) => { log.push(['invoke', n, o.body]); return { data: { ok: true } }; } },
  };
}
const ver = app => app.run('inventario.map(c => c.chassis)');

test('podeVerViatura: ver é só por marca; o tipo só limita a edição (podeEditarViatura)', () => {
  const app = carregarApp();
  const casos = [
    [user('Vendedor', ['VD'], ['BMW']), ['C1', 'C2'], ['C1']],
    [user('Vendedor', ['VU'], ['BMW']), ['C1', 'C2'], ['C2']],
    [user('Vendedor', ['VD'], ['BMW Motorrad']), ['C3', 'C4'], ['C3']],
    [user('Vendedor', ['VD', 'VU'], ['BMW']), ['C1', 'C2'], ['C1', 'C2']],
    [user('Vendedor', ['VD', 'VU'], ['BMW', 'BMW Motorrad']), ['C1', 'C2', 'C3', 'C4'], ['C1', 'C2', 'C3', 'C4']],
    [user('Chefe de Vendas', ['VU'], ['BMW Motorrad']), ['C3', 'C4'], ['C4']],
    [user('Vendedor', ['Todas'], ['Todas']), ['C1', 'C2', 'C3', 'C4'], ['C1', 'C2', 'C3', 'C4']],
    [user('Vendedor', [], ['BMW']), ['C1', 'C2'], []],
    [user('Vendedor', ['VD'], []), [], []],
    [user('Vendedor', null, null), [], []],
    [ADMIN, ['C1', 'C2', 'C3', 'C4'], ['C1', 'C2', 'C3', 'C4']],
    [user('Administrador', [], []), ['C1', 'C2', 'C3', 'C4'], ['C1', 'C2', 'C3', 'C4']],
  ];
  for (const [u, ver, editar] of casos) {
    app.run(`currentUser = ${J(u)}`);
    const msg = `${u.perfil} ${J(u.negocio)} ${J(u.marca)}`;
    assert.deepEqual(FROTA.filter(c => app.run(`podeVerViatura(${J(c)})`)).map(c => c.chassis), ver, msg);
    assert.deepEqual(FROTA.filter(c => app.run(`podeEditarViatura(${J(c)})`)).map(c => c.chassis), editar, msg + ' (editar)');
  }
});

test('viatura sem marca conta como BMW; sem tipo conta como VD', () => {
  const app = carregarApp();
  app.run(`currentUser = ${J(user('Vendedor', ['VD'], ['BMW']))}`);
  assert.ok(app.run(`podeVerViatura(${J({ chassis: 'X', marca: [], estado_negocio: null })})`));
  assert.ok(!app.run(`podeVerViatura(${J({ chassis: 'X', marca: ['BMW Motorrad'], estado_negocio: null })})`));
});

test('sessão: o Parque, a Gestão e o assistente só recebem as viaturas permitidas', async () => {
  const u = user('Chefe de Vendas', ['VD'], ['BMW']);
  const app = carregarApp({ supabaseClient: fake([u], FROTA) });
  await app.run("estabelecerSessao({ email: 'u@x.pt' })");
  assert.deepEqual(ver(app), ['C1', 'C2']);
  assert.equal(app.el('num-resultados').innerText, 2);
  assert.match(app.el('tabela-corpo').innerHTML, /C1|A000001|X1/);
  assert.equal((app.el('lista-admin-viaturas').innerHTML.match(/<tr /g) || []).length, 2);
  assert.match(app.el('lista-admin-viaturas').innerHTML, /Só leitura/);   // a VU (fora do tipo) só se vê
  assert.ok(!app.run('construirContextoParque()').includes('Motorrad'));
  assert.match(app.run('construirContextoParque()'), /Total: 2 viaturas/);
});

test('sessão: Administrador vê tudo; vendidas também filtradas', async () => {
  const vend = [{ id: 1, chassis: 'V1', estado_negocio: 'VD', marca: ['BMW'] }, { id: 2, chassis: 'V2', estado_negocio: 'VU', marca: ['BMW Motorrad'] }];
  let app = carregarApp({ supabaseClient: fake([ADMIN], FROTA, vend) });
  await app.run("estabelecerSessao({ email: 'u@x.pt' })");
  assert.equal(ver(app).length, 4);
  await app.run('carregarVendidas()');
  assert.equal(app.run('vendidasDb.length'), 2);

  const u = user('Chefe de Vendas', ['VD'], ['BMW']);
  app = carregarApp({ supabaseClient: fake([u], FROTA, vend) });
  await app.run("estabelecerSessao({ email: 'u@x.pt' })");
  await app.run('carregarVendidas()');
  assert.deepEqual(app.run('vendidasDb.map(v => v.chassis)'), ['V1']);
});

test('filtros: escondem as marcas sem permissão; o tipo VD/VU aparece sempre', () => {
  const app = carregarApp();
  const botao = t => ({ innerText: t, hidden: null, classList: { toggle(_, f) { this.f = f; } } });
  const mk = (id, ts) => { const c = app.el(id) || app.run(`document.getElementById('${id}')`); c.children = ts.map(botao); return c; };
  const g = [mk('filtro-negocio-container', ['Todos', 'VD', 'VU']), mk('filtro-marca-container', ['Todas', 'BMW', 'BMW Motorrad']), mk('filtro-admin-negocio-container', ['Todos', 'VD', 'VU']), mk('filtro-admin-marca-container', ['Todas', 'BMW', 'BMW Motorrad'])];
  app.run(`currentUser = ${J(user('Vendedor', ['VD'], ['BMW Motorrad']))}; atualizarFiltrosPermitidos()`);
  const estado = c => c.children.map(b => [b.innerText, b.classList.f]);
  assert.deepEqual(estado(g[0]), [['Todos', undefined], ['VD', undefined], ['VU', undefined]]);
  assert.deepEqual(estado(g[1]), [['Todas', undefined], ['BMW', true], ['BMW Motorrad', false]]);
  assert.deepEqual(estado(g[2]), estado(g[0])); assert.deepEqual(estado(g[3]), estado(g[1]));
});

test('Gestão: filtros Tipo e Marca', () => {
  const app = carregarApp();
  app.run(`inventario = ${J(FROTA)}; currentUser = ${J(ADMIN)}; carregarPrecosEmDireto();`);
  const n = () => (app.el('lista-admin-viaturas').innerHTML.match(/<tr /g) || []).length;
  app.run('renderizarListaAdmin()'); assert.equal(n(), 4);
  app.run("setFiltroAdmin('negocio','VU')"); assert.equal(n(), 2);
  app.run("setFiltroAdmin('marca','BMW Motorrad')"); assert.equal(n(), 1);
  app.run("setFiltroAdmin('negocio','Todos'); setFiltroAdmin('marca','Todas')"); assert.equal(n(), 4);
});

test('edição: sem permissão para o tipo/marca não grava; nova viatura começa num valor permitido', async () => {
  const log = [];
  const u = user('Chefe de Vendas', ['VD'], ['BMW Motorrad']);
  const app = carregarApp({ supabaseClient: fake([u], [], [], log) });
  app.run(`currentUser = ${J(u)}; inventario = [];`);
  app.run('prepararNovaViatura()');
  assert.equal(app.run('editCarroMarca'), 'BMW Motorrad');
  assert.equal(app.run('editCarroNegocio'), 'VD');
  // forçar valores sem permissão
  app.alertas.length = 0;
  app.run("editCarroMarca = 'BMW'");
  await app.run('guardarPrecos({ preventDefault() {} })');
  assert.match(app.alertas.join(' '), /permissão para este tipo de viatura \/ marca/);
  assert.equal(log.filter(l => l[0] === 'upsert').length, 0);
  // os botões de tipo/marca sem permissão não se ativam
  app.alertas.length = 0; app.run("setEditNegocio('VU')");
  assert.match(app.alertas.join(' '), /Acesso Negado/); assert.equal(app.run('editCarroNegocio'), 'VD');
  app.alertas.length = 0; app.run("setEditMarca('BMW')");
  assert.match(app.alertas.join(' '), /Acesso Negado/);
});

test('utilizadores: o perfil grava tipos e marcas escolhidos; exige seleção; Administrador fica com tudo', async () => {
  const log = [];
  const app = carregarApp({ supabaseClient: fake([ADMIN], [], [], log) });
  app.run(`currentUser = ${J(ADMIN)}; utilizadoresDb = [];`);
  const preencher = (perfil, neg, marca) => {
    app.run('prepararNovoUtilizador()');
    const E = id => app.run(`document.getElementById('${id}')`); E('user-nome').value = 'Nova Pessoa'; E('user-email').value = 'Nova@X.pt';
    app.run(`uPerf = ${J(perfil)}; uLoc = ['Porto']; ${neg.map(v => `toggleUserNegocio('${v}')`).join(';')}; ${marca.map(v => `toggleUserMarca('${v}')`).join(';')}`);
  };
  // sem tipo/marca: recusa
  preencher('Vendedor', [], ['BMW']);
  await app.run('guardarUtilizador({ preventDefault() {} })');
  assert.match(app.alertas.join(' '), /pelo menos um tipo/); assert.equal(log.filter(l => l[0] === 'invoke').length, 0);
  // seleção válida
  preencher('Vendedor', ['VU'], ['BMW', 'BMW Motorrad']);
  await app.run('guardarUtilizador({ preventDefault() {} })');
  const inv = log.find(l => l[0] === 'invoke');
  assert.equal(inv[1], 'sf-gestao-utilizadores');
  assert.deepEqual(JSON.parse(J(inv[2].negocio)), ['VU']); assert.deepEqual(JSON.parse(J(inv[2].marca)), ['BMW', 'BMW Motorrad']);
  assert.equal(inv[2].email, 'nova@x.pt');
  // administrador: sempre tudo
  log.length = 0; preencher('Administrador', ['VD'], ['BMW']);
  await app.run('guardarUtilizador({ preventDefault() {} })');
  const adm = log.find(l => l[0] === 'invoke');
  assert.deepEqual(JSON.parse(J(adm[2].negocio)), ['VD', 'VU']); assert.deepEqual(JSON.parse(J(adm[2].marca)), ['BMW', 'BMW Motorrad']);
});

test('utilizadores: editar carrega o perfil e ignora valores legados (ex.: VN)', () => {
  const app = carregarApp();
  app.run(`utilizadoresDb = ${J([{ id: 7, nome: 'L', email: 'l@x.pt', perfil: 'Vendedor', local: ['Gaia'], negocio: ['VN', 'VU'], marca: JSON.stringify(['BMW']) }])}`);
  app.run('editarUtilizador(7)');
  assert.deepEqual(JSON.parse(J(app.run('uNeg'))), ['VU']); assert.deepEqual(JSON.parse(J(app.run('uMarca'))), ['BMW']);
});
