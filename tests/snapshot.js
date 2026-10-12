// Gera um "retrato" determinístico do comportamento da app com dados benignos:
// preços, escalões de 30 dias, permissões, HTML renderizado e visibilidade de abas.
// O baseline foi gerado ANTES das alterações de segurança; qualquer diferença
// em preços/acessos faz o teste falhar.
const { carregarApp } = require('./harness');

const AGORA = Date.UTC(2026, 9, 12, 12, 0, 0); // 2026-10-12 12:00 UTC (fixo)

function dataFixa(app) {
  app.ctx.Date = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(AGORA); }
    static now() { return AGORA; }
  };
}

const futuro = new Date(AGORA + 3600e3 * 20).toISOString();
const passado = new Date(AGORA - 3600e3 * 20).toISOString();

const inp = (o = {}) => ({ pvb: 40000, opc: 5000, bsi: 800, eco: 4.2, leg: 1550, isv: 0, mgb: 0.05, esf: 0.02, pac: 0.01, dem: 0.03, sup: 0, pvp_desc: 52000, depreciacoes: 300, ...o });

const FIXTURE_VIATURAS = [
  { chassis: 'WBA1111111A000001', matricula: 'AA-11-BB', modelo: 'X1', versao: 'sDrive18d', encomenda: 'E001', tipologia: ['ICE'], local: ['Porto'], marca: ['BMW'], estado_negocio: 'VD', iva_dedutivel: false, data_matricula: '2026-07-01', kms: 120, inputs: inp(), estado_entrega: 'Imediata', link_fotos: 'https://fotos.exemplo.pt/a' },
  { chassis: 'WBA2222222A000002', matricula: 'CC22DD', modelo: 'iX', versao: 'xDrive40', encomenda: 'E002', tipologia: 'BEV', local: JSON.stringify(['Gaia', 'Feira']), marca: ['BMW'], estado_negocio: 'VU', iva_dedutivel: true, data_matricula: '2025-01-15', kms: 15000, inputs: JSON.stringify(inp({ bsi: -1, pvp_desc: 71000, isv: 0 })), reserva_expira: futuro, reserva_user: 'Ana Reis', estado_entrega: 'Maio 2026' },
  { chassis: 'WBA3333333A000003', matricula: null, modelo: 'Série 3', versao: '320d', encomenda: null, tipologia: ['ICE', 'M'], local: ['Aveiro'], marca: ['BMW Motorrad'], estado_negocio: null, data_matricula: null, inputs: inp({ pvb: 0, opc: 0, pvp_desc: 0 }), reserva_expira: passado, reserva_user: 'Rui' },
  { chassis: 'WBA4444444A000004', matricula: 'EE-33-FF', modelo: 'X5', versao: 'xDrive50e', encomenda: 'E004', tipologia: ['PHEV'], local: [], marca: ['BMW'], estado_negocio: 'VD', data_matricula: '2099-01-01', inputs: null },
];

const FIXTURE_VENDIDAS = [
  { id: 7, chassis: 'WBA9999999A000009', matricula: 'GG-44-HH', modelo: 'X3', versao: '20d', encomenda: 'E009', local: ['Porto'], preco_final: 48500.5, data_venda: '2026-09-01T10:00:00Z', vendido_por: 'Ana Reis' },
];

const FIXTURE_UTILIZADORES = [
  { id: 1, nome: 'Admin Um', email: 'admin@x.pt', perfil: 'Administrador', local: ['Todas'] },
  { id: 2, nome: 'Chefe Porto', email: 'chefe@x.pt', perfil: 'Chefe de Vendas', local: ['Porto'] },
  { id: 3, nome: 'Vendedor Gaia', email: 'vend@x.pt', perfil: 'Vendedor', local: ['Gaia'] },
];

const FIXTURE_HISTORICO = [
  { tabela: 'viaturas', acao: 'CRIAR', registo_id: 'WBA1111111A000001', data_hora: '2026-10-01T09:00:00Z' },
  { tabela: 'utilizadores', acao: 'ELIMINAR', registo_id: '9', data_hora: '2026-10-02T09:00:00Z' },
];

