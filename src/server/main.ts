import * as v from 'valibot';
import { createApp } from './app.js';
import { openDb } from './db/config.js';
import { configurarRecaptcha } from './recaptcha.js';

const config = v.parse(v.object({
  HOST: v.optional(v.string(), '127.0.0.1'),
  PORT: v.optional(v.pipe(v.string(), v.regex(/^\d+$/), v.transform(Number), v.minValue(1), v.maxValue(65535)), '3000'),
  APP_ENV: v.optional(v.picklist(['dsv', 'hml', 'prd']), 'prd'),
  SECURE_COOKIE: v.optional(v.picklist(['true', 'false']), 'true'),
  TRUST_LOOPBACK_PROXY: v.optional(v.picklist(['true', 'false']), 'false'),
}), process.env);

const recaptcha = configurarRecaptcha(process.env);
if (recaptcha === 'invalida') {
  console.error('Configuração incompleta ou inválida do reCAPTCHA. O login do ADM está indisponível.');
}
const db = openDb();
try {
  await db.query('SELECT 1 FROM usuarios LIMIT 1');
  if (config.TRUST_LOOPBACK_PROXY === 'true' && config.HOST !== '127.0.0.1') {
    throw new Error('O proxy de homologação exige HOST=127.0.0.1.');
  }
  const server = createApp(db, {
    ambiente: config.APP_ENV,
    secureCookie: config.SECURE_COOKIE === 'true',
    trustLoopbackProxy: config.TRUST_LOOPBACK_PROXY === 'true',
    recaptcha,
  });
  const listener = server.listen(config.PORT, config.HOST, () => {
    console.log(`Administrativo disponível em ${config.HOST}:${config.PORT}`);
  });
  function encerrar(): void {
    listener.close(() => { void db.end(); });
  }
  process.once('SIGINT', encerrar);
  process.once('SIGTERM', encerrar);
} catch (error) {
  await db.end();
  throw error;
}
