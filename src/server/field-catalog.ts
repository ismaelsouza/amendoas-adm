import type { Pool, PoolConnection } from 'mariadb';
import type { Pedido } from '../contracts/pilot.js';

export type CatalogoCliente = {
  cliente: { id: number; nome: string };
  apresentacoes: {
    id: number; apresentacao: string; unidade: Pedido['itens'][number]['unidade'];
    precoPadraoCentavos: number; precoNegociadoCentavos: number | null;
  }[];
};

type ClienteBusca = CatalogoCliente['cliente'] & { cnpj: string | null };

export async function listarClientesDeCampo(db: Pool): Promise<ClienteBusca[]> {
  return db.query<ClienteBusca[]>(
    'SELECT c.id, c.nome, n.cnpj FROM clientes c LEFT JOIN cnpjs_clientes n ON n.cliente_id = c.id ORDER BY c.nome, c.id',
  );
}

export async function consultarCatalogoDoCliente(db: Pool, chave: string | number): Promise<CatalogoCliente | null> {
  const [cliente] = await db.query<CatalogoCliente['cliente'][]>(
    typeof chave === 'number' ? 'SELECT id, nome FROM clientes WHERE id = ?'
      : 'SELECT c.id, c.nome FROM cnpjs_clientes n JOIN clientes c ON c.id = n.cliente_id WHERE n.cnpj = ?', [chave],
  );
  if (!cliente) return null;
  return { cliente, apresentacoes: await listarApresentacoesDeCampo(db, cliente.id) };
}

export async function listarApresentacoesDeCampo(db: Pool | PoolConnection, clienteId: number | null): Promise<CatalogoCliente['apresentacoes']> {
  return db.query<CatalogoCliente['apresentacoes']>(
    `SELECT a.id, a.apresentacao, a.unidade, a.preco_padrao_centavos AS precoPadraoCentavos,
       p.preco_centavos AS precoNegociadoCentavos
     FROM apresentacoes a LEFT JOIN precos_clientes p ON p.apresentacao_id = a.id AND p.cliente_id = ?
     ORDER BY a.apresentacao, a.id`, [clienteId],
  );
}
