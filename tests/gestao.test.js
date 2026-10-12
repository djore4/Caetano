// Gestão VD reformulada: lista + janela de edição + arquivar.
// Garante que a mecânica de preços e as regras de acesso são as de sempre.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { carregarApp } = require('./harness');
const { FIXTURE_VIATURAS, FIXTURE_UTILIZADORES } = require('./snapshot');

const ADMIN = FIXTURE_UTILIZADORES[0], CHEFE = FIXTURE_UTILIZADORES[1], VEND = FIXTURE_UTILIZADORES[2];

// cliente Supabase falso que regista as escritas
function fake(log) {
  const ok = Promise.resolve({ data: [], error: null });
  const cadeia = { then: r => r({ data: [], error: null }), order() { return cadeia; }, limit() { return cadeia; }, eq() { return cadeia; } };
  return {
    from: t => ({
      insert: p => { log.push(['insert', t, p]); return ok; },
      upsert: p => { log.push(['upsert', t, p]); return ok; },
      update: p => ({ eq: (c, v) => { log.push(['update', t, p, c, v]); return ok; } }),
      delete: () => ({ eq: (c, v) => { log.push(['delete', t, c, v]); return ok; } }),
      select: () => cadeia,
    }),
    auth: {}, functions: { invoke: async () => ({}) },
  };
}
function nova(user, log = []) {
  const app = carregarApp({ supabaseClient: fake(log) });
  const J = JSON.stringify;
  app.run(`inventario = ${J(FIXTURE_VIATURAS)}; currentUser = ${J(user)}; carregarPrecosEmDireto();`);
  return { app, log, J };
}
const chamadas = codigo => { const c = []; vm.runInNewContext(`with(p){${codigo}}`, { p: new Proxy({}, { has: () => true, get: (_, n) => n === Symbol.unscopables ? undefined : (...a) => c.push([n, ...a]) }) }); return c; };
const onclicks = html => [...html.matchAll(/onclick="([^"]*)"/g)].map(m => m[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
const linhas = html => (html.match(/<tr /g) || []).length;

test('lista: Administrador vê todas; Chefe só a sua concessão; filtro e pesquisa', () => {
  let { app } = nova(ADMIN);
  app.run('renderizarListaAdmin()');
  assert.equal(linhas(app.el('lista-admin-viaturas').innerHTML), 4);
  assert.equal(app.el('admin-num-resultados').innerText, 4);
  app.run("setFiltroLocalAdmin('Gaia')");
  assert.equal(linhas(app.el('lista-admin-viaturas').innerHTML), 1);
  app.run("setFiltroLocalAdmin('Todas')"); app.el('admin-pesquisa').value = 'ix';
  app.run('renderizarListaAdmin()');
  assert.equal(linhas(app.el('lista-admin-viaturas').innerHTML), 1);
  app.el('admin-pesquisa').value = 'cc-22-dd';          // pesquisa por matrícula formatada
  app.run('renderizarListaAdmin()');
  assert.equal(linhas(app.el('lista-admin-viaturas').innerHTML), 1);

  ({ app } = nova(CHEFE));
  app.run('renderizarListaAdmin()');
  assert.equal(linhas(app.el('lista-admin-viaturas').innerHTML), 1, 'Chefe do Porto só vê o X1 do Porto');
  app.run("setFiltroLocalAdmin('Gaia')");
  assert.match(app.el('lista-admin-viaturas').innerHTML, /Nenhuma viatura/);
});

test('lista: cada linha tem Editar e Vendida com o chassis certo', () => {
  const { app } = nova(ADMIN);
  app.run('renderizarListaAdmin()');
  const html = app.el('lista-admin-viaturas').innerHTML;
  const cs = onclicks(html).flatMap(chamadas);
  const edit = cs.filter(c => c[0] === 'abrirEdicaoModal').map(c => c[1]);
  const arq = cs.filter(c => c[0] === 'arquivarViatura').map(c => c[1]);
  assert.deepEqual(edit, FIXTURE_VIATURAS.map(v => v.chassis));
  assert.deepEqual(arq, FIXTURE_VIATURAS.map(v => v.chassis));
});

test('lista: margem e PVP mostrados são os do cálculo existente', () => {
  const { app } = nova(ADMIN);
  app.run('renderizarListaAdmin()');
  const html = app.el('lista-admin-viaturas').innerHTML;
  const s = app.run('calcularPrecosTempoReal(inventario[0])');
  assert.ok(html.includes(app.run(`formatarEuros(${s.mg})`)));
  assert.ok(html.includes(app.run(`formatarEuros(${s.pvp_final})`)));
});

