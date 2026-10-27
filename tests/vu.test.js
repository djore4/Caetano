// Stock VU (Gestão VU + Parque VU): leitura por perfil, o que o vendedor NÃO vê, reservas, gravação, arquivo e acessos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { carregarApp } = require('./harness');

const J = JSON.stringify;
const eq = (a, b, m) => assert.equal(J(a), J(b), m);   // compara por valor (objetos do contexto vm têm outro protótipo)
const user = (perfil, negocio = ['VD', 'VU'], marca = ['BMW', 'BMW Motorrad'], extra = {}) => ({ id: 5, nome: 'Rui Chefe', email: 'u@x.pt', perfil, local: ['Todas'], negocio, marca, ...extra });
const CHEFE = user('Chefe de Vendas');
const VENDEDOR = user('Vendedor');
const ADMIN = user('Administrador');

const diasAtras = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const linha = (id, o = {}) => ({
  id, marca: 'BMW', modelo: 'X1', versao: 'sDrive18d', motorizacao: 'ice', matricula: 'AA-11-BB', chassis: 'WBA1234567A000001', ano: 2021,
  data_matricula: '2021-03-10', quilometragem: 45000, importado: false, link_caetano: 'https://c.pt/a', link_fotos: 'https://f.pt/a',
  data_entrada_stock: diasAtras(40), preco: 24900, pvp_atualizado_em: new Date().toISOString(), local: ['Porto'], reserva_expira: null, reserva_user: null, ...o,
});
// Vista do Parque (sem campos de gestão) e vista de gestão (com proveniência/observações).
const SEGURA = [linha('u1'), linha('u2', { modelo: 'iX', matricula: 'CC-22-DD', data_entrada_stock: diasAtras(130), preco: 61000 })];
const GESTAO = SEGURA.map((l, i) => ({ ...l, proveniencia: i ? 'LEILÃO' : 'RETOMA', observacoes: 'custo 15000 (interno)', link_maxterauto: 'https://m.pt/x' }));

function fake({ utilizadores = [], viaturas = [], parque = SEGURA, gestao = GESTAO, arquivadas = [], rpcs = {} } = {}) {
  const log = [];
  const cadeia = d => ({ then: r => r({ data: d, error: null }), order() { return cadeia(d); }, limit() { return cadeia(d); }, eq() { return cadeia(d); } });
  return {
    log,
    from: t => ({
      select: () => cadeia(t === 'utilizadores' ? utilizadores : t === 'viaturas' ? viaturas : []),
      insert: async p => { log.push(['insert', t, p]); return {}; }, upsert: async p => { log.push(['upsert', t, p]); return {}; },
      update: () => ({ eq: async () => ({}) }), delete: () => ({ eq: async () => ({}) }),
    }),
    rpc: async (nome, args) => {
      log.push(['rpc', nome, args]);
      if (rpcs[nome]) return rpcs[nome](args);
      if (nome === 'sf_vu_parque') return { data: parque, error: null };
      if (nome === 'sf_vu_gestao') return { data: args && args.p_arquivadas ? arquivadas : gestao, error: null };
      return { data: null, error: { message: 'sem implementação' } };
    },
    auth: { signOut: async () => {} },
  };
}
const arranque = async (u, opts = {}) => {
  const cliente = fake(opts);
  const app = carregarApp({ supabaseClient: cliente });
  app.run(`currentUser = ${J(u)};`);
  await app.run('carregarVu()');
  app.run('initModeloFiltros(); aplicarFiltros();');
  return { app, cliente };
};
const rpcs = cliente => cliente.log.filter(l => l[0] === 'rpc').map(l => l[1]);

