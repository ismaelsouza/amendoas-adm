import { createHash } from 'node:crypto';
import type { Pool, PoolConnection } from 'mariadb';
import type { Expedicao, SaidaEstoque } from '../contracts/dispatch.js';
import type { Usuario } from '../contracts/pilot.js';
import { lerItensParaDespacho, pendenteDeDespacho } from './dispatch-balance.js';
import type { ItemPedido } from './dispatch-balance.js';
import { isDuplicate } from './orders.js';
import { formatar, milesimos } from './quantities.js';
import { dataLocal } from './stock.js';

type ItemExpedicao = Expedicao['itens'][number];
type Remessa = Expedicao['saidas'][number];
type Lote = {
  loteId: number; apresentacaoId: number; codigo: string; validade: string; saldo: string;
};
type ConfirmacaoSaida = { saidaId: string; numero: number };
type RegistroSaida = { success: true; criado: boolean; data: ConfirmacaoSaida }
  | { success: false; error: 'pedido' | 'lote' | 'modalidade' | 'quantidade' | 'pendente' | 'saldo' | 'conflito' | 'concorrencia' };

async function lerRemessas(conexao: PoolConnection, pedidoNumero: number): Promise<Remessa[]> {
  const remessas = await conexao.query<Omit<Remessa, 'lotes'>[]>(
    `SELECT numero, modalidade, responsavel, confirmada_em AS confirmadaEm
     FROM saidas_estoque WHERE pedido_numero = ? ORDER BY numero DESC`, [pedidoNumero],
  );
  if (remessas.length === 0) return [];
  const lotes = await conexao.query<(Remessa['lotes'][number] & { saidaNumero: number })[]>(
    `SELECT s.numero AS saidaNumero, l.id AS loteId, l.codigo, DATE_FORMAT(l.validade, '%Y-%m-%d') AS validade,
       i.apresentacao_id AS apresentacaoId, i.apresentacao, i.unidade, item.quantidade
     FROM saidas_estoque s
     JOIN itens_saida_estoque item ON item.saida_numero = s.numero
     JOIN lotes_estoque l ON l.id = item.lote_id
     JOIN itens_pedido i ON i.pedido_numero = s.pedido_numero AND i.apresentacao_id = l.apresentacao_id
     WHERE s.pedido_numero = ? ORDER BY i.apresentacao_id, l.validade, l.codigo`, [pedidoNumero],
  );
  const agrupados = Map.groupBy(lotes, (lote) => lote.saidaNumero);
  return remessas.map((remessa) => ({
    ...remessa,
    lotes: (agrupados.get(remessa.numero) ?? []).map(({ saidaNumero: _, ...lote }) => ({
      ...lote, quantidade: formatar(milesimos(lote.quantidade), lote.unidade),
    })),
  }));
}

function montarItem(item: ItemPedido, lotes: Lote[]): ItemExpedicao {
  const { apresentacaoId, apresentacao, unidade, pedida, despachada } = item;
  const pendente = pendenteDeDespacho(item);
  let porAlocar = pendente;
  let disponivel = 0n;
  const sugestoes = lotes.map(({ loteId, codigo, validade, saldo }) => {
    const qtd = milesimos(saldo);
    const sugerida = porAlocar < qtd ? porAlocar : qtd;
    porAlocar -= sugerida;
    disponivel += qtd;
    return {
      loteId, codigo, validade, disponivel: formatar(qtd, unidade), sugerida: formatar(sugerida, unidade),
    };
  });
  return {
    apresentacaoId, apresentacao, unidade, pedida: formatar(milesimos(pedida), unidade), despachada: formatar(milesimos(despachada), unidade),
    pendente: formatar(pendente, unidade), disponivel: formatar(disponivel, unidade), lotes: sugestoes,
  };
}

export async function consultarExpedicao(db: Pool, pedidoNumero: number, agora: Date): Promise<Expedicao | null> {
  const conexao = await db.getConnection();
  try {
    await conexao.beginTransaction();
    const [pedido] = await conexao.query<{ retiradaImediata: number }[]>(
      'SELECT retirada_imediata AS retiradaImediata FROM pedidos WHERE numero = ?', [pedidoNumero],
    );
    if (!pedido) {
      await conexao.rollback();
      return null;
    }
    const itens = await lerItensParaDespacho(conexao, pedidoNumero);
    const lotes = await conexao.query<Lote[]>(
      `SELECT l.id AS loteId, l.apresentacao_id AS apresentacaoId, l.codigo,
         DATE_FORMAT(l.validade, '%Y-%m-%d') AS validade, l.saldo
       FROM lotes_estoque l JOIN itens_pedido i ON i.apresentacao_id = l.apresentacao_id
       WHERE i.pedido_numero = ? AND l.validade >= ? AND l.saldo > 0
       ORDER BY l.apresentacao_id, l.validade, l.codigo`, [pedidoNumero, dataLocal(agora)],
    );
    const saidas = await lerRemessas(conexao, pedidoNumero);
    await conexao.commit();
    const porApresentacao = Map.groupBy(lotes, (lote) => lote.apresentacaoId);
    return {
      pedidoNumero, retiradaImediata: Boolean(pedido.retiradaImediata), saidas,
      itens: itens.map((item) => montarItem(item, porApresentacao.get(item.apresentacaoId) ?? [])),
    };
  } catch (error) {
    await conexao.rollback();
    throw error;
  } finally {
    conexao.release();
  }
}

