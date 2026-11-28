import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPool } from 'mariadb';
import { createApp } from '../dist/server/app.js';
import { initDb } from '../dist/server/db/init.js';
import { hashPassword } from '../dist/server/password.js';

test('saída parcial e recebimento por remessa mantêm estoque e pendências separados', async (t) => {
  const url = URL.parse(process.env.TEST_DATABASE_URL ?? '');
  if (url?.protocol !== 'mariadb:' || url.pathname !== '/amendoas_test') {
    throw new Error('Configure TEST_DATABASE_URL para o banco de testes amendoas_test.');
  }
  const db = createPool(url.href);
  t.after(() => db.end());
  const [banco] = await db.query('SELECT DATABASE() AS nome');
  assert.equal(banco?.nome, 'amendoas_test');
  await initDb(db);
  const pacote = randomInt(100_000_000, 200_000_000);
  const granel = pacote + 1;
  const clienteId = pacote;
  await db.query('INSERT INTO clientes (id, nome) VALUES (?, ?)', [clienteId, 'Supermercado Ipê']);
  await db.query(`INSERT INTO apresentacoes (id, apresentacao, unidade, preco_padrao_centavos)
    VALUES (?, 'Castanha em pacote', 'pacote', 1875), (?, 'Castanha a granel', 'kg', 1875)`, [pacote, granel]);
  const senha = randomBytes(24).toString('base64url');
  const hash = await hashPassword(senha);
  const sufixo = randomBytes(6).toString('hex');
  let agora = '2026-12-12T01:00:00.000Z'; // Ainda dia 11 em Belém.
  const server = createApp(db, { secureCookie: false, agora: () => new Date(agora) }).listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  function request(path, { body, cookie, token } = {}) {
    return fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(cookie && { Cookie: cookie }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }
  async function entrar(perfil, canal = 'web') {
    const login = `${perfil}.${sufixo}`;
    await db.query('INSERT INTO usuarios (nome, login, perfil, senha_hash) VALUES (?, ?, ?, ?)',
      [`Operador fictício (${perfil})`, login, perfil, hash]);
    const sessao = await request(`/sessao/${canal}`, { body: { login, senha } });
    assert.equal(sessao.status, 200);
    return canal === 'web' ? { cookie: sessao.headers.get('set-cookie').split(';', 1)[0] } : {
      token: (await sessao.json()).token,
    };
  }
  const operador = await entrar('estoque');
  const gerente = await entrar('gerente');
  const balcao = await entrar('balcao');
  const vendedor = await entrar('vendedor', 'app');
  const item = (apresentacaoId, quantidade) => ({ apresentacaoId, quantidade, precoUnitarioCentavos: 1875 });
  async function vender(itens, retirada = false) {
    const body = { vendaId: randomUUID(), clienteId, fechadoEm: agora, itens, ...(retirada && { retiradaImediata: true }) };
    const resposta = await request(retirada ? '/pedidos/balcao' : '/pedidos/campo', {
      ...(retirada ? balcao : vendedor), body,
    });
    assert.equal(resposta.status, 201);
    return (await resposta.json()).numero;
  }
  async function receber(apresentacaoId, lotes) {
    const resposta = await request('/estoque/entradas', {
      ...operador, body: { entradaId: randomUUID(), apresentacaoId, lotes },
    });
    assert.equal(resposta.status, 201);
  }
  const rota = (pedido) => `/pedidos/${pedido}/saidas`;
  async function consultar(pedido, acesso = operador) {
    const resposta = await request(rota(pedido), acesso);
    assert.equal(resposta.status, 200);
    return resposta.json();
  }
  const corpoSaida = (lotes, modalidade = 'frota_propria') => ({ saidaId: randomUUID(), modalidade, lotes });
  const expedir = (pedido, body, acesso = operador) => request(rota(pedido), { ...acesso, body });
  const linha = (loteId, quantidade) => ({ loteId, quantidade });
  const saldo = async (id = pacote) => {
    const resposta = await request(`/estoque/saldos/${id}`, operador);
    assert.equal(resposta.status, 200);
    return resposta.json();
  };

  const primeiro = await vender([item(pacote, '10')]);
  const segundo = await vender([item(pacote, '10')]);
  assert.equal((await request(rota(primeiro))).status, 401);
  assert.equal((await request(rota(primeiro), balcao)).status, 403);
  assert.equal((await request(rota(4_294_967_295), operador)).status, 404);
  const inicial = await consultar(primeiro);
  assert.equal(inicial.itens[0].pendente, '10');
  assert.equal(inicial.itens[0].disponivel, '0');
  assert.deepEqual(inicial.saidas, []);

  await receber(pacote, [
    { codigo: 'B24', validade: '2026-12-15', quantidade: '4' },
    { codigo: 'A17', validade: '2026-12-11', quantidade: '2' },
    { codigo: 'V09', validade: '2026-12-10', quantidade: '3' },
  ]);
  const sugestao = await consultar(primeiro);
  const [a, b] = sugestao.itens[0].lotes;
  assert.deepEqual(sugestao.itens[0].lotes.map(({ codigo, disponivel, sugerida }) => ({ codigo, disponivel, sugerida })), [
    { codigo: 'A17', disponivel: '2', sugerida: '2' },
    { codigo: 'B24', disponivel: '4', sugerida: '4' },
  ]);
  assert.equal((await consultar(segundo)).itens[0].disponivel, '6', 'Consultar não reserva');
  const [vencido] = await db.query('SELECT id FROM lotes_estoque WHERE apresentacao_id = ? AND codigo = ?', [pacote, 'V09']);

  assert.equal((await expedir(primeiro, corpoSaida([linha(a.loteId, '1')]), vendedor)).status, 403);
  assert.equal((await expedir(primeiro, corpoSaida([linha(a.loteId, '1')]), balcao)).status, 403);
  assert.equal((await expedir(primeiro, corpoSaida([linha(a.loteId, '0.5')]))).status, 422);
  assert.equal((await expedir(primeiro, corpoSaida([linha(vencido.id, '1')]))).status, 409);
  assert.equal((await expedir(primeiro, corpoSaida([linha(a.loteId, '2'), linha(b.loteId, '5')]))).status, 409);
  assert.equal((await saldo()).totalDisponivel, '6', 'Falha em um lote não pode baixar outro');
  assert.deepEqual((await consultar(primeiro)).saidas, []);

  const primeiraSaida = corpoSaida([linha(a.loteId, '2'), linha(b.loteId, '4')], 'transportadora');
  const post = await expedir(primeiro, primeiraSaida);
  assert.equal(post.status, 201);
  const confirmada = await post.json();
  const reenvio = await expedir(primeiro, { ...primeiraSaida, lotes: [...primeiraSaida.lotes].reverse() });
  assert.equal(reenvio.status, 200);
  assert.deepEqual(await reenvio.json(), confirmada);
  assert.equal((await expedir(primeiro, { ...primeiraSaida, lotes: [linha(a.loteId, '1')] })).status, 409);
  const apos = await consultar(primeiro);
  assert.deepEqual(apos.itens[0], {
    apresentacaoId: pacote, apresentacao: 'Castanha em pacote', unidade: 'pacote',
    pedida: '10', despachada: '6', pendente: '4', disponivel: '0', lotes: [],
  });
  assert.equal(apos.saidas.length, 1);
  assert.equal(apos.saidas[0].numero, confirmada.numero);
  assert.equal(apos.saidas[0].modalidade, 'transportadora');
  assert.equal(apos.saidas[0].responsavel, 'Operador fictício (estoque)');
  assert.equal(apos.saidas[0].confirmadaEm, agora);
  assert.deepEqual(apos.saidas[0].lotes.map(({ codigo, validade, quantidade }) => ({ codigo, validade, quantidade })), [
    { codigo: 'A17', validade: '2026-12-11', quantidade: '2' },
    { codigo: 'B24', validade: '2026-12-15', quantidade: '4' },
  ]);
  assert.equal((await saldo()).totalFisico, '3', 'O lote vencido não foi baixado.');

  await receber(pacote, [{ codigo: 'B24', validade: '2026-12-15', quantidade: '3' }]);
  const disputa = await Promise.all([
    expedir(primeiro, corpoSaida([linha(b.loteId, '3')])),
    expedir(segundo, corpoSaida([linha(b.loteId, '3')]), gerente),
  ]);
  assert.deepEqual(disputa.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await saldo()).totalDisponivel, '0');
  assert.equal(Number((await consultar(primeiro)).itens[0].despachada) + Number((await consultar(segundo)).itens[0].despachada), 9);

  const retirada = await vender([item(pacote, '1'), item(granel, '2.375')], true);
  await receber(granel, [{ codigo: 'G01', validade: '2026-12-20', quantidade: '2.375' }]);
  await receber(pacote, [
    { codigo: 'A17', validade: '2026-12-11', quantidade: '1' },
    { codigo: 'B24', validade: '2026-12-15', quantidade: '1' },
  ]);
  const ctx = await consultar(retirada);
  assert.equal(ctx.retiradaImediata, true);
  const [pacotes, pesos] = ctx.itens;
  assert.deepEqual(pacotes.lotes.map(({ sugerida }) => sugerida), ['1', '0']);
  const [g] = pesos.lotes;
  assert.equal((await expedir(retirada, corpoSaida([linha(g.loteId, '2.000')]))).status, 422);
  assert.equal((await expedir(retirada, corpoSaida([linha(g.loteId, '2.000')], 'retirada'), balcao)).status, 403);
  const retiradaParcial = await expedir(retirada, corpoSaida([linha(b.loteId, '1'), linha(g.loteId, '2.000')], 'retirada'));
  assert.equal(retiradaParcial.status, 201, 'O operador pode ajustar a sugestão para o lote que de fato saiu');
  assert.equal((await saldo()).totalDisponivel, '1');
  assert.equal((await saldo(granel)).totalDisponivel, '0.375');
  const final = await consultar(retirada);
  assert.deepEqual(final.itens.map(({ pendente }) => pendente), ['0', '0.375']);
  assert.equal(final.saidas[0].lotes[0].codigo, 'B24');
  assert.equal((await expedir(retirada, corpoSaida([linha(a.loteId, '1')], 'retirada'))).status, 409,
    'Um item já todo despachado não pode sair de novo, mesmo com estoque.');

  const pedidoDeUmaUnidade = await vender([item(pacote, '1')]);
  await receber(pacote, [{ codigo: 'B24', validade: '2026-12-15', quantidade: '1' }]);
  const corridas = await Promise.all([
    expedir(pedidoDeUmaUnidade, corpoSaida([linha(a.loteId, '1')])),
    expedir(pedidoDeUmaUnidade, corpoSaida([linha(b.loteId, '1')]), gerente),
  ]);
  assert.deepEqual(corridas.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await consultar(pedidoDeUmaUnidade)).saidas.length, 1);
  assert.equal((await saldo()).totalDisponivel, '1');

  const pedidoAntesDaVirada = await vender([item(pacote, '1')]);
  await receber(pacote, [{ codigo: 'N11', validade: '2026-12-11', quantidade: '1' }]);
  const loteQueVence = (await consultar(pedidoAntesDaVirada)).itens[0].lotes.find((lote) => lote.codigo === 'N11');
  assert.ok(loteQueVence);
  agora = '2026-12-12T03:00:00.000Z';
  assert.equal((await expedir(pedidoAntesDaVirada, corpoSaida([linha(loteQueVence.loteId, '1')]))).status, 409);
  assert.deepEqual((await consultar(pedidoAntesDaVirada)).saidas, []);

  const rotaEntrega = (pedido) => `/pedidos/${pedido}/entregas`;
  const consultarEntregas = async (pedido) => {
    const r = await request(rotaEntrega(pedido), operador);
    assert.equal(r.status, 200);
    return r.json();
  };
  const entregar = (pedido, saida, body, acesso = operador) =>
    request(`/pedidos/${pedido}/saidas/${saida}/recebimento`, { ...acesso, body });
  const corpoEntrega = (itens) => ({ recebimentoId: randomUUID(), itens });
  const qtd = (apresentacaoId, recebida, recusada = '0', outros = {}) =>
    ({ apresentacaoId, recebida, recusada, ...outros });
  const retiradaNumero = (await retiradaParcial.json()).numero;
  const saldosAntes = await saldo(granel);
  assert.deepEqual((await consultarEntregas(retirada)).itens.map(({ recebida, emTransito, pendenteDespacho }) =>
    [recebida, emTransito, pendenteDespacho]), [['0', '1', '0'], ['0.000', '2.000', '0.375']]);
  const recebimento = corpoEntrega([qtd(granel, '1.625', '0.375', { motivo: 'Embalagem avariada', repor: true }), qtd(pacote, '1')]);
  assert.equal((await entregar(retirada, retiradaNumero, recebimento, vendedor)).status, 403);
  assert.equal((await entregar(primeiro, retiradaNumero, recebimento)).status, 404);
  assert.equal((await entregar(retirada, retiradaNumero, corpoEntrega([qtd(granel, '2')]))).status, 422);
  assert.equal((await entregar(retirada, retiradaNumero, corpoEntrega([qtd(granel, '1.625', '0.375'), qtd(pacote, '1')]))).status, 422);
  assert.equal((await entregar(retirada, retiradaNumero, corpoEntrega([qtd(granel, '2.001'), qtd(pacote, '1')]))).status, 422);
  assert.equal((await entregar(retirada, retiradaNumero, corpoEntrega([qtd(granel, '2'), qtd(pacote, '0.5', '0.5', { motivo: 'Teste' })]))).status, 422);
  const tentativas = await Promise.all([
    entregar(retirada, retiradaNumero, recebimento, balcao),
    entregar(retirada, retiradaNumero, recebimento, balcao),
  ]);
  assert.deepEqual(tentativas.map((r) => r.status).sort(), [200, 201]);
  const [c1, c2] = await Promise.all(tentativas.map((r) => r.json()));
  assert.deepEqual(c1, c2);
  assert.equal((await entregar(retirada, retiradaNumero, { ...recebimento, itens: [...recebimento.itens].reverse() }, balcao)).status, 200);
  assert.equal((await entregar(retirada, retiradaNumero, corpoEntrega(recebimento.itens), gerente)).status, 409);
  assert.equal((await entregar(retirada, retiradaNumero, { ...recebimento, itens: [qtd(granel, '2'), qtd(pacote, '1')] }, balcao)).status, 409);
  const entrega = await consultarEntregas(retirada);
  assert.deepEqual(entrega.itens.map(({ despachada, recebida, recusada, emTransito, pendenteDespacho }) =>
    [despachada, recebida, recusada, emTransito, pendenteDespacho]), [
    ['1', '1', '0', '0', '0'], ['2.000', '1.625', '0.375', '0.000', '0.750'],
  ]);
  const historico = entrega.remessas[0].recebimento;
  assert.equal(historico.responsavel, 'Operador fictício (balcao)');
  assert.equal(historico.confirmadoEm, agora);
  assert.deepEqual(historico.itens[1], {
    apresentacaoId: granel, recebida: '1.625', recusada: '0.375', motivo: 'Embalagem avariada',
    repor: true, subtotalCentavos: 3047,
  });
  assert.deepEqual(await saldo(granel), saldosAntes, 'A confirmação não devolve nem baixa estoque.');
  await receber(granel, [{ codigo: 'G01', validade: '2026-12-20', quantidade: '0.375' }]);
  const reposicao = await expedir(retirada, corpoSaida([linha(g.loteId, '0.750')], 'retirada'));
  assert.equal(reposicao.status, 201);
  assert.equal((await entregar(retirada, (await reposicao.json()).numero, corpoEntrega([qtd(granel, '0.750')]))).status, 201);
  assert.deepEqual((await consultarEntregas(retirada)).itens.map(({ recebida, pendenteRecebimento }) =>
    [recebida, pendenteRecebimento]), [['1', '0'], ['2.375', '0.000']]);

  const seisEntregues = { ...corpoEntrega([qtd(pacote, '6')]), conferencia: 'sem_ressalvas' };
  assert.equal((await entregar(primeiro, confirmada.numero, seisEntregues, balcao)).status, 403);
  assert.equal((await entregar(primeiro, confirmada.numero, corpoEntrega(seisEntregues.itens))).status, 422);
  assert.equal((await entregar(primeiro, confirmada.numero, {
    ...seisEntregues, itens: [qtd(pacote, '5', '1', { motivo: 'Ressalva' })],
  })).status, 422);
  assert.equal((await entregar(primeiro, confirmada.numero, seisEntregues)).status, 201);
  const parcial = (await consultarEntregas(primeiro)).itens[0];
  assert.equal(parcial.recebida, '6');
  assert.equal(parcial.pendenteRecebimento, '4');

  await t.test('aprovação de correção e saída física disputam o mesmo saldo vigente', async () => {
    const pedido = await vender([item(pacote, '10')]);
    await receber(pacote, [{ codigo: 'CORR-A', validade: '2026-12-20', quantidade: '6' }]);
    const lote = (await consultar(pedido)).itens[0].lotes.find(({ codigo }) => codigo === 'CORR-A');
    const campo = `/pedidos/campo/${pedido}/correcoes`;
    const r = await request(campo, { ...vendedor, body: {
      correcaoId: randomUUID(), motivo: 'Cliente confirmou duas unidades', itens: [item(pacote, '2')],
    } });
    assert.equal(r.status, 201);
    const { numero } = await r.json();
    const [aprovacao, saida] = await Promise.all([
      request(`/pedidos/${pedido}/correcoes/${numero}/aprovacao`, { ...gerente, body: {} }),
      expedir(pedido, corpoSaida([linha(lote.loteId, '6')])),
    ]);
    const vigente = (await consultar(pedido)).itens[0];
    if (aprovacao.status === 200) {
      assert.equal(saida.status, 409);
      assert.equal(vigente.pedida, '2');
      assert.equal(vigente.despachada, '0');
    } else {
      assert.equal(aprovacao.status, 409);
      assert.equal(saida.status, 201);
      assert.equal(vigente.pedida, '10');
      assert.equal(vigente.despachada, '6');
    }
  });

  await t.test('cancelamento maior que a proposta impede aprová-la e permite outra correção válida', async () => {
    const pedido = await vender([item(pacote, '10')]);
    const campo = `/pedidos/campo/${pedido}/correcoes`;
    const correcoes = `/pedidos/${pedido}/correcoes`;
    const solicitar = (quantidade) => request(campo, { ...vendedor, body: {
      correcaoId: randomUUID(), motivo: 'Ajuste de venda', itens: [item(pacote, quantidade)],
    } });
    const primeira = await solicitar('2');
    assert.equal(primeira.status, 201);
    const { numero } = await primeira.json();
    const cancelamento = await request(`/pedidos/${pedido}/cancelamentos`, { ...gerente, body: {
      cancelamentoId: randomUUID(), motivo: 'O cliente dispensou três', itens: [{ apresentacaoId: pacote, quantidade: '3' }],
    } });
    assert.equal(cancelamento.status, 201);
    assert.equal((await request(`${correcoes}/${numero}/aprovacao`, { ...gerente, body: {} })).status, 409);
    const { correcoes: registros, podeSolicitar } = await (await request(campo, vendedor)).json();
    assert.equal(registros[0].situacao, 'impedida');
    assert.equal(podeSolicitar, true);
    const fila = await (await request('/pedidos', gerente)).json();
    assert.equal(fila.pedidos.find((p) => p.numero === pedido).correcaoPendente, false);
    assert.equal((await solicitar('2')).status, 409);
    const segunda = await solicitar('8');
    assert.equal(segunda.status, 201);
    const { numero: nova } = await segunda.json();
    assert.equal((await request(`${correcoes}/${nova}/aprovacao`, { ...gerente, body: {} })).status, 200);
    assert.equal((await consultar(pedido)).itens[0].pendente, '5');
  });

  await t.test('gerente cancela só o saldo dispensado e finaliza a entrega parcial sem mover estoque', async () => {
    const pedido = await vender([item(pacote, '10')]);
    await receber(pacote, [{ codigo: 'CANC-A', validade: '2026-12-20', quantidade: '12' }]);
    const lote = (await consultar(pedido)).itens[0].lotes.find(({ codigo }) => codigo === 'CANC-A');
    const r = await expedir(pedido, corpoSaida([linha(lote.loteId, '6')]));
    assert.equal(r.status, 201);
    assert.equal((await entregar(pedido, (await r.json()).numero, corpoEntrega([qtd(pacote, '6')]))).status, 201);
    const antes = await saldo();
    const corpo = (quantidade) => ({
      cancelamentoId: randomUUID(), motivo: 'Cliente dispensou o saldo', itens: [{ apresentacaoId: pacote, quantidade }],
    });
    const cancelar = (body, acesso = gerente) => request(`/pedidos/${pedido}/cancelamentos`, { ...acesso, body });
    const dois = corpo('2');
    assert.equal((await cancelar(dois, operador)).status, 403);
    assert.equal((await cancelar(dois, vendedor)).status, 403);
    assert.equal((await cancelar(corpo('5'))).status, 409);
    assert.equal((await cancelar(corpo('0.5'))).status, 422);
    assert.equal((await cancelar({ ...dois, motivo: ' ' })).status, 400);
    const primeiro = await cancelar(dois);
    assert.equal(primeiro.status, 201);
    const recuperado = await cancelar(dois);
    assert.equal(recuperado.status, 200);
    assert.deepEqual(await recuperado.json(), await primeiro.json());
    assert.equal((await consultar(pedido)).itens[0].pendente, '2');
    assert.equal((await expedir(pedido, corpoSaida([linha(lote.loteId, '3')]))).status, 409);
    const disputa = await Promise.all([cancelar(corpo('2')), cancelar(corpo('2'))]);
    assert.deepEqual(disputa.map((resposta) => resposta.status).sort(), [201, 409]);
    const registrado = await consultarEntregas(pedido);
    assert.equal(registrado.situacao, 'finalizado_entrega_parcial');
    const [itemFinal] = registrado.itens;
    assert.deepEqual([itemFinal.pedida, itemFinal.recebida, itemFinal.cancelada, itemFinal.pendenteDespacho, itemFinal.pendenteRecebimento],
      ['10', '6', '4', '0', '0']);
    assert.equal(registrado.cancelamentos.length, 2);
    assert.deepEqual(registrado.cancelamentos.map(({ responsavel, motivo, autorizadoEm }) => [responsavel, motivo, autorizadoEm]), [
      ['Operador fictício (gerente)', dois.motivo, agora], ['Operador fictício (gerente)', dois.motivo, agora],
    ]);
    const doVendedor = await request(`/pedidos/campo/${pedido}/entregas`, vendedor);
    assert.equal(doVendedor.status, 200);
    const resumo = await doVendedor.json();
    assert.equal(resumo.situacao, 'finalizado_entrega_parcial');
    assert.equal(resumo.itens[0].cancelada, '4');
    assert.equal('cancelamentos' in resumo, false);
    assert.deepEqual(await saldo(), antes);
  });

  await t.test('o retorno da entrega repõe só os aptos e preserva a quantidade recebida', async () => {
    const pedido = await vender([item(pacote, '10')]);
    await receber(pacote, [
      { codigo: 'DEV-A', validade: '2026-12-12', quantidade: '2' },
      { codigo: 'DEV-B', validade: '2026-12-20', quantidade: '4' },
    ]);
    const disponiveis = (await consultar(pedido)).itens[0].lotes;
    const loteA = disponiveis.find(({ codigo }) => codigo === 'DEV-A');
    const loteB = disponiveis.find(({ codigo }) => codigo === 'DEV-B');
    const r = await expedir(pedido, corpoSaida([linha(loteA.loteId, '2'), linha(loteB.loteId, '4')]));
    assert.equal(r.status, 201);
    const { numero: remessa } = await r.json();
    const mov = (loteId, apta, descartada = '0', motivo) => ({ loteId, apta, descartada, ...(motivo && { motivo }) });
    const dados = (lotes, origem = 'apos_recebimento') => ({ devolucaoId: randomUUID(), origem, lotes });
    const rotaDevolucao = `/pedidos/${pedido}/saidas/${remessa}/devolucoes`;
    const devolver = (body, acesso = operador) => request(rotaDevolucao, { ...acesso, body });
    const dois = dados([mov(loteA.loteId, '1'), mov(loteB.loteId, '0', '1', 'Embalagem rasgada')]);
    assert.equal((await devolver(dois)).status, 409, 'Despacho sem recebimento não permite retorno neste fluxo.');
    const recebido = await entregar(pedido, remessa, corpoEntrega([qtd(pacote, '6')]));
    assert.equal(recebido.status, 201);
    const { numero: recebimentoNumero } = await recebido.json();
    assert.equal((await devolver(dois, balcao)).status, 403);
    assert.equal((await devolver(dois, vendedor)).status, 403);
    assert.equal((await devolver(dados([mov(loteA.loteId, '1')], 'recusa'))).status, 409);
    assert.equal((await devolver(dados([mov(loteA.loteId, '1'), mov(loteB.loteId, '0', '1')]))).status, 422);
    assert.equal((await devolver(dados([mov(b.loteId, '1')]))).status, 422, 'Lote de outra remessa não volta neste pedido.');
    const saldoAntes = await saldo();
    const resultado = await devolver(dois);
    assert.equal(resultado.status, 201);
    const confirmacao = await resultado.json();
    const repetido = await devolver({ ...dois, lotes: [...dois.lotes].reverse() });
    assert.equal(repetido.status, 200);
    assert.deepEqual(await repetido.json(), confirmacao);
    assert.equal((await devolver({ ...dois, lotes: [mov(loteA.loteId, '1')] })).status, 409);
    const estoqueApos = await saldo();
    assert.equal(Number(estoqueApos.totalDisponivel) - Number(saldoAntes.totalDisponivel), 1);
    assert.equal(Number(estoqueApos.totalFisico) - Number(saldoAntes.totalFisico), 1);
    const consultarDevolucoes = async () => {
      const resposta = await request(rotaDevolucao, operador);
      assert.equal(resposta.status, 200);
      return resposta.json();
    };
    assert.equal((await consultarDevolucoes()).recebimentoNumero, recebimentoNumero);
    const [historico] = (await consultarDevolucoes()).devolucoes;
    assert.equal(historico.registradaEm, agora);
    assert.equal(historico.responsavel, 'Operador fictício (estoque)');
    assert.deepEqual(historico.lotes.map(({ codigo, apta, descartada, motivo }) => [codigo, apta, descartada, motivo]), [
      ['DEV-A', '1', '0', null], ['DEV-B', '0', '1', 'Embalagem rasgada'],
    ]);
    assert.equal((await consultarEntregas(pedido)).itens[0].recebida, '6');

    agora = '2026-12-13T03:00:00.000Z';
    assert.equal((await devolver(dados([mov(loteA.loteId, '1')]))).status, 422, 'Lote vencido não volta para venda.');
    assert.equal((await devolver(dados([mov(loteA.loteId, '0', '1', 'Vencido')]))).status, 201);
    const disputaDevolucao = await Promise.all([
      devolver(dados([mov(loteB.loteId, '3')])),
      devolver(dados([mov(loteB.loteId, '3')]), gerente),
    ]);
    assert.deepEqual(disputaDevolucao.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await consultarDevolucoes()).devolucoes.length, 3);

    const recusadaAntes = await saldo(granel);
    const rotaRecusa = `/pedidos/${retirada}/saidas/${retiradaNumero}/devolucoes`;
    const retornoRecusado = await request(rotaRecusa, {
      ...operador, body: dados([mov(g.loteId, '0.375')], 'recusa'),
    });
    assert.equal(retornoRecusado.status, 201);
    const recusadaDepois = await saldo(granel);
    assert.equal(Number(recusadaDepois.totalDisponivel) - Number(recusadaAntes.totalDisponivel), 0.375);
  });
});