test('carregarVu: vendedor usa a vista segura, gestor a de gestão; o objeto fica como uma viatura', async () => {
  const v = await arranque(VENDEDOR);
  eq(rpcs(v.cliente), ['sf_vu_parque']);
  assert.equal(v.app.run('inventarioVu.length'), 2);
  const g = await arranque(CHEFE);
  eq(rpcs(g.cliente), ['sf_vu_gestao']);
  assert.equal(g.cliente.log[0][2].p_arquivadas, false);
  const c = g.app.run('inventarioVu[0]');
  assert.equal(c.fonte, 'vu'); assert.equal(c.chassis, 'VU:u1'); assert.equal(c.estado_negocio, 'VU');
  eq(c.marca, ['BMW']); eq(c.tipologia, ['ICE']); assert.equal(c.pvp_final, 24900); assert.equal(c.proveniencia, 'RETOMA');
  assert.equal(v.app.run('inventarioVu[0].proveniencia'), '');          // a vista segura nem a traz
});

test('carregarVu: respeita a marca do perfil e não rebenta se o servidor falhar', async () => {
  const mix = [linha('a'), linha('b', { marca: 'BMW Motorrad', modelo: 'R1300', matricula: 'EE-33-FF' })];
  const so = await arranque(user('Vendedor', ['VU'], ['BMW']), { parque: mix });
  eq(so.app.run('inventarioVu.map(c => c.vu_id)'), ['a']);
  const soVd = await arranque(user('Vendedor', ['VD'], ['BMW']), { parque: mix });   // o tipo não esconde o stock VU
  eq(soVd.app.run('inventarioVu.map(c => c.vu_id)'), ['a']);
  const falha = await arranque(VENDEDOR, { rpcs: { sf_vu_parque: async () => ({ data: null, error: { message: 'function sf_vu_parque() does not exist' } }) } });
  assert.equal(falha.app.run('inventarioVu.length'), 0); assert.equal(falha.app.run('vuIndisponivel'), true);
  const rede = carregarApp({ supabaseClient: { rpc: async () => { throw new Error('offline'); } } });
  rede.run(`currentUser = ${J(VENDEDOR)};`); await rede.run('carregarVu()'); assert.equal(rede.run('vuIndisponivel'), true);
  const sem = carregarApp({ supabaseClient: { from: () => ({}) } });      // cliente sem rpc: não deve rebentar
  sem.run(`currentUser = ${J(VENDEDOR)};`); await sem.run('carregarVu()'); assert.equal(sem.run('inventarioVu.length'), 0);
});

test('VU: o preço é o da linha — não passa pela fórmula de preço de novo', async () => {
  const { app } = await arranque(CHEFE);
  app.run('carregarPrecosEmDireto()');                                   // só toca em `inventario`
  const s = app.run('calcularPrecosTempoReal(inventarioVu[0])');
  assert.equal(s.pvp_final, 24900); assert.equal(s.pvp_bruto, 0); assert.equal(s.mg, null);   // sem PVP de tabela (não aparece riscado no Parque)
  assert.equal(app.run('inventarioVu[0].stats.dias_stock'), 40);
  assert.equal(app.run('inventarioVu[1].stats.dias_stock'), 130);
});

