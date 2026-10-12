// Menu de perfil: perfil de acesso, tema claro/escuro/automático e alteração de password.
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./harness');
const J = JSON.stringify;

const ADMIN = { id: 1, nome: 'Admin Um', email: 'admin@x.pt', perfil: 'Administrador', local: ['Todas'], negocio: ['VD'], marca: ['BMW'] };
const VEND = { id: 3, nome: 'Ana Maria Reis', email: 'ana@x.pt', perfil: 'Vendedor', local: ['Gaia'], negocio: ['VD'], marca: ['BMW'] };
const CHEFE = { id: 2, nome: 'Rui', email: 'rui@x.pt', perfil: 'Chefe de Vendas', local: ['Porto', 'Aveiro'], negocio: ['VU'], marca: ['BMW Motorrad'] };

function nova(u, opts) {
  const app = carregarApp(opts);
  app.run(`currentUser = ${J(u)}`);
  const E = id => app.run(`document.getElementById('${id}')`);
  const attrs = {};
  for (const id of ['btn-menu-perfil', 'btn-tema-claro', 'btn-tema-escuro', 'btn-tema-sistema']) { attrs[id] = {}; E(id).setAttribute = (k, v) => { attrs[id][k] = v; }; }
  return { app, E, attrs };
}
const acesso = app => app.el('menu-acesso').innerHTML;

test('perfil de acesso: Administrador vê tudo', () => {
  const { app } = nova(ADMIN);
  app.run('renderMenuPerfil()');
  const h = acesso(app);
  for (const v of ['Administrador', 'Porto', 'Gaia', 'Feira', 'Aveiro', 'VD', 'VU', 'BMW', 'BMW Motorrad']) assert.ok(h.includes(v), v);
});

test('perfil de acesso: só mostra o que o perfil inclui', () => {
  const { app } = nova(CHEFE);
  app.run('renderMenuPerfil()');
  const h = acesso(app);
  assert.ok(h.includes('Chefe de Vendas') && h.includes('Porto') && h.includes('Aveiro') && h.includes('VU') && h.includes('BMW Motorrad'));
  assert.ok(!h.includes('Gaia') && !h.includes('Feira') && !h.includes('VD'));
  assert.ok(!/>BMW</.test(h), 'não inclui a marca BMW (só Motorrad)');
});

test("perfil de acesso: 'Todas' e listas vazias", () => {
  let { app } = nova({ ...VEND, local: ['Todas'], negocio: ['Todas'], marca: ['Todas'] });
  app.run('renderMenuPerfil()');
  assert.ok(['Porto', 'Gaia', 'Feira', 'Aveiro', 'VD', 'VU', 'BMW Motorrad'].every(v => acesso(app).includes(v)));
  ({ app } = nova({ ...VEND, local: [], negocio: null, marca: [] }));
  app.run('renderMenuPerfil()');
  assert.ok(acesso(app).includes('Nenhuma') && acesso(app).includes('Nenhum'));
});

test('perfil de acesso: dados maliciosos não viram HTML', () => {
  const { app } = nova({ ...VEND, perfil: '<img src=x onerror=alert(1)>', nome: '<b>x</b>' });
  app.run('renderMenuPerfil()');
  assert.ok(!/<img/i.test(acesso(app)));
  assert.equal(app.el('menu-nome').innerText, '<b>x</b>');          // innerText: nunca interpretado como HTML
});

test('avatar: iniciais', () => {
  for (const [nome, ini] of [['Ana Maria Reis', 'AR'], ['Madonna', 'M'], ['  rui   costa ', 'RC'], ['', '?'], [null, '?']]) {
    const { app } = nova({ ...VEND, nome });
    app.run('renderMenuPerfil()');
    assert.equal(app.el('menu-avatar').innerText, ini, J(nome));
  }
});

test('password: só o Vendedor vê a nota (a regra de acesso é a de sempre)', () => {
  let { app } = nova(VEND); app.run('renderMenuPerfil()');
  assert.ok(!app.el('menu-pass-nota').classList.contains('hidden'));
  ({ app } = nova(CHEFE)); app.run('renderMenuPerfil()');
  assert.ok(app.el('menu-pass-nota').classList.contains('hidden'));
  // abrir o modal continua bloqueado ao Vendedor
  ({ app } = nova(VEND)); app.run('abrirMudarPassword()');
  assert.match(app.alertas.join(' '), /Solicite/);
});