async function gerar(extra = {}) {
  const app = carregarApp();
  dataFixa(app);
  const J = JSON.stringify;
  const out = {};

  // 1) Preços e escalões
  app.run(`inventario = ${J(extra.viaturas || FIXTURE_VIATURAS)}`);
  out.precos = app.run(`inventario.map(c => { const s = calcularPrecosTempoReal(c); return { chassis: c.chassis, s }; })`);
  out.p30 = ['2026-07-01', '2026-10-12', '2099-01-01', null, 'lixo'].map(d => ({ d, r: app.run(`(() => { const r = calcularPeriodos30(${J(d)}); return r && { ...r, proxima: r.proxima.toISOString() }; })()`) }));
  out.numeros = ['1.550,50', '1550,5', '0', '', 'abc', '12 000,00'].map(s => ({ s, n: app.run(`strParaNumero(${J(s)})`) }));

  // 2) Permissões (matriz perfil x local)
  const perfis = FIXTURE_UTILIZADORES;
  out.hasPerm = perfis.map(u => {
    app.run(`currentUser = ${J(u)}`);
    return { perfil: u.perfil, locais: ['Porto', 'Gaia', 'Feira', 'Aveiro', 'Todas'].map(l => app.run(`hasPerm('local', ${J(l)})`)) };
  });

  // 3) Visibilidade de abas por perfil (+ sem sessão)
  out.abas = [];
  for (const u of [...perfis, null]) {
    app.run(`currentUser = ${J(u)}`);
    app.run('atualizarAcessos()');
    const ids = ['tab-utilizadores', 'tab-historico', 'tab-admin-vd', 'tab-admin-vu', 'tab-vendidos', 'btn-mudar-password', 'main-content', 'chat-widget'];
    out.abas.push({ perfil: u && u.perfil, escondido: ids.map(i => app.el(i) ? app.el(i).classList.contains('hidden') : null) });
  }
  // acesso a abas restritas
  out.mudarTab = [];
  for (const u of [...perfis, null]) {
    app.run(`currentUser = ${J(u)}`);
    app.alertas.length = 0;
    app.run("mudarTab('utilizadores')");
    out.mudarTab.push({ perfil: u && u.perfil, bloqueado: app.alertas.length > 0 });
  }

  // 4) HTML renderizado
  app.run(`currentUser = ${J(perfis[0])}; inventario = ${J(extra.viaturas || FIXTURE_VIATURAS)}; carregarPrecosEmDireto(); initModeloFiltros(); aplicarFiltros();`);
  out.filtroModelo = app.el('filtro-modelo-container').innerHTML;
  out.cartoes = app.el('vista-cartoes').innerHTML;
  out.tabela = app.el('tabela-corpo').innerHTML;
  for (const u of perfis) {
    app.run(`currentUser = ${J(u)}; renderizarListaAdmin()`);
    (out.listaAdmin ||= {})[u.perfil] = app.el('lista-admin-viaturas').innerHTML;
  }
  app.run(`currentUser = ${J(perfis[0])}; vendidasDb = ${J(extra.vendidas || FIXTURE_VENDIDAS)}; renderizarVendidas()`);
  out.vendidas = app.el('vendidos-corpo').innerHTML;
  app.run(`utilizadoresDb = ${J(extra.utilizadores || FIXTURE_UTILIZADORES)}; renderizarListaUtilizadores()`);
  out.utilizadores = app.el('lista-utilizadores').innerHTML;
  app.run(`historicoDb = ${J(extra.historico || FIXTURE_HISTORICO)}`);
  await app.run('carregarHistorico()');
  out.historico = app.el('lista-historico').innerHTML;
  out.bot = ['x1 porto', 'elétrico até 80k', 'nada disto'].map(q => app.run(`processarMensagemBot(${J(q)})`));
  out.contexto = app.run('construirContextoParque()');

  return { out, app };
}

module.exports = { gerar, FIXTURE_VIATURAS, FIXTURE_VENDIDAS, FIXTURE_UTILIZADORES, FIXTURE_HISTORICO };
