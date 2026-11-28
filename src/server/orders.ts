import { createHash } from 'node:crypto';
import type { Pool } from 'mariadb';
import type { Cadastros, Pedido, PedidoFila, Usuario, Venda } from '../contracts/pilot.js';
import { condicaoCorrecaoPendente } from './corrections.js';

type Origem = Pedido['origem'];
type PedidoRegistrado = { vendaId: string; numero: number };
type Recepcao = { success: true; data: PedidoRegistrado; criado: boolean }
  | { success: false; error: 'conflito' | 'cadastro' | 'quantidade' | 'precoMudou' };

export async function registrarPedido(
  db: Pool, usuario: Usuario, venda: Venda, origem: Origem, retiradaImediata: boolean,
): Promise<Recepcao> {
  const itens = venda.itens.map((item) => ({
    ...item,
    quantidade: String(Number(item.quantidade)),
  })).sort((a, b) => a.apresentacaoId - b.apresentacaoId);
  const { fechadoEm } = venda;
  const conteudo = createHash('sha256').update(JSON.stringify({
    origem, retiradaImediata, clienteId: venda.clienteId, fechadoEm, itens,
  })).digest('hex');
  const conexao = await db.getConnection();
  try {
    await conexao.beginTransaction();

    const insercao = await conexao.query<{ insertId: bigint; affectedRows: number }>(
      `INSERT INTO pedidos (venda_id, usuario_id, responsavel, cliente_id, cliente,
        fechado_em, origem, retirada_imediata, conteudo_hash)
       SELECT ?, ?, ?, id, nome, ?, ?, ?, ? FROM clientes WHERE id = ?`,
      [venda.vendaId, usuario.id, usuario.nome, fechadoEm, origem, retiradaImediata, conteudo, venda.clienteId],
    );
    if (!insercao.affectedRows) {
      await conexao.rollback();
      return { success: false, error: 'cadastro' };
    }
    const numero = Number(insercao.insertId);
    for (const item of itens) {
      const [apresentacao] = await conexao.query<Cadastros['apresentacoes']>(
        'SELECT id, apresentacao, unidade, preco_padrao_centavos AS precoUnitarioCentavos FROM apresentacoes WHERE id = ?', [item.apresentacaoId],
      );
      if (!apresentacao || (apresentacao.unidade !== 'kg' && item.quantidade.includes('.'))) {
        await conexao.rollback();
        return { success: false, error: apresentacao ? 'quantidade' : 'cadastro' };
      }
      if (origem === 'balcao' && item.precoUnitarioCentavos !== apresentacao.precoUnitarioCentavos) {
        await conexao.rollback();
        return { success: false, error: 'precoMudou' };
      }
      await conexao.query(
        `INSERT INTO itens_pedido (pedido_numero, apresentacao_id, apresentacao, unidade,
          quantidade, preco_unitario_centavos) VALUES (?, ?, ?, ?, ?, ?)`,
        [numero, apresentacao.id, apresentacao.apresentacao, apresentacao.unidade,
          item.quantidade, item.precoUnitarioCentavos],
      );
    }
    await conexao.commit();
    return { success: true, data: { numero, vendaId: venda.vendaId }, criado: true };
  } catch (error) {
    await conexao.rollback();
    if (!isDuplicate(error)) throw error;
    const [gravado] = await conexao.query<{ numero: number; conteudo: string }[]>(
      'SELECT numero, conteudo_hash AS conteudo FROM pedidos WHERE usuario_id = ? AND venda_id = ?',
      [usuario.id, venda.vendaId],
    );
    if (!gravado) throw error;
    if (gravado.conteudo !== conteudo) return { success: false, error: 'conflito' };
    return { success: true, data: { numero: gravado.numero, vendaId: venda.vendaId }, criado: false };
  } finally {
    conexao.release();
  }
}

type PedidoRow = Omit<Pedido, 'itens' | 'retiradaImediata'> & { retiradaImediata: number };
type ItemRow = Pedido['itens'][number] & { numero: number };
const colunasPedido = 'numero, origem, responsavel, cliente, fechado_em AS fechadoEm, retirada_imediata AS retiradaImediata';