test('abrir/fechar: botão, clique fora, Escape; clique dentro mantém aberto', () => {
  const { app, E, attrs } = nova(ADMIN);
  const menu = E('menu-perfil'); const wrap = E('menu-perfil-wrap'); const dentro = {}, fora = {};
  wrap.contains = n => n === dentro;
  menu.classList.add('hidden');
  app.run('toggleMenuPerfil({ stopPropagation() {} })');
  assert.ok(!menu.classList.contains('hidden')); assert.equal(attrs['btn-menu-perfil']['aria-expanded'], 'true');
  app.listeners.click.forEach(f => f({ target: dentro }));
  assert.ok(!menu.classList.contains('hidden'), 'clique dentro não fecha');
  app.listeners.click.forEach(f => f({ target: fora }));
  assert.ok(menu.classList.contains('hidden'), 'clique fora fecha'); assert.equal(attrs['btn-menu-perfil']['aria-expanded'], 'false');
  app.run('abrirMenuPerfil()'); assert.ok(!menu.classList.contains('hidden'));
  app.listeners.keydown.forEach(f => f({ key: 'Escape' }));
  assert.ok(menu.classList.contains('hidden'), 'Escape fecha');
  app.run('abrirMenuPerfil()'); app.run('toggleMenuPerfil()'); assert.ok(menu.classList.contains('hidden'), 'botão alterna');
});

test('terminar sessão / sem sessão fecha o menu', () => {
  const { app, E } = nova(ADMIN);
  app.run('abrirMenuPerfil()');
  app.run('currentUser = null; atualizarAcessos()');
  assert.ok(E('menu-perfil').classList.contains('hidden'));
});

test('tema: escolher escuro/claro aplica, grava e marca o botão ativo', () => {
  const { app, attrs } = nova(ADMIN);
  const raiz = app.run('document.documentElement');
  app.run("definirTema('escuro')");
  assert.ok(raiz.classList.contains('dark')); assert.equal(raiz.style.colorScheme, 'dark');
  assert.equal(app.armazem['sf-tema'], 'escuro');
  assert.equal(attrs['btn-tema-escuro']['aria-pressed'], 'true'); assert.equal(attrs['btn-tema-claro']['aria-pressed'], 'false');
  app.run("definirTema('claro')");
  assert.ok(!raiz.classList.contains('dark')); assert.equal(app.armazem['sf-tema'], 'claro'); assert.equal(raiz.style.colorScheme, 'light');
});

test('tema: automático segue o sistema e remove a preferência', () => {
  const { app } = nova(ADMIN, { sistemaEscuro: true, localStorage: { 'sf-tema': 'claro' } });
  const raiz = app.run('document.documentElement');
  assert.equal(app.run('temaGuardado()'), 'claro');
  app.run("definirTema('sistema')");
  assert.equal(app.armazem['sf-tema'], undefined); assert.ok(raiz.classList.contains('dark'));
  const claro = nova(ADMIN, { sistemaEscuro: false });
  claro.app.run("definirTema('sistema')"); assert.ok(!claro.app.run('document.documentElement').classList.contains('dark'));
});

test('tema: valor guardado inválido é ignorado; armazenamento indisponível não parte nada', () => {
  const { app } = nova(ADMIN, { localStorage: { 'sf-tema': 'rosa' } });
  assert.equal(app.run('temaGuardado()'), 'sistema');
  app.ctx.localStorage = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } };
  assert.equal(app.run('temaGuardado()'), 'sistema');
  app.run("definirTema('escuro')");                       // não rebenta e aplica na mesma
  assert.ok(app.run('document.documentElement').classList.contains('dark'));
});

test('abrir o menu mostra o tema atual no seletor', () => {
  const { app, attrs } = nova(ADMIN, { localStorage: { 'sf-tema': 'escuro' } });
  app.run('abrirMenuPerfil()');
  assert.equal(attrs['btn-tema-escuro']['aria-pressed'], 'true'); assert.equal(attrs['btn-tema-sistema']['aria-pressed'], 'false');
});
