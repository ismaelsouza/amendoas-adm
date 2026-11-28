import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPool } from 'mariadb';
import { createApp } from '../dist/server/app.js';
import { initDb } from '../dist/server/db/init.js';
import { seedPilot } from '../dist/server/db/pilot.js';
import { configurarRecaptcha } from '../dist/server/recaptcha.js';

const env = {
  RECAPTCHA_SITE_KEY: 'site_ficticio',
  RECAPTCHA_SECRET_KEY: 'segredo_ficticio',
  RECAPTCHA_HOSTNAMES: 'adm.example.test,localhost',
  RECAPTCHA_MIN_SCORE: '0.7',
};

test('só permite desabilitar reCAPTCHA quando nenhuma configuração está preenchida', () => {
  assert.equal(configurarRecaptcha({}), null);
  for (const incompleta of [
    { RECAPTCHA_SITE_KEY: 'site_ficticio' },
    { RECAPTCHA_HOSTNAMES: ',' },
    { ...env, RECAPTCHA_SECRET_KEY: '' },
    { ...env, RECAPTCHA_HOSTNAMES: 'https://adm.example.test' },
    { ...env, RECAPTCHA_MIN_SCORE: '1.1' },
  ]) {
    assert.equal(configurarRecaptcha(incompleta), 'invalida');
  }
});

test('valida reCAPTCHA antes de abrir sessão web, preservando o login do app e o limite de tentativas', async (t) => {
  const url = URL.parse(process.env.TEST_DATABASE_URL ?? '');
  assert.equal(url?.protocol, 'mariadb:');
  assert.equal(url.pathname, '/amendoas_test');
  const db = createPool(url.href);
  t.after(() => db.end());
  const [banco] = await db.query('SELECT DATABASE() AS nome');
  assert.equal(banco?.nome, 'amendoas_test');
  const senha = randomBytes(24).toString('base64url');
  await initDb(db);
  await seedPilot(db, senha, { resetPilotPasswords: true });

  const usados = new Set();
  const sucesso = { success: true, hostname: 'adm.example.test', action: 'login_adm', score: 0.7 };
  const recaptcha = configurarRecaptcha(env, async (url, { method, body }) => {
    if (url !== 'https://www.google.com/recaptcha/api/siteverify' || method !== 'POST'
      || body.get('secret') !== env.RECAPTCHA_SECRET_KEY) return new Response(null, { status: 400 });
    const token = body.get('response');
    if (token === 'falha') throw new Error('Provedor inacessível');
    if (token === 'quota') return Response.json({ ...sucesso, score: 0.9, 'error-codes': ['Over free quota.'] });
    if (token === 'malformado') return Response.json({ success: 'true' });
    if (usados.has(token) || token === 'expirado') {
      return Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    }
    usados.add(token);
    if (token === 'invalido') return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
    if (token === 'dominio') return Response.json({ ...sucesso, hostname: 'externo.example.test' });
    if (token === 'acao') return Response.json({ ...sucesso, action: 'cadastro' });
    if (token === 'score') return Response.json({ ...sucesso, score: 0.6 });
    return Response.json(sucesso);
  });

  const server = createApp(db, { secureCookie: true, recaptcha }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const entrar = (canal, dados) => fetch(`${base}/sessao/${canal}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados),
  });
  const config = await fetch(`${base}/sessao/web/configuracao`);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await config.json(), { chaveRecaptcha: env.RECAPTCHA_SITE_KEY });
  const senhaWeb = { login: 'admin.piloto', senha };

  const web = await entrar('web', { ...senhaWeb, tokenRecaptcha: 'valido' });
  assert.equal(web.status, 200);
  const cookie = web.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.equal((await fetch(`${base}/sessao/web`, { headers: { Cookie: cookie.split(';')[0] } })).status, 200);
  assert.equal((await entrar('web', { ...senhaWeb, senha: 'incorreta', tokenRecaptcha: 'outra-verificacao' })).status, 401);

  for (const tokenRecaptcha of [undefined, 'invalido', 'expirado', 'dominio', 'acao', 'score', 'valido']) {
    const resposta = await entrar('web', { ...senhaWeb, tokenRecaptcha });
    assert.equal(resposta.status, 403, tokenRecaptcha);
    assert.equal(resposta.headers.get('set-cookie'), null);
  }
  for (const tokenRecaptcha of ['falha', 'quota', 'malformado']) {
    const resposta = await entrar('web', { ...senhaWeb, tokenRecaptcha });
    assert.equal(resposta.status, 503);
    assert.equal(resposta.headers.get('set-cookie'), null);
    assert.match((await resposta.json()).mensagem, /Tente novamente/);
  }
  assert.equal((await entrar('web', senhaWeb)).status, 403);
  const bloqueada = await entrar('web', { ...senhaWeb, tokenRecaptcha: 'valido-apos-limite' });
  assert.equal(bloqueada.status, 429);
  assert.equal(bloqueada.headers.get('set-cookie'), null);

  const app = await entrar('app', { login: 'vendedor.piloto', senha });
  assert.equal(app.status, 200);
  assert.match((await app.json()).token, /^[A-Za-z0-9_-]{43}$/);

  await t.test('configuração incompleta bloqueia só o login web', async (t) => {
    const recaptcha = configurarRecaptcha({ RECAPTCHA_SITE_KEY: env.RECAPTCHA_SITE_KEY });
    const server = createApp(db, { secureCookie: true, recaptcha }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const post = (canal, dados) => fetch(`${base}/sessao/${canal}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados),
    });
    assert.equal((await fetch(`${base}/sessao/web/configuracao`)).status, 503);
    const web = await post('web', senhaWeb);
    assert.equal(web.status, 503);
    assert.equal(web.headers.get('set-cookie'), null);
    assert.match((await web.json()).mensagem, /Tente novamente/);
    assert.equal((await post('app', { login: 'vendedor.piloto', senha })).status, 200);
  });
});
