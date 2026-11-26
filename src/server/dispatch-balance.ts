import type { PoolConnection } from 'mariadb';
import type { Expedicao } from '../contracts/dispatch.js';
import { milesimos } from './quantities.js';

type Produto = Pick<Expedicao['itens'][number], 'apresentacaoId' | 'apresentacao' | 'unidade'>;
type Movimentado = { pedida: string; despachada: string; reposicao: string; cancelada: string };
export type ItemPedido = Produto & Movimentado;

export function pendenteDeDespacho({ pedida, despachada, reposicao, cancelada }: Movimentado): bigint {
  return milesimos(pedida) - milesimos(despachada) + milesimos(reposicao) - milesimos(cancelada);
}

export async function lerItensParaDespacho(conexao: PoolConnection, pedidoNumero: number): Promise<ItemPedido[]> {
  return conexao.query<ItemPedido[]>(
    `SELECT i.apresentacao_id AS apresentacaoId, i.apresentacao, i.unidade, i.quantidade AS pedida,
       COALESCE(expedida.total, 0.000) AS despachada, COALESCE(reposicao.total, 0.000) AS reposicao,
       COALESCE(cancelada.total, 0.000) AS cancelada
     FROM itens_pedido i LEFT JOIN (
       SELECT l.apresentacao_id, SUM(item.quantidade) AS total
       FROM saidas_estoque s
       JOIN itens_saida_estoque item ON item.saida_numero = s.numero
       JOIN lotes_estoque l ON l.id = item.lote_id
       WHERE s.pedido_numero = ?
       GROUP BY l.apresentacao_id
     ) expedida ON expedida.apresentacao_id = i.apresentacao_id
     LEFT JOIN (
       SELECT item.apresentacao_id, SUM(item.recusada) AS total
       FROM saidas_estoque s
       JOIN recebimentos_remessa r ON r.saida_numero = s.numero
       JOIN itens_recebimento_remessa item ON item.recebimento_numero = r.numero
       WHERE s.pedido_numero = ? AND item.repor
       GROUP BY item.apresentacao_id
     ) reposicao ON reposicao.apresentacao_id = i.apresentacao_id
     LEFT JOIN (
       SELECT item.apresentacao_id, SUM(item.quantidade) AS total
       FROM cancelamentos_pedido c JOIN itens_cancelamento_pedido item ON item.cancelamento_numero = c.numero
       WHERE c.pedido_numero = ?
       GROUP BY item.apresentacao_id
     ) cancelada ON cancelada.apresentacao_id = i.apresentacao_id
     WHERE i.pedido_numero = ? ORDER BY i.apresentacao_id`,
    [pedidoNumero, pedidoNumero, pedidoNumero, pedidoNumero],
  );
}
