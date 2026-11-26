import { createPool } from 'mariadb';
import type { Pool } from 'mariadb';

export function openDb(): Pool {
  const url = URL.parse(process.env.DATABASE_URL ?? '');
  if (url?.protocol !== 'mariadb:' || !url.host || !/^\/[a-zA-Z0-9_]+$/.test(url.pathname)) {
    throw new Error('Configure DATABASE_URL com uma URL mariadb:// que inclua o banco de dados.');
  }
  return createPool(url.href);
}

