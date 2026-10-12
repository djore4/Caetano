// node --test tests/   (ou: node tests/regressao.test.js --update  para regenerar baseline)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gerar } = require('./snapshot');

const BASELINE = path.join(__dirname, 'baseline.json');

if (process.argv.includes('--update')) {
  gerar().then(({ out }) => { fs.writeFileSync(BASELINE, JSON.stringify(out, null, 1)); console.log('baseline escrito'); });
} else {
  test('preços, escalões e números: idênticos ao baseline', async () => {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const out = JSON.parse(JSON.stringify((await gerar()).out));
    for (const k of ['precos', 'p30', 'numeros']) assert.deepEqual(out[k], base[k], k);
  });
  test('permissões e visibilidade de abas: idênticas ao baseline', async () => {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const out = JSON.parse(JSON.stringify((await gerar()).out));
    for (const k of ['hasPerm', 'abas', 'mudarTab']) assert.deepEqual(out[k], base[k], k);
  });
  test('HTML renderizado com dados benignos: idêntico ao baseline', async () => {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const out = JSON.parse(JSON.stringify((await gerar()).out));
    for (const k of ['filtroModelo', 'cartoes', 'tabela', 'listaAdmin', 'vendidas', 'utilizadores', 'historico', 'bot', 'contexto']) assert.deepEqual(out[k], base[k], k);
  });
}