export async function listarPedidos(db: Pool, antesDe?: number): Promise<{
  pedidos: PedidoFila[];
  proximoAntesDe: number | null;
}> {
  const pagina = await db.query<(PedidoRow & { correcaoPendente: number })[]>(
    `SELECT ${colunasPedido},
     (EXISTS(SELECT 1 FROM correcoes_pedido c WHERE c.pedido_numero = pedidos.numero AND ${condicaoCorrecaoPendente})
       AND NOT EXISTS(SELECT 1 FROM saidas_estoque s WHERE s.pedido_numero = pedidos.numero)) AS correcaoPendente
     FROM pedidos ${antesDe === undefined ? '' : 'WHERE numero < ?'} ORDER BY numero DESC LIMIT 51`,
    antesDe === undefined ? [] : [antesDe],
  );
  const rows = pagina.slice(0, 50);
  const pedidos = (await carregarItens(db, rows)).map(({ correcaoPendente, ...pedido }) => ({
    ...pedido, correcaoPendente: Boolean(correcaoPendente),
  }));
  return { pedidos, proximoAntesDe: pagina.length > rows.length ? rows.at(-1)?.numero ?? null : null };
}

export async function consultarPedidoDoVendedor(db: Pool, usuarioId: number, numero: number): Promise<Pedido | null> {
  const rows = await db.query<PedidoRow[]>(
    `SELECT ${colunasPedido} FROM pedidos WHERE numero = ? AND usuario_id = ? AND origem = 'campo'`,
    [numero, usuarioId],
  );
  const [pedido] = await carregarItens(db, rows);
  return pedido ?? null;
}

export async function listarPedidosDoVendedor(db: Pool, usuarioId: number, antesDe?: number): Promise<{
  pedidos: Pick<Pedido, 'numero' | 'cliente' | 'fechadoEm'>[]; proximoAntesDe: number | null;
}> {
  const pagina = await db.query<Pick<Pedido, 'numero' | 'cliente' | 'fechadoEm'>[]>(
    `SELECT numero, cliente, fechado_em AS fechadoEm FROM pedidos
     WHERE usuario_id = ? AND origem = 'campo' ${antesDe === undefined ? '' : 'AND numero < ?'}
     ORDER BY numero DESC LIMIT 51`,
    antesDe === undefined ? [usuarioId] : [usuarioId, antesDe],
  );
  const pedidos = pagina.slice(0, 50);
  return { pedidos, proximoAntesDe: pagina.length > pedidos.length ? pedidos.at(-1)?.numero ?? null : null };
}

async function carregarItens<T extends PedidoRow>(
  db: Pool, rows: T[],
): Promise<(Omit<T, 'retiradaImediata'> & Pick<Pedido, 'retiradaImediata' | 'itens'>)[]> {
  if (rows.length === 0) return [];
  const numeros = rows.map((pedido) => pedido.numero);
  const itens = await db.query<ItemRow[]>(
    `SELECT pedido_numero AS numero, apresentacao_id AS apresentacaoId, apresentacao, unidade,
       quantidade, preco_unitario_centavos AS precoUnitarioCentavos
     FROM itens_pedido WHERE pedido_numero IN (${numeros.map(() => '?').join(', ')})
     ORDER BY apresentacao_id`,
    numeros,
  );
  const porPedido = Map.groupBy(itens, (item) => item.numero);
  return rows.map(({ retiradaImediata, ...pedido }) => ({
    ...pedido,
    retiradaImediata: Boolean(retiradaImediata),
    itens: (porPedido.get(pedido.numero) ?? []).map(({ numero: _, ...item }) => ({
      ...item,
      quantidade: item.unidade === 'kg' ? item.quantidade : String(Number(item.quantidade)),
    })),
  }));
}

export async function listarCadastros(db: Pool): Promise<Cadastros> {
  const [clientes, apresentacoes] = await Promise.all([
    db.query<Cadastros['clientes']>('SELECT id, nome FROM clientes ORDER BY nome'),
    db.query<Cadastros['apresentacoes']>(`SELECT id, apresentacao, unidade,
      preco_padrao_centavos AS precoUnitarioCentavos FROM apresentacoes ORDER BY apresentacao`),
  ]);
  return { clientes, apresentacoes };
}

export function isDuplicate(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ER_DUP_ENTRY';
}