test('Parque: VU aparece junto das VD, com ano/kms em vez de desconto/PVP novo', async () => {
  const { app } = await arranque(VENDEDOR);
  app.run(`inventario = ${J([{ chassis: 'WBAVD0000000001', matricula: 'VD-00-VD', modelo: 'X5', versao: 'M50', estado_negocio: 'VD', marca: ['BMW'], local: ['Porto'], tipologia: ['PHEV'] }])}; carregarPrecosEmDireto(); aplicarFiltros();`);
  const cartoes = app.el('vista-cartoes').innerHTML; const tabela = app.el('tabela-corpo').innerHTML;
  assert.equal(app.el('num-resultados').innerText, 3);
  assert.match(cartoes, /abrirDetalheViatura\('VU:u1'\)/); assert.match(tabela, /abrirDetalheViatura\('VU:u2'\)/);
  assert.match(cartoes, /24\s900,00/);                         // preço de venda
  assert.match(cartoes, /Quilómetros/); assert.match(cartoes, /45\s000/);
  assert.match(cartoes, /Desconto total/);                              // a VD continua como antes
  const soVu = cartoes.split('abrirDetalheViatura(\'VU:u1\')')[1].split('abrirDetalheViatura(')[0];
  assert.doesNotMatch(soVu, /Desconto total|PVP \(Novo\)|BSI incluído/);
  assert.match(tabela, /A000001/);   // chassis real, não a chave interna
  assert.doesNotMatch(tabela, /VU:u1<|>VU:/);
  assert.doesNotMatch(tabela.split("abrirDetalheViatura('VU:u1')")[1].split('</tr>')[0], /line-through[^>]*>\s*\d/);   // VU não mostra um "PVP base" riscado
  app.run("setFiltro('negocio','VU')"); assert.equal(app.el('num-resultados').innerText, 2);
});

test('Parque: o vendedor NUNCA recebe proveniência, observações, custos nem dias em stock; o gestor vê os dias', async () => {
  const v = await arranque(VENDEDOR);
  // dados do vendedor não contêm campos de gestão (vista segura) e o HTML também não
  let html = v.app.el('vista-cartoes').innerHTML + v.app.el('tabela-corpo').innerHTML;
  v.app.run("abrirDetalheViatura('VU:u1')"); html += v.app.el('detalhe-bloco-vu').innerHTML;
  for (const proibido of ['RETOMA', 'LEILÃO', 'custo 15000', 'Só gestão', 'Proveniência', 'm.pt', 'dias em stock']) assert.ok(!html.includes(proibido), `vendedor vê "${proibido}"`);
  // mesmo que um objeto de gestão chegasse ao vendedor, a interface não o mostra
  v.app.run(`inventarioVu = ${J(GESTAO)}.map(mapVuRow); aplicarFiltros(); abrirDetalheViatura('VU:u1')`);
  html = v.app.el('vista-cartoes').innerHTML + v.app.el('detalhe-bloco-vu').innerHTML;
  for (const proibido of ['RETOMA', 'LEILÃO', 'custo 15000', 'Só gestão', 'dias em stock']) assert.ok(!html.includes(proibido), `vendedor (dados de gestão) vê "${proibido}"`);
  // gestor: vê dias em stock no cartão e o bloco "Só gestão" no detalhe
  const g = await arranque(CHEFE);
  assert.match(g.app.el('vista-cartoes').innerHTML, /40 dias em stock/);
  g.app.run("abrirDetalheViatura('VU:u1')");
  const det = g.app.el('detalhe-bloco-vu').innerHTML;
  assert.match(det, /Só gestão/); assert.match(det, /RETOMA/); assert.match(det, /custo 15000/);
});

test('Detalhe VU: mostra o bloco VU (não o de preço de novo), a data de revisão do preço e o anúncio', async () => {
  const { app } = await arranque(VENDEDOR);
  app.run("abrirDetalheViatura('VU:u1')");
  assert.equal(app.el('detalhe-bloco-vu').classList.contains('hidden'), false);
  assert.equal(app.el('detalhe-bloco-vd').classList.contains('hidden'), true);
  const h = app.el('detalhe-bloco-vu').innerHTML;
  assert.match(h, /Preço revisto em/); assert.match(h, /Motorização/); assert.match(h, /ICE/); assert.match(h, /2021/);
  assert.equal(app.el('btn-ver-anuncio-modal').href, 'https://c.pt/a');
  assert.equal(app.el('btn-ver-fotos-modal').href, 'https://f.pt/a');
  assert.equal(app.el('btn-reservar-viatura').classList.contains('hidden'), true);   // vendedor não reserva
  assert.equal(app.el('detalhe-titulo').innerText, 'X1 sDrive18d');
});

