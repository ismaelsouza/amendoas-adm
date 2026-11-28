import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createPool } from 'mariadb';
import { createApp } from '../dist/server/app.js';
import { initDb } from '../dist/server/db/init.js';
import { seedPilot } from '../dist/server/db/pilot.js';

test('fila recupera a confirmação de um envio repetido e separa duas vendas iguais', async (t) => {
  const testUrl = URL.parse(process.env.TEST_DATABASE_URL ?? '');
  if (testUrl?.protocol !== 'mariadb:' || testUrl.pathname !== '/amendoas_test') {
    throw new Error('Configure TEST_DATABASE_URL para o banco de testes amendoas_test.');
  }
  const db = createPool(testUrl.href);
  t.after(() => db.end());
  const [banco] = await db.query('SELECT DATABASE() AS nome');
  assert.equal(banco?.nome, 'amendoas_test', 'A conexão deve selecionar o banco de testes.');
  const password = randomBytes(24).toString('base64url');
  await initDb(db);
  await seedPilot(db, password, { resetPilotPasswords: true });

  async function start() {
    const server = createApp(db, { secureCookie: false }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    return { server, url: `http://127.0.0.1:${server.address().port}/api/v1` };
  }

  let { server, url } = await start();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  function request(path, { cookie, token, body, method } = {}) {
    return fetch(url + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(cookie && { Cookie: cookie }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  async function login(channel, login) {
    const response = await request(`/sessao/${channel}`, { body: { login, senha: password } });
    assert.equal(response.status, 200);
    if (channel === 'app') return (await response.json()).token;
    return response.headers.get('set-cookie').split(';', 1)[0];
  }

  const token = await login('app', 'vendedor.piloto');
  const cookie = await login('web', 'admin.piloto');
  const estoque = await login('web', 'estoque.piloto');
  const atendente = await login('web', 'balcao.piloto');
  const venda = {
    vendaId: randomUUID(),
    clienteId: 1,
    fechadoEm: '2026-11-25T18:00:00.000Z',
    itens: [{ apresentacaoId: 1, quantidade: '10', precoUnitarioCentavos: 1875 }],
  };

  const paginaInicial = await fetch(new URL('/', url));
  assert.equal(paginaInicial.status, 200);
  assert.match(await paginaInicial.text(), /Casa das Amêndoas/);
  assert.equal((await request('/pedidos')).status, 401);
  assert.equal((await request('/pedidos/campo', {
    token, body: { ...venda, fechadoEm: '2026-02-30T18:00:00.000Z' },
  })).status, 400);
  assert.equal((await request('/pedidos', { token })).status, 403);
  assert.equal((await request('/usuarios', { cookie: estoque })).status, 403);
  const novoVendedor = { nome: 'Bruno, vendedor fictício', login: 'vendedor.' + randomBytes(8).toString('hex'), perfil: 'vendedor', senha: password };
  assert.equal((await request('/usuarios', { cookie: estoque, body: novoVendedor })).status, 403);
  const criado = await request('/usuarios', { cookie, body: novoVendedor });
  assert.equal(criado.status, 201);
  const segundoVendedor = await criado.json();
  assert.equal(Object.hasOwn(segundoVendedor, 'senha'), false);
  const outroToken = await login('app', segundoVendedor.login);
  assert.equal((await request('/pedidos/campo', { cookie, body: venda })).status, 403);

  const respostas = await Promise.all([
    request('/pedidos/campo', { token, body: venda }),
    request('/pedidos/campo', { token, body: venda }),
  ]);
  assert.deepEqual(respostas.map((resposta) => resposta.status).sort(), [200, 201]);
  const [gravado, reenvio] = await Promise.all(respostas.map((resposta) => resposta.json()));
  assert.deepEqual(gravado, reenvio);
  assert.equal(gravado.vendaId, venda.vendaId);

  const detalhe = await request('/pedidos/campo/' + gravado.numero, { token });
  assert.equal(detalhe.status, 200);
  assert.equal((await detalhe.json()).numero, gravado.numero);
  assert.equal((await request('/pedidos/campo/' + gravado.numero, { token: outroToken })).status, 404);
  const vendaDoSegundo = await request('/pedidos/campo', { token: outroToken, body: venda });
  assert.equal(vendaDoSegundo.status, 201);
  const confirmacaoDoSegundo = await vendaDoSegundo.json();
  assert.notEqual(confirmacaoDoSegundo.numero, gravado.numero);
  assert.equal((await request('/pedidos/campo/' + confirmacaoDoSegundo.numero, { token: outroToken })).status, 200);
  assert.equal((await request('/pedidos/campo/' + confirmacaoDoSegundo.numero, { token })).status, 404);

  const rotaUsuario = '/usuarios/' + segundoVendedor.id;
  const alteracao = { nome: segundoVendedor.nome, login: segundoVendedor.login, perfil: 'estoque' };
  assert.equal((await request(rotaUsuario, { cookie: estoque, method: 'PATCH', body: alteracao })).status, 403);
  const atualizado = await request(rotaUsuario, { cookie, method: 'PATCH', body: alteracao });
  assert.equal(atualizado.status, 200);
  assert.equal((await atualizado.json()).perfil, 'estoque');
  assert.equal((await request('/pedidos/campo/' + gravado.numero, { token: outroToken })).status, 401);
  const novoAcesso = await login('web', segundoVendedor.login);
  assert.equal((await request('/usuarios', { cookie: novoAcesso })).status, 403);

  const alterada = { ...venda, itens: [{ ...venda.itens[0], quantidade: '11' }] };
  assert.equal((await request('/pedidos/campo', { token, body: alterada })).status, 409);

  const invalida = { ...venda, vendaId: randomUUID(), itens: [{ ...venda.itens[0], quantidade: '1.5' }] };
  assert.equal((await request('/pedidos/campo', { token, body: invalida })).status, 422);
  const corrigida = { ...invalida, itens: venda.itens };
  assert.equal((await request('/pedidos/campo', { token, body: corrigida })).status, 201);

  const outraVenda = { ...venda, vendaId: randomUUID() };
  const outro = await request('/pedidos/campo', { token, body: outraVenda });
  assert.equal(outro.status, 201);
  assert.notEqual((await outro.json()).numero, gravado.numero);

  const retirada = { ...venda, vendaId: randomUUID(), retiradaImediata: true };
  assert.equal((await request('/pedidos/balcao', { cookie: estoque, body: retirada })).status, 403);
  assert.equal((await request('/pedidos/balcao', {
    cookie: atendente,
    body: { ...retirada, itens: [{ ...retirada.itens[0], precoUnitarioCentavos: 1 }] },
  })).status, 422);
  const balcao = await request('/pedidos/balcao', { cookie: atendente, body: retirada });
  assert.equal(balcao.status, 201);
  const confirmacaoBalcao = await balcao.json();

  const perdida = { ...venda, vendaId: randomUUID() };
  let comprometido;
  const proxy = createServer(async (req) => {
    req.resume();
    const gravacao = await request('/pedidos/campo', { token, body: perdida });
    comprometido = { status: gravacao.status, ...await gravacao.json() };
    req.socket.destroy();
  }).listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  try {
    await assert.rejects(fetch('http://127.0.0.1:' + proxy.address().port, { method: 'POST' }));
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
  }
  assert.equal(comprometido?.status, 201);

  await new Promise((resolve) => server.close(resolve));
  ({ server, url } = await start());
  const restaurado = await request('/pedidos/campo', { token, body: venda });
  assert.equal(restaurado.status, 200);
  assert.deepEqual(await restaurado.json(), gravado);
  const recuperada = await request('/pedidos/campo', { token, body: perdida });
  assert.equal(recuperada.status, 200);
  assert.deepEqual(await recuperada.json(), { numero: comprometido.numero, vendaId: perdida.vendaId });

  const fila = await request('/pedidos', { cookie });
  assert.equal(fila.status, 200);
  const { pedidos } = await fila.json();
  const campo = pedidos.filter((pedido) => pedido.numero === gravado.numero);
  assert.equal(campo.length, 1);
  assert.equal(campo[0].origem, 'campo');
  assert.equal(campo[0].itens[0].quantidade, '10');
  assert.equal(campo[0].itens[0].precoUnitarioCentavos, 1875);
  assert.equal(pedidos.filter((pedido) => pedido.numero === comprometido.numero).length, 1);
  assert.equal(pedidos.find((pedido) => pedido.numero === confirmacaoBalcao.numero).retiradaImediata, true);
});
