// Harness de testes: carrega o <script> principal do index.html num contexto
// Node com um DOM falso, para testar lógica pura e HTML gerado sem browser.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function extrairScript(html) {
  const marca = html.indexOf('// ── CONFIGURAÇÃO GLOBAL');
  if (marca < 0) throw new Error('Script principal não encontrado');
  const ini = html.lastIndexOf('<script>', marca) + '<script>'.length;
  const fim = html.indexOf('</script>', marca);
  return html.slice(ini, fim);
}

function criarElemento() {
  const classes = new Set();
  const el = {
    innerHTML: '', innerText: '', textContent: '', value: '', checked: false, className: '', id: '', href: '',
    style: {}, children: [], dataset: {},
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : f; on ? classes.add(c) : classes.delete(c); return on; },
      contains: c => classes.has(c),
      replace: () => {},
    },
    appendChild() {}, focus() {}, scrollIntoView() {}, remove() {}, setAttribute() {},
    getBoundingClientRect: () => ({ top: 0 }),
    querySelector: () => criarElemento(), querySelectorAll: () => [],
    offsetParent: {},
  };
  return el;
}

function carregarApp(opts = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const elementos = {};
  const document = {
    getElementById: id => (elementos[id] ||= Object.assign(criarElemento(), { id })),
    createElement: () => criarElemento(),
    querySelectorAll: () => [],
    body: criarElemento(),
  };
  const alertas = [];
  const sandbox = {
    document, console, Date, Math, JSON, parseInt, parseFloat, isNaN, Number, String, Array, Object, Set, RegExp, Promise,
    setTimeout: () => 0,
    alert: m => alertas.push(m), confirm: () => true,
    window: {
      innerWidth: 1280, innerHeight: 800, addEventListener() {},
      supabase: { createClient: () => opts.supabaseClient || null },
    },
    navigator: {},
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(extrairScript(html), ctx, { filename: 'index.html' });
  return {
    ctx, elementos, alertas,
    run: codigo => vm.runInContext(codigo, ctx),
    el: id => elementos[id],
  };
}

module.exports = { carregarApp, extrairScript };
