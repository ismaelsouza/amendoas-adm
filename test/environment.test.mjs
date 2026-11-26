import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPool } from 'mariadb';
import { createApp } from '../dist/server/app.js';

test('saúde e ambiente respondem conforme a configuração em tempo de execução', async (t) => {
  const testUrl = URL.parse(process.env.TEST_DATABASE_URL ?? '');
  if (testUrl?.protocol !== 'mariadb:' || testUrl.pathname !== '/amendoas_test') {
    throw new Error('Configure TEST_DATABASE_URL para o banco de testes amendoas_test.');
  }
  const db = createPool(testUrl.href);
  t.after(() => db.end());

  const serverDsv = createApp(db, { secureCookie: false, ambiente: 'dsv' }).listen(0, '127.0.0.1');
  await once(serverDsv, 'listening');
  t.after(() => new Promise((resolve) => serverDsv.close(resolve)));
  const urlDsv = `http://127.0.0.1:${serverDsv.address().port}/api/v1`;

  const resAmbiente = await fetch(urlDsv + '/ambiente');
  assert.equal(resAmbiente.status, 200);
  assert.deepEqual(await resAmbiente.json(), { ambiente: 'dsv' });

  const resSaude = await fetch(urlDsv + '/saude');
  assert.equal(resSaude.status, 200);
  assert.deepEqual(await resSaude.json(), { status: 'ok', ambiente: 'dsv' });

  const serverPadrao = createApp(db, { secureCookie: false }).listen(0, '127.0.0.1');
  await once(serverPadrao, 'listening');
  t.after(() => new Promise((resolve) => serverPadrao.close(resolve)));
  const urlPadrao = `http://127.0.0.1:${serverPadrao.address().port}/api/v1`;

  const resPadrao = await fetch(urlPadrao + '/ambiente');
  assert.equal(resPadrao.status, 200);
  assert.deepEqual(await resPadrao.json(), { ambiente: 'prd' });
});