async function recuperarConfirmacao(
  conexao: PoolConnection, usuarioId: number, saidaId: string, conteudo: string,
): Promise<RegistroSaida | null> {
  const [gravada] = await conexao.query<{ numero: number; conteudoHash: string }[]>(
    'SELECT numero, conteudo_hash AS conteudoHash FROM saidas_estoque WHERE usuario_id = ? AND saida_id = ?',
    [usuarioId, saidaId],
  );
  if (!gravada) return null;
  if (gravada.conteudoHash !== conteudo) return { success: false, error: 'conflito' };
  return { success: true, criado: false, data: { saidaId, numero: gravada.numero } };
}

export async function registrarSaida(
  db: Pool, usuario: Usuario, pedidoNumero: number, saida: SaidaEstoque, agora: () => Date,
): Promise<RegistroSaida> {
  const { saidaId, modalidade } = saida;
  const linhas = saida.lotes.map(({ loteId, quantidade }) => ({ loteId, quantidade: formatar(milesimos(quantidade), 'kg') }))
    .sort((a, b) => a.loteId - b.loteId);
  const conteudo = createHash('sha256').update(JSON.stringify({ pedidoNumero, modalidade, linhas })).digest('hex');
  const conexao = await db.getConnection();
  try {
    await conexao.beginTransaction();
    const resultado = await gravar();
    if (resultado.success && resultado.criado) await conexao.commit();
    else await conexao.rollback();
    return resultado;
  } catch (error) {
    await conexao.rollback();
    if (isDuplicate(error)) {
      const recuperada = await recuperarConfirmacao(conexao, usuario.id, saidaId, conteudo);
      if (recuperada) return recuperada;
    }
    if (error instanceof Error && 'code' in error
      && (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT')) {
      return { success: false, error: 'concorrencia' };
    }
    throw error;
  } finally {
    conexao.release();
  }

  async function gravar(): Promise<RegistroSaida> {
    // O pedido serializa saídas concorrentes da mesma venda; os lotes serializam a disputa entre vendas diferentes.
    const [pedido] = await conexao.query<{ retiradaImediata: number }[]>(
      'SELECT retirada_imediata AS retiradaImediata FROM pedidos WHERE numero = ? FOR UPDATE', [pedidoNumero],
    );
    if (!pedido) return { success: false, error: 'pedido' };
    const recuperada = await recuperarConfirmacao(conexao, usuario.id, saidaId, conteudo);
    if (recuperada) return recuperada;
    if (pedido.retiradaImediata && modalidade !== 'retirada') return { success: false, error: 'modalidade' };

    const itens = new Map((await lerItensParaDespacho(conexao, pedidoNumero)).map((item) => [item.apresentacaoId, item]));
    const lotes = await conexao.query<Omit<Lote, 'codigo'>[]>(
      `SELECT id AS loteId, apresentacao_id AS apresentacaoId, DATE_FORMAT(validade, '%Y-%m-%d') AS validade, saldo
       FROM lotes_estoque WHERE id IN (${linhas.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`,
      linhas.map((linha) => linha.loteId),
    );
    const porLote = new Map(lotes.map((lote) => [lote.loteId, lote]));
    const confirmadaEm = agora();
    const hoje = dataLocal(confirmadaEm);
    const porApresentacao = new Map<number, bigint>();
    for (const linha of linhas) {
      const lote = porLote.get(linha.loteId);
      const item = lote && itens.get(lote.apresentacaoId);
      if (!lote || !item) return { success: false, error: 'lote' };
      const qtd = milesimos(linha.quantidade);
      if (item.unidade !== 'kg' && qtd % 1000n !== 0n) return { success: false, error: 'quantidade' };
      if (lote.validade < hoje || qtd > milesimos(lote.saldo)) return { success: false, error: 'saldo' };
      const total = (porApresentacao.get(item.apresentacaoId) ?? 0n) + qtd;
      if (total > pendenteDeDespacho(item)) {
        return { success: false, error: 'pendente' };
      }
      porApresentacao.set(item.apresentacaoId, total);
    }
    const insercao = await conexao.query<{ insertId: bigint }>(
      `INSERT INTO saidas_estoque (saida_id, pedido_numero, usuario_id, responsavel, modalidade, confirmada_em, conteudo_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [saidaId, pedidoNumero, usuario.id, usuario.nome, modalidade, confirmadaEm.toISOString(), conteudo],
    );
    const numero = Number(insercao.insertId);
    for (const { loteId, quantidade } of linhas) {
      const baixa = await conexao.query<{ affectedRows: number }>(
        'UPDATE lotes_estoque SET saldo = saldo - ? WHERE id = ? AND saldo >= ? AND validade >= ?',
        [quantidade, loteId, quantidade, hoje],
      );
      if (!baixa.affectedRows) return { success: false, error: 'saldo' };
      await conexao.query('INSERT INTO itens_saida_estoque (saida_numero, lote_id, quantidade) VALUES (?, ?, ?)',
        [numero, loteId, quantidade]);
    }
    return { success: true, criado: true, data: { saidaId, numero } };
  }
}
