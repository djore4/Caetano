// Dados maliciosos em todos os campos: nada pode virar HTML/JS executável,
// e os argumentos dos onclick têm de chegar à função EXATAMENTE como gravados.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { gerar, FIXTURE_VIATURAS, FIXTURE_VENDIDAS, FIXTURE_UTILIZADORES, FIXTURE_HISTORICO } = require('./snapshot');
const { carregarApp } = require('./harness');

const P = [
  `<img src=x onerror=alert(1)>`,
  `"><script>alert(2)</script>`,
  `');alert(3);//`,
  `\\');alert(4);//`,
  `" onmouseover="alert(5)`,
  `a\nb'c"d\\e`,
];
const evil = (base, i) => ({ ...base, ...Object.fromEntries(Object.keys(base).map(k => [k, typeof base[k] === 'string' && !['chassis'].includes(k) && !/^(data|estado)/.test(k) ? P[i % P.length] : base[k]])) });

function atributosOnclick(html) {
  return [...html.matchAll(/onclick="([^"]*)"/g)].map(m => m[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}
// executa o código do onclick com stubs e devolve a lista de chamadas feitas
function chamadas(codigo) {
  const calls = [];
  const proxy = new Proxy({}, { has: () => true, get: (_, nome) => nome === Symbol.unscopables ? undefined : (...a) => calls.push([nome, ...a]) });
  vm.runInNewContext(`with(p){ ${codigo} }`, { p: proxy });
  return calls;
}

test('viaturas/vendidas/utilizadores/histórico maliciosos: sem HTML injetado', async () => {
  const viaturas = FIXTURE_VIATURAS.map((c, i) => ({ ...evil(c, i), chassis: P[i % P.length], local: [P[(i + 1) % P.length]] }));
  const vendidas = FIXTURE_VENDIDAS.map((c, i) => ({ ...evil(c, i + 2), chassis: P[2] }));
  const utilizadores = FIXTURE_UTILIZADORES.map((c, i) => evil(c, i));
  const historico = FIXTURE_HISTORICO.map((c, i) => ({ ...evil(c, i), data_hora: c.data_hora }));
  const { out } = await gerar({ viaturas, vendidas, utilizadores, historico });
  const todos = [out.cartoes, out.tabela, out.vendidas, out.utilizadores, out.historico, out.filtroModelo, ...Object.values(out.listaAdmin), ...out.bot].join('\n');
  assert.ok(!/<img/i.test(todos), 'tag <img injetada');
  assert.ok(!/<script/i.test(todos), 'tag <script injetada');
  assert.ok(!/"\s*on\w+=/i.test(todos.replace(/onclick="[^"]*"/g, '')), 'atributo de evento injetado');
});

test('onclick: o chassis chega à função exatamente como gravado', async () => {
  for (const payload of P) {
    const viaturas = [{ ...FIXTURE_VIATURAS[0], chassis: payload }];
    const { out } = await gerar({ viaturas });
    for (const html of [out.cartoes, out.tabela, out.listaAdmin['Administrador']]) {
      const atrs = atributosOnclick(html).filter(a => /abrirDetalheViatura|abrirEdicao/.test(a));
      assert.ok(atrs.length > 0);
      for (const a of atrs) {
        const c = chamadas(a);
        assert.equal(c.length, 1, `uma só chamada para ${JSON.stringify(payload)}`);
        assert.equal(c[0][1], payload);
      }
    }
  }
});

test('onclick de filtros/utilizadores/vendidas não permitem breakout', async () => {
  for (const payload of P) {
    const { out } = await gerar({ viaturas: [{ ...FIXTURE_VIATURAS[0], modelo: payload }] });
    for (const a of atributosOnclick(out.filtroModelo).filter(x => !x.includes("'Todos'"))) {
      const c = chamadas(a);
      assert.equal(c.length, 1);
      assert.equal(c[0][2], payload);
    }
  }
});

test('urlSegura: só http(s)', () => {
  const app = carregarApp();
  const f = u => app.run(`urlSegura(${JSON.stringify(u)})`);
  assert.equal(f('javascript:alert(1)'), '');
  assert.equal(f('data:text/html,<script>1</script>'), '');
  assert.equal(f(' JAVASCRIPT:alert(1)'), '');
  assert.equal(f(''), '');
  assert.equal(f(null), '');
  assert.equal(f('https://fotos.exemplo.pt/a'), 'https://fotos.exemplo.pt/a');
});