test('Reserva VU: só o Chefe de Vendas/Administrador, pelo servidor; conflito recarrega o stock', async () => {
  const expira = new Date(Date.now() + 48 * 3600e3).toISOString();
  const ok = async args => ({ data: { ...linha(args.p_id), reserva_expira: args.p_cancelar ? null : expira, reserva_user: args.p_cancelar ? null : 'Rui Chefe' }, error: null });
  const { app, cliente } = await arranque(CHEFE, { rpcs: { sf_vu_reservar: ok } });
  app.run("abrirDetalheViatura('VU:u1')");
  assert.equal(app.el('btn-reservar-viatura').classList.contains('hidden'), false);
  await app.run('reservarViaturaModal()');
  const chamada = cliente.log.find(l => l[1] === 'sf_vu_reservar');
  eq(chamada[2], { p_id: 'u1', p_cancelar: false });
  assert.equal(app.run('isReservado(inventarioVu[0])'), true); assert.equal(app.run('inventarioVu[0].reserva_user'), 'Rui Chefe');
  assert.match(app.alertas.join(' '), /Reservada/);
  assert.match(app.el('vista-cartoes').innerHTML, /Em Negociação/);
  assert.ok(cliente.log.some(l => l[0] === 'insert' && l[1] === 'historico' && l[2].acao === 'RESERVA' && l[2].tabela === 'retomas'));
  // cancelar
  app.run("abrirDetalheViatura('VU:u1')"); assert.equal(app.el('btn-cancelar-reserva').classList.contains('hidden'), false);
  await app.run('cancelarReservaModal()');
  assert.equal(cliente.log.filter(l => l[1] === 'sf_vu_reservar').pop()[2].p_cancelar, true);
  assert.equal(app.run('isReservado(inventarioVu[0])'), false);
  // vendedor: nem botão nem chamada
  const v = await arranque(VENDEDOR, { rpcs: { sf_vu_reservar: ok } });
  v.app.run("abrirDetalheViatura('VU:u1')"); await v.app.run('reservarViaturaModal()');
  assert.equal(v.cliente.log.filter(l => l[1] === 'sf_vu_reservar').length, 0); assert.match(v.app.alertas.join(' '), /Só o Chefe de Vendas/);
  // conflito: outra pessoa reservou entretanto
  const c = await arranque(CHEFE, { rpcs: { sf_vu_reservar: async () => ({ data: null, error: { message: 'Viatura já reservada' } }) } });
  c.app.run("abrirDetalheViatura('VU:u1')"); await c.app.run('reservarViaturaModal()');
  assert.match(c.app.alertas.join(' '), /acabou de ser reservada/);
  assert.equal(c.cliente.log.filter(l => l[1] === 'sf_vu_gestao').length, 2);        // recarregou
});

test('Reserva de VD continua igual (não passa pelo servidor VU)', async () => {
  const cliente = fake();
  cliente.from = () => ({ select: () => ({ then: r => r({ data: [], error: null }) }), update: () => ({ eq: async () => ({}) }), insert: async () => ({}) });
  const app = carregarApp({ supabaseClient: cliente });
  app.run(`currentUser = ${J(CHEFE)}; inventario = ${J([{ chassis: 'WBAVD1', modelo: 'X5', estado_negocio: 'VD', marca: ['BMW'], inputs: null }])}; inventarioVu = [];`);
  app.run("document.getElementById('detalhe-chassis-hidden').value = 'WBAVD1'");
  await app.run('reservarViaturaModal()');
  assert.equal(app.run('isReservado(inventario[0])'), true);
  assert.equal(cliente.log.filter(l => l[0] === 'rpc').length, 0);
});