test('editar: a janela abre com os mesmos valores e a mesma prévia de preços de sempre', () => {
  const { app } = nova(ADMIN);
  app.run("abrirEdicaoModal('WBA1111111A000001')");
  assert.ok(!app.el('modal-edicao').classList.contains('hidden'));
  assert.equal(app.el('edit-original-chassis').value, 'WBA1111111A000001');
  assert.equal(app.el('edit-pvb').value, app.run('numeroParaStr(40000)'));
  const s = app.run('calcularPrecosTempoReal(inventario[0])');
  assert.equal(app.el('auto-mg').value, app.run(`formatarEuros(${s.mg})`));
  assert.equal(app.el('auto-preco-min').value, app.run(`formatarEuros(${s.preco_minimo})`));
  assert.equal(app.el('auto-pvp-bruto').value, app.run(`formatarEuros(${s.pvp_bruto})`));
  assert.equal(app.run("document.getElementById('admin-titulo-carro').innerText"), 'X1 sDrive18d');
});

test('editar + gravar: o que vai para a BD é o cálculo existente (inputs e stats)', async () => {
  const { app, log } = nova(ADMIN);
  app.run("abrirEdicaoModal('WBA1111111A000001')");
  app.el('edit-pvp_desc').value = '53.000,00';
  app.run('recalcularPreview()');
  await app.run('guardarPrecos({ preventDefault() {} })');
  const up = log.find(l => l[0] === 'upsert' && l[1] === 'viaturas');
  assert.ok(up, 'devia gravar em viaturas');
  const c = up[2];
  assert.equal(c.inputs.pvp_desc, 53000);
  assert.equal(c.inputs.pvb, 40000);
  assert.deepEqual(JSON.parse(JSON.stringify(c.stats)), JSON.parse(JSON.stringify(app.run('calcularPrecosTempoReal({ inputs: ' + JSON.stringify(c.inputs) + ', data_matricula: "2026-07-01" })'))));
});

test('fechar: pede confirmação só se houver alterações; Escape fecha', () => {
  const { app } = nova(ADMIN);
  app.run("abrirEdicaoModal('WBA1111111A000001')");
  let pediu = 0; app.ctx.confirm = () => { pediu++; return false; };
  app.run('fecharEdicaoModal()');                       // sem alterações: fecha sem perguntar
  assert.equal(pediu, 0); assert.ok(app.el('modal-edicao').classList.contains('hidden'));
  app.run("abrirEdicaoModal('WBA1111111A000001')");
  app.run("toggleEditTipologia('BEV')");                // alteração
  app.run('fecharEdicaoModal()');                       // pergunta; "cancelar" mantém aberta
  assert.equal(pediu, 1); assert.ok(!app.el('modal-edicao').classList.contains('hidden'));
  app.ctx.confirm = () => true;
  app.listeners.keydown.forEach(f => f({ key: 'Escape' }));
  assert.ok(app.el('modal-edicao').classList.contains('hidden'));
});

test('nova viatura: abre janela limpa', () => {
  const { app } = nova(ADMIN);
  app.run('abrirNovaViatura()');
  assert.ok(!app.el('modal-edicao').classList.contains('hidden'));
  assert.equal(app.el('edit-original-chassis').value, '');
  assert.equal(app.run("document.getElementById('admin-titulo-carro').innerText"), 'Nova viatura');
});

test('vendida (arquivar) a partir da lista: arquiva com o preço cristalizado e remove do parque', async () => {
  const { app, log } = nova(CHEFE);
  const pvp = app.run('calcularPrecosTempoReal(inventario[0]).pvp_final');
  await app.run("arquivarViatura('WBA1111111A000001')");
  const ins = log.find(l => l[0] === 'insert' && l[1] === 'viaturas_vendidas');
  assert.ok(ins); assert.equal(ins[2].chassis, 'WBA1111111A000001'); assert.equal(ins[2].preco_final, pvp); assert.equal(ins[2].vendido_por, CHEFE.nome);
  assert.ok(log.some(l => l[0] === 'delete' && l[1] === 'viaturas' && l[3] === 'WBA1111111A000001'));
  assert.ok(!app.run("inventario.some(c => c.chassis === 'WBA1111111A000001')"));
  assert.ok(log.some(l => l[0] === 'insert' && l[1] === 'historico' && l[2].acao === 'VENDIDA'));
  // ordem: arquiva ANTES de apagar (nunca se perde a viatura)
  assert.ok(log.findIndex(l => l[1] === 'viaturas_vendidas') < log.findIndex(l => l[0] === 'delete'));
});

test('vendida: cancelar na confirmação não altera nada', async () => {
  const { app, log } = nova(CHEFE);
  app.ctx.confirm = () => false;
  await app.run("arquivarViatura('WBA1111111A000001')");
  assert.equal(log.filter(l => l[0] !== 'select').length, 0);
  assert.ok(app.run("inventario.some(c => c.chassis === 'WBA1111111A000001')"));
});

test('vendida pela janela de edição continua a funcionar e fecha a janela', async () => {
  const { app, log } = nova(ADMIN);
  app.run("abrirEdicaoModal('WBA1111111A000001')");
  await app.run('removerViatura()');
  assert.ok(log.some(l => l[0] === 'insert' && l[1] === 'viaturas_vendidas'));
  assert.ok(app.el('modal-edicao').classList.contains('hidden'));
});
