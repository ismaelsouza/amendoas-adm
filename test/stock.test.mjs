import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPool } from 'mariadb';
import { createApp } from '../dist/server/app.js';
import { initDb } from '../dist/server/db/init.js';
import { hashPassword } from '../dist/server/password.js';

test('estoque recebe por lote, preserva histórico e separa o saldo vencido', async (t) => {
  const url = URL.parse(process.env.TEST_DATABASE_URL ?? '');
  if (url?.protocol !== 'mariadb:' || url.pathname !== '/amendoas_test') {
    throw new Error('Configure TEST_DATABASE_URL para o banco de testes amendoas_test.');
  }
  const db = createPool(url.href);
  t.after(() => db.end());
  const [banco] = await db.query('SELECT DATABASE() AS nome');
  assert.equal(banco?.nome, 'amendoas_test');
  await initDb(db);
  const pacote = randomInt(1_000_000, 10_000_000);
  const granel = pacote + 1;
  await db.query(`INSERT INTO apresentacoes (id, apresentacao, unidade, preco_padrao_centavos)
    VALUES (?, 'Castanha em pacote', 'pacote', 1875), (?, 'Castanha a granel', 'kg', 2988)`, [pacote, granel]);
  const senha = randomBytes(24).toString('base64url');
  const hash = await hashPassword(senha);
  const sufixo = randomBytes(6).toString('hex');
  let agora = '2026-12-21T00:30:00.000Z'; // Ainda dia 20 em Belém.
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
    const nome = `Operador fictício (${perfil})`;
    await db.query('INSERT INTO usuarios (nome, login, perfil, senha_hash) VALUES (?, ?, ?, ?)', [nome, login, perfil, hash]);
    const sessao = await request(`/sessao/${canal}`, { body: { login, senha } });
    assert.equal(sessao.status, 200);
    return canal === 'web' ? { cookie: sessao.headers.get('set-cookie').split(';', 1)[0] } : {
      token: (await sessao.json()).token,
    };
  }
  const estoque = await entrar('estoque');
  const gerente = await entrar('gerente');
  const admin = await entrar('administrador');
  const balcao = await entrar('balcao');
  const vendedor = await entrar('vendedor', 'app');
  const entradas = '/estoque/entradas';
  const saldoPacote = `/estoque/saldos/${pacote}`;
  const saldoGranel = `/estoque/saldos/${granel}`;
  const lotes = [
    { codigo: 'A17', validade: '2026-12-20', quantidade: '5' },
    { codigo: 'B24', validade: '2026-12-20', quantidade: '7' },
    { codigo: 'C30', validade: '2026-12-19', quantidade: '3' },
  ];
  const entrada = { entradaId: randomUUID(), apresentacaoId: pacote, lotes };
  const receber = (body, acesso = estoque) => request(entradas, { ...acesso, body });
  const saldos = async (rota, acesso = estoque) => {
    const resposta = await request(rota, acesso);
    assert.equal(resposta.status, 200);
    return resposta.json();
  };

  assert.equal((await receber(entrada, {})).status, 401);
  assert.equal((await receber(entrada, balcao)).status, 403);
  assert.equal((await receber(entrada, vendedor)).status, 403);
  assert.equal((await request(saldoPacote, balcao)).status, 403);
  assert.equal((await request('/estoque/apresentacoes', vendedor)).status, 403);
  const catalogo = await request('/estoque/apresentacoes', estoque);
  assert.equal(catalogo.status, 200);
  assert.ok((await catalogo.json()).apresentacoes.some(({ id, unidade }) => id === granel && unidade === 'kg'));
  assert.deepEqual(await saldos(saldoPacote), { totalFisico: '0', totalDisponivel: '0', validades: [] });

  function somenteLotes(linhas) {
    return { ...entrada, entradaId: randomUUID(), lotes: linhas };
  }
  assert.equal((await receber(somenteLotes([lotes[0], { ...lotes[1], quantidade: '0.5' }]))).status, 422);
  assert.equal((await receber(somenteLotes([{ ...lotes[0], validade: '2026-02-30' }]))).status, 400);
  assert.equal((await receber(somenteLotes([{ ...lotes[0], codigo: ' ' }]))).status, 400);
  assert.equal((await receber(somenteLotes([lotes[0], lotes[0]]))).status, 400);
  assert.equal((await receber({ ...entrada, apresentacaoId: 4_294_967_295 })).status, 422);
  assert.deepEqual(await saldos(saldoPacote), { totalFisico: '0', totalDisponivel: '0', validades: [] });

  const respostas = await Promise.all([receber(entrada), receber({ ...entrada, lotes: [...lotes].reverse() })]);
  assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 201]);
  const [confirmada, repetida] = await Promise.all(respostas.map((r) => r.json()));
  assert.deepEqual(confirmada, repetida);
  assert.equal(confirmada.entradaId, entrada.entradaId);
  assert.equal((await receber({ ...entrada, lotes: [{ ...lotes[0], quantidade: '6' }] })).status, 409);

  const detalhe = `${entradas}/${confirmada.numero}`;
  assert.equal((await request(detalhe, balcao)).status, 403);
  assert.equal((await request(`${entradas}/4294967295`, admin)).status, 404);
  const historico = await request(detalhe, admin);
  assert.equal(historico.status, 200);
  assert.deepEqual(await historico.json(), {
    numero: confirmada.numero, apresentacaoId: pacote, apresentacao: 'Castanha em pacote', unidade: 'pacote',
    responsavel: 'Operador fictício (estoque)', recebidoEm: agora, lotes: [lotes[2], lotes[0], lotes[1]],
  });
  assert.deepEqual(await saldos(saldoPacote, gerente), {
    totalFisico: '15', totalDisponivel: '12',
    validades: [
      { validade: '2026-12-19', fisico: '3', disponivel: '0', vencida: true },
      { validade: '2026-12-20', fisico: '12', disponivel: '12', vencida: false },
    ],
  });

  const maisPacotes = () => somenteLotes([{ ...lotes[0], quantidade: '2' }]);
  const novas = await Promise.all([receber(maisPacotes(), gerente), receber(maisPacotes(), admin)]);
  assert.deepEqual(novas.map((r) => r.status), [201, 201]);
  assert.equal((await saldos(saldoPacote)).totalDisponivel, '16');
  assert.deepEqual((await (await request(detalhe, estoque)).json()).lotes, [lotes[2], lotes[0], lotes[1]]);
  agora = '2026-12-21T03:00:00.000Z';
  const diaSeguinte = await saldos(saldoPacote);
  assert.equal(diaSeguinte.totalFisico, '19');
  assert.equal(diaSeguinte.totalDisponivel, '0');
  assert.ok(diaSeguinte.validades.every((grupo) => grupo.vencida));

  const lotesGranel = [
    { codigo: 'X12', validade: '2026-12-23', quantidade: '4.250' },
    { codigo: 'Y20', validade: '2026-12-26', quantidade: '5.750' },
  ];
  assert.equal((await receber({ entradaId: randomUUID(), apresentacaoId: granel, lotes: lotesGranel })).status, 201);
  assert.deepEqual(await saldos(saldoGranel), {
    totalFisico: '10.000', totalDisponivel: '10.000',
    validades: [
      { validade: '2026-12-23', fisico: '4.250', disponivel: '4.250', vencida: false },
      { validade: '2026-12-26', fisico: '5.750', disponivel: '5.750', vencida: false },
    ],
  });
});
