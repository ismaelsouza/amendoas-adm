import type { Pool } from 'mariadb';
import type { CadastrosPendentes, ClientePendente, NovoClienteCampo } from '../contracts/field-customers.js';
import type { Usuario } from '../contracts/pilot.js';
import { listarApresentacoesDeCampo } from './field-catalog.js';
import type { CatalogoCliente } from './field-catalog.js';
import { isDuplicate } from './orders.js';

export async function cadastrarClienteCampo(
  db: Pool, vendedor: Usuario, dados: NovoClienteCampo, agora: Date,
): Promise<CatalogoCliente | null> {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const cliente = await c.query<{ insertId: bigint }>('INSERT INTO clientes (nome) VALUES (?)', [dados.nome]);
    const id = Number(cliente.insertId);
    await c.query('INSERT INTO cnpjs_clientes (cliente_id, cnpj) VALUES (?, ?)', [id, dados.cnpj]);
    const { cep, logradouro, numero, bairro, municipio, uf, complemento } = dados.endereco;
    await c.query(
      `INSERT INTO cadastros_clientes_campo
       (cliente_id, vendedor_id, vendedor, cadastrado_em, telefone, cep, logradouro, numero, bairro, municipio, uf, complemento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, vendedor.id, vendedor.nome, agora.toISOString(), dados.telefone, cep, logradouro, numero, bairro, municipio, uf, complemento ?? null],
    );
    const apresentacoes = await listarApresentacoesDeCampo(c, null);
    await c.commit();
    return { cliente: { id, nome: dados.nome }, apresentacoes };
  } catch (error) {
    await c.rollback();
    if (isDuplicate(error)) return null;
    throw error;
  } finally { c.release(); }
}

export async function totalCadastrosPendentes(db: Pool): Promise<number> {
  const [r] = await db.query<{ total: bigint }[]>('SELECT COUNT(*) AS total FROM cadastros_clientes_campo WHERE conferido_em IS NULL');
  if (!r) throw new Error('Não foi possível contar os cadastros pendentes.');
  return Number(r.total);
}

export async function listarCadastrosPendentes(db: Pool, antesDe?: number): Promise<CadastrosPendentes> {
  type Linha = Omit<ClientePendente, 'endereco'> & ClientePendente['endereco'];
  const pagina = await db.query<Linha[]>(
    `SELECT p.cliente_id AS clienteId, n.cnpj, c.nome, p.telefone, p.vendedor, p.cadastrado_em AS cadastradoEm,
       p.cep, p.logradouro, p.numero, p.bairro, p.municipio, p.uf, p.complemento
     FROM cadastros_clientes_campo p JOIN clientes c ON c.id = p.cliente_id
     JOIN cnpjs_clientes n ON n.cliente_id = p.cliente_id
     WHERE p.conferido_em IS NULL ${antesDe === undefined ? '' : 'AND p.cliente_id < ?'}
     ORDER BY p.cliente_id DESC LIMIT 51`, antesDe === undefined ? [] : [antesDe],
  );
  const cadastros = pagina.slice(0, 50).map(({ cep, logradouro, numero, bairro, municipio, uf, complemento, ...registro }) =>
    ({ ...registro, endereco: { cep, logradouro, numero, bairro, municipio, uf, complemento } }));
  return { cadastros, proximoAntesDe: pagina.length > cadastros.length ? cadastros.at(-1)?.clienteId ?? null : null };
}

export async function conferirClienteCampo(db: Pool, clienteId: number, usuarioId: number, agora: Date): Promise<boolean> {
  const r = await db.query<{ affectedRows: number }>(
    `UPDATE cadastros_clientes_campo SET conferido_em = ?, conferido_por = ?
     WHERE cliente_id = ? AND conferido_em IS NULL`, [agora.toISOString(), usuarioId, clienteId],
  );
  if (r.affectedRows > 0) return true;
  const [existe] = await db.query('SELECT cliente_id FROM cadastros_clientes_campo WHERE cliente_id = ?', [clienteId]);
  return existe !== undefined;
}
