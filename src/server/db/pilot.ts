import { pathToFileURL } from 'node:url';
import type { Pool } from 'mariadb';
import * as v from 'valibot';
import type { Perfil } from '../../contracts/pilot.js';
import { hashPassword } from '../password.js';
import { openDb } from './config.js';

export async function seedPilot(
  db: Pool, senha: string, { resetPilotPasswords = false } = {},
): Promise<void> {
  const pessoas: { login: string; nome: string; perfil: Perfil }[] = [
    { login: 'admin.piloto', nome: 'Administração piloto', perfil: 'administrador' },
    { login: 'vendedor.piloto', nome: 'Ana, vendedora piloto', perfil: 'vendedor' },
    { login: 'estoque.piloto', nome: 'Estoque piloto', perfil: 'estoque' },
    { login: 'balcao.piloto', nome: 'Balcão piloto', perfil: 'balcao' },
  ];
  for (const pessoa of pessoas) {
    const hash = await hashPassword(senha);
    await db.query(
      `INSERT INTO usuarios (login, nome, perfil, senha_hash) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE ${resetPilotPasswords ? 'senha_hash = VALUES(senha_hash)' : 'id = id'}`,
      [pessoa.login, pessoa.nome, pessoa.perfil, hash],
    );
  }
  await db.query("INSERT INTO clientes (id, nome) VALUES (1, 'Supermercado Ipê') ON DUPLICATE KEY UPDATE id = id");
  await db.query(`INSERT INTO apresentacoes (id, apresentacao, unidade, preco_padrao_centavos) VALUES
    (1, 'Castanha de caju · 250 g', 'pacote', 1875),
    (2, 'Castanha a granel', 'kg', 2988)
    ON DUPLICATE KEY UPDATE id = id`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  try {
    const [atual] = await db.query<{ nome: string }[]>('SELECT DATABASE() AS nome');
    if (atual?.nome !== 'amendoas_piloto') throw new Error('Use o banco amendoas_piloto para os dados fictícios.');
    const senha = v.safeParse(v.pipe(v.string(), v.minLength(12), v.maxLength(128)), process.env.PILOT_PASSWORD);
    if (!senha.success) throw new Error('Configure PILOT_PASSWORD com 12 a 128 caracteres.');
    await seedPilot(db, senha.output);
  } finally {
    await db.end();
  }
}