test('Gestão VU: lista, resumo por escalão de stock, filtros e alertas "a rever"', async () => {
  const antigo = linha('u3', { modelo: 'Z4', matricula: 'GG-44-HH', preco: null, link_fotos: '', data_entrada_stock: diasAtras(200), pvp_atualizado_em: null });
  const { app } = await arranque(CHEFE, { gestao: [...GESTAO, { ...antigo, proveniencia: 'REMARK', observacoes: '' }] });
  app.run('renderizarListaVu()');
  const n = () => (app.el('vu-lista').innerHTML.match(/<tr /g) || []).length;
  assert.equal(n(), 3); assert.equal(app.el('vu-num-resultados').innerText, 3);
  const lista = app.el('vu-lista').innerHTML;
  assert.match(lista, /Sem preço/); assert.match(lista, /Sem fotos/); assert.match(lista, /Reservar/); assert.match(lista, /Vendida/);
  assert.match(lista, /LEILÃO/); assert.match(lista, /RETOMA/);
  const resumo = app.el('vu-resumo').innerHTML;                          // 40d -> 31-90; 130d e 200d -> 121+
  assert.match(resumo, /setFiltroVu\('cluster','31-90'\)/);
  app.run("setFiltroVu('cluster','121+')"); assert.equal(n(), 2);
  app.run("setFiltroVu('cluster','31-90')"); assert.equal(n(), 1);
  app.run("setFiltroVu('cluster','rever')"); assert.equal(n(), 1);        // só a que não tem preço nem fotos
  app.run("setFiltroVu('cluster','Todos'); setFiltroVu('prov','LEILÃO')"); assert.equal(n(), 1);
  app.run("setFiltroVu('prov','Todas')"); app.el('vu-pesquisa').value = 'gg-44'; app.run('renderizarListaVu()'); assert.equal(n(), 1);
  app.el('vu-pesquisa').value = ''; app.run('renderizarListaVu()'); assert.equal(n(), 3);
});

test('Gestão VU: servidor indisponível mostra aviso claro', async () => {
  const { app } = await arranque(CHEFE, { rpcs: { sf_vu_gestao: async () => ({ data: null, error: { message: 'does not exist' } }) } });
  app.run('renderizarListaVu()');
  assert.equal(app.el('vu-aviso-indisponivel').classList.contains('hidden'), false);
  assert.match(app.el('vu-lista').innerHTML, /Stock VU indisponível/);
});

test('Gravar VU: campos obrigatórios, normalização, chamada ao servidor e atualização do Parque', async () => {
  const gravada = { ...linha('novo1', { modelo: 'X3', matricula: 'ZZ-99-ZZ', preco: 31000.5 }), proveniencia: 'RETOMA' };
  const { app, cliente } = await arranque(CHEFE, { rpcs: { sf_vu_guardar: async () => ({ data: gravada, error: null }) } });
  app.run('abrirNovaVu()');
  const set = (id, v) => { app.el(id).value = v; };
  // obrigatórios em falta
  await app.run('guardarVu({ preventDefault() {} })');
  assert.match(app.alertas.join(' '), /Modelo/); assert.match(app.alertas.join(' '), /Matrícula/); assert.match(app.alertas.join(' '), /Proveniência/);
  assert.equal(cliente.log.filter(l => l[1] === 'sf_vu_guardar').length, 0);
  set('vu-modelo', 'X3'); set('vu-versao', '20d'); set('vu-matricula', 'zz 99 zz'); set('vu-proveniencia', 'RETOMA'); set('vu-preco', '31.000,50'); set('vu-kms', '12000'); set('vu-ano', '2022');
  set('vu-chassis', 'wba999'); set('vu-link_fotos', 'javascript:alert(1)');
  app.alertas.length = 0; await app.run('guardarVu({ preventDefault() {} })');
  assert.match(app.alertas.join(' '), /http/);                            // link inseguro recusado
  set('vu-link_fotos', 'https://f.pt/x');
  app.run("toggleVuLocal('Porto'); setVuMotorizacao('BEV')");
  app.alertas.length = 0; await app.run('guardarVu({ preventDefault() {} })');
  const p = cliente.log.find(l => l[1] === 'sf_vu_guardar')[2].p;
  assert.equal(p.id, null); assert.equal(p.marca, 'BMW'); assert.equal(p.modelo, 'X3'); assert.equal(p.matricula, 'ZZ-99-ZZ');
  assert.equal(p.preco, 31000.5); assert.equal(p.quilometragem, 12000); assert.equal(p.ano, 2022); assert.equal(p.chassis, 'WBA999');
  assert.equal(p.motorizacao, 'bev'); eq(p.local, ['Porto']); assert.equal(p.proveniencia, 'RETOMA');
  assert.equal(app.run('inventarioVu.length'), 3);                       // entrou no stock
  assert.match(app.el('tabela-corpo').innerHTML, /abrirDetalheViatura\('VU:novo1'\)/);   // e no Parque
  assert.ok(cliente.log.some(l => l[0] === 'insert' && l[1] === 'historico' && l[2].acao === 'CRIAR'));
  // editar: leva o id e substitui em vez de duplicar
  app.run("abrirEditarVu('VU:u1')"); assert.equal(app.el('vu-id').value, 'u1'); assert.equal(app.el('vu-proveniencia').value, 'RETOMA');
  assert.equal(app.run('vuForm.motorizacao'), 'ICE');
  await app.run('guardarVu({ preventDefault() {} })');
  assert.equal(cliente.log.filter(l => l[1] === 'sf_vu_guardar').pop()[2].p.id, 'u1');
});

