import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPool } from 'mariadb';
import { parse } from 'valibot';
import { catalogoProdutosSchema } from '../dist/contracts/catalogo.js';
import { createApp } from '../dist/server/app.js';
import { initDb } from '../dist/server/db/init.js';
import { seedPilot } from '../dist/server/db/pilot.js';

test('cadastro de produto reaproveita o catálogo dos três fluxos e preserva as apresentações legadas', async (t) => {
  const url = URL.parse(process.env.TEST_DATABASE_URL ?? '');
  assert.equal(url?.protocol, 'mariadb:');
  assert.equal(url.pathname, '/amendoas_test');
  const db = createPool(url.href);
  t.after(() => db.end());
  const [banco] = await db.query('SELECT DATABASE() AS nome');
  assert.equal(banco?.nome, 'amendoas_test');
  await initDb(db);
  const senha = randomBytes(24).toString('base64url');
  await seedPilot(db, senha, { resetPilotPasswords: true });
  const server = createApp(db, { secureCookie: false }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const request = (rota, { credencial, body } = {}) => fetch(base + rota, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...credencial, ...(body && { 'Content-Type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  async function login(canal, usuario) {
    const resposta = await request(`/sessao/${canal}`, { body: { login: usuario, senha } });
    assert.equal(resposta.status, 200);
    return canal === 'web'
      ? { Cookie: resposta.headers.get('set-cookie').split(';')[0] }
      : { Authorization: `Bearer ${(await resposta.json()).token}` };
  }
  const admin = await login('web', 'admin.piloto');
  const estoque = await login('web', 'estoque.piloto');
  const vendedor = await login('app', 'vendedor.piloto');
  const nome = 'Castanha de teste ' + randomBytes(6).toString('hex');
  const legado = [];
  for (const unidade of ['pacote', 'caixa']) {
    const { insertId } = await db.query(
      'INSERT INTO apresentacoes (apresentacao, unidade, preco_padrao_centavos) VALUES (?, ?, ?)',
      [nome, unidade, 1835],
    );
    legado.push(Number(insertId));
  }
  const venda = await request('/pedidos/balcao', { credencial: admin, body: {
    vendaId: randomUUID(), clienteId: 1, fechadoEm: new Date().toISOString(), retiradaImediata: false,
    itens: [{ apresentacaoId: legado[0], quantidade: '2', precoUnitarioCentavos: 1835 }],
  } });
  assert.equal(venda.status, 201);
  const { numero } = await venda.json();
  const entrada = await request('/estoque/entradas', { credencial: estoque, body: {
    entradaId: randomUUID(), apresentacaoId: legado[0],
    lotes: [{ codigo: 'LOTE-FICTICIO', validade: '2099-12-31', quantidade: '5' }],
  } });
  assert.equal(entrada.status, 201);
  await db.query('INSERT INTO precos_clientes (cliente_id, apresentacao_id, preco_centavos) VALUES (?, ?, ?)',
    [1, legado[0], 1700]);
  await initDb(db);

  async function listar() {
    const resposta = await request('/produtos', { credencial: admin });
    assert.equal(resposta.status, 200);
    return parse(catalogoProdutosSchema, await resposta.json()).produtos;
  }
  const migrados = (await listar()).filter((produto) => produto.nome === nome);
  assert.equal(migrados.length, 2);
  assert.deepEqual(migrados.flatMap((produto) => produto.apresentacoes.map((item) => item.id)).sort((a, b) => a - b), legado);
  assert(migrados.every((produto) => produto.apresentacoes[0].precoPadraoCentavos === 1835));
  await initDb(db);
  assert.deepEqual((await listar()).filter((produto) => produto.nome === nome), migrados);

  const body = {
    cadastroId: randomUUID(), nome,
    apresentacao: { nome: `${nome} a granel`, unidade: 'kg', precoPadraoCentavos: 2988 },
  };
  assert.equal((await request('/produtos', { body })).status, 401);
  assert.equal((await request('/produtos', { credencial: estoque })).status, 403);
  assert.equal((await request('/produtos', { credencial: estoque, body })).status, 403);
  assert.equal((await request('/produtos', { credencial: vendedor, body })).status, 403);
  assert.equal((await request('/produtos', { credencial: admin, body: { ...body, apresentacao: {
    ...body.apresentacao, precoPadraoCentavos: -1,
  } } })).status, 400);
  const respostas = await Promise.all([request('/produtos', { credencial: admin, body }), request('/produtos', { credencial: admin, body })]);
  assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 201]);
  const [primeiro, segundo] = await Promise.all(respostas.map((r) => r.json()));
  assert.deepEqual(primeiro, segundo);
  assert.equal((await request('/produtos', { credencial: admin, body: { ...body, nome: 'Outro cadastro' } })).status, 409);
  await initDb(db);
  const produtos = (await listar()).filter((produto) => produto.nome === nome);
  assert.equal(produtos.length, 3);
  const novo = produtos.find((produto) => produto.id === primeiro.id);
  assert.equal(novo.apresentacoes.length, 1);
  const [{ id: apresentacaoId, ...apresentacao }] = novo.apresentacoes;
  assert.deepEqual(apresentacao, body.apresentacao);
  for (const [rota, credencial] of [
    ['/cadastros/balcao', admin], ['/estoque/apresentacoes', estoque], ['/cadastros/campo/catalogo', vendedor],
  ]) {
    const resultado = await request(rota, { credencial });
    assert.equal(resultado.status, 200);
    assert.equal((await resultado.json()).apresentacoes.find((item) => item.id === apresentacaoId)?.apresentacao, apresentacao.nome);
  }
  const saldo = await request(`/estoque/saldos/${apresentacaoId}`, { credencial: estoque });
  assert.equal(saldo.status, 200);
  assert.equal(Number((await saldo.json()).totalFisico), 0);
  const saldoLegado = await request(`/estoque/saldos/${legado[0]}`, { credencial: estoque });
  assert.equal(saldoLegado.status, 200);
  assert.equal(Number((await saldoLegado.json()).totalFisico), 5);
  const cotacao = await request('/cadastros/campo/cliente?id=1', { credencial: vendedor });
  assert.equal(cotacao.status, 200);
  assert.equal((await cotacao.json()).apresentacoes.find((item) => item.id === legado[0])?.precoNegociadoCentavos, 1700);
  const fila = await request('/pedidos', { credencial: admin });
  assert.equal(fila.status, 200);
  const pedido = (await fila.json()).pedidos.find((item) => item.numero === numero);
  assert.equal(pedido.itens[0].apresentacaoId, legado[0]);
  assert.equal(pedido.itens[0].precoUnitarioCentavos, 1835);
});