test('Gravar VU: sem permissão não grava; preço negativo e matrícula duplicada são recusados', async () => {
  const dup = await arranque(CHEFE, { rpcs: { sf_vu_guardar: async () => ({ data: null, error: { message: 'Já existe no stock uma viatura com esta matrícula' } }) } });
  dup.app.run('abrirNovaVu()');
  const set = (a, id, v) => { a.el(id).value = v; };
  for (const [id, v] of [['vu-modelo', 'X3'], ['vu-matricula', 'AA-11-BB'], ['vu-proveniencia', 'RETOMA']]) set(dup.app, id, v);
  set(dup.app, 'vu-preco', '-5'); await dup.app.run('guardarVu({ preventDefault() {} })'); assert.match(dup.app.alertas.join(' '), /negativo/);
  set(dup.app, 'vu-preco', '1000'); dup.app.alertas.length = 0; await dup.app.run('guardarVu({ preventDefault() {} })');
  assert.match(dup.app.alertas.join(' '), /esta matrícula/); assert.equal(dup.app.run('inventarioVu.length'), 2);
  // vendedor
  const v = await arranque(VENDEDOR); v.app.run('abrirNovaVu()'); await v.app.run('guardarVu({ preventDefault() {} })');
  assert.match(v.app.alertas.join(' '), /Sem permissão/); assert.equal(v.cliente.log.filter(l => l[1] === 'sf_vu_guardar').length, 0);
  // Chefe sem a marca/tipo VU no perfil
  const sv = await arranque(user('Chefe de Vendas', ['VD'], ['BMW']));
  await sv.app.run('guardarVu({ preventDefault() {} })'); assert.match(sv.app.alertas.join(' '), /tipo de viatura/);
});

test('Vendida/Recuperar: sai do Parque, fica em arquivadas e volta ao recuperar', async () => {
  const arq = { ...linha('u1'), arquivada: true, proveniencia: 'RETOMA' };
  const { app, cliente } = await arranque(CHEFE, { arquivadas: [arq], rpcs: { sf_vu_arquivar: async a => ({ data: { ...linha(a.p_id), arquivada: a.p_arquivar, proveniencia: 'RETOMA' }, error: null }) } });
  await app.run("arquivarVu('VU:u1', true)");
  eq(cliente.log.find(l => l[1] === 'sf_vu_arquivar')[2], { p_id: 'u1', p_arquivar: true });
  eq(app.run('inventarioVu.map(c => c.vu_id)'), ['u2']);
  assert.doesNotMatch(app.el('vista-cartoes').innerHTML, /VU:u1/);
  assert.ok(cliente.log.some(l => l[0] === 'insert' && l[2].acao === 'VENDIDA'));
  app.run("setFiltroVu('estado','Arquivadas')"); await new Promise(r => setImmediate(r));
  assert.match(app.el('vu-lista').innerHTML, /Recuperar/); assert.doesNotMatch(app.el('vu-lista').innerHTML, />Vendida</);
  await app.run("arquivarVu('VU:u1', false)");
  eq(app.run('inventarioVu.map(c => c.vu_id).sort()'), ['u1', 'u2']);
  assert.match(app.el('tabela-corpo').innerHTML, /VU:u1/);
  // cancelar a confirmação não faz nada
  app.ctx.confirm = () => false; const antes = cliente.log.length; await app.run("arquivarVu('VU:u2', true)");
  assert.equal(cliente.log.length, antes);
});

test('Acessos: separador Gestão VU só com perfil de gestão E tipo VU; VD novas não criam VU', async () => {
  const app = carregarApp();
  const visivel = u => { app.run(`currentUser = ${J(u)}; atualizarAcessos();`); return !app.el('tab-admin-vu').classList.contains('hidden'); };
  assert.equal(visivel(CHEFE), true); assert.equal(visivel(ADMIN), true);
  assert.equal(visivel(user('Chefe de Vendas', ['VD'], ['BMW'])), false);
  assert.equal(visivel(user('Chefe de Vendas', ['VU'], ['BMW'])), true);
  assert.equal(visivel(VENDEDOR), false);
  // a Gestão VD já não cria viaturas usadas (entram pela Gestão VU)
  app.run(`currentUser = ${J(CHEFE)}; inventario = [];`); app.run('prepararNovaViatura()');
  app.alertas.length = 0; app.run("setEditNegocio('VU')");
  assert.match(app.alertas.join(' '), /Gestão VU/); assert.equal(app.run('editCarroNegocio'), 'VD');
  // viaturas VU já existentes na tabela antiga continuam a poder manter o tipo
  app.run("editCarroNegocio = 'VU'; setEditNegocio('VU')"); assert.equal(app.run('editCarroNegocio'), 'VU');
});

test('Assistente: o contexto inclui o stock VU (ano/kms) sem proveniência nem observações', async () => {
  const { app } = await arranque(CHEFE);
  const ctx = app.run('construirContextoParque()');
  assert.match(ctx, /Total: 2 viaturas/); assert.match(ctx, /\[VU\]/); assert.match(ctx, /ano 2021 \| 45000 km/);
  for (const proibido of ['RETOMA', 'LEILÃO', 'custo 15000', 'm.pt']) assert.ok(!ctx.includes(proibido), proibido);
  assert.match(app.run("processarMensagemBot('ix')"), /iX/);
});

test('Segurança: texto vindo da base de dados é escapado em todo o módulo VU', async () => {
  const mau = '<img src=x onerror=alert(1)>';
  const { app } = await arranque(CHEFE, { gestao: [{ ...GESTAO[0], modelo: mau, versao: mau, proveniencia: 'REMARK', observacoes: mau, link_fotos: 'javascript:alert(1)' }] });
  app.run('renderizarListaVu()'); app.run("abrirDetalheViatura('VU:u1')");
  const tudo = [app.el('vista-cartoes').innerHTML, app.el('tabela-corpo').innerHTML, app.el('vu-lista').innerHTML, app.el('detalhe-bloco-vu').innerHTML].join('');
  assert.ok(!tudo.includes('<img src=x'), 'HTML injetado sem escape');
  assert.equal(app.el('btn-ver-fotos-modal').href === 'javascript:alert(1)', false);
  assert.equal(app.run("urlSegura('javascript:alert(1)')"), '');
});
