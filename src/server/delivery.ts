import { createHash } from 'node:crypto';
import type { Pool, PoolConnection } from 'mariadb';
import type { Entregas, Recebimento } from '../contracts/delivery.js';
import type { Usuario } from '../contracts/pilot.js';
import { consultarCancelamentos } from './cancellations.js';
import { pendenteDeDespacho } from './dispatch-balance.js';
import { isDuplicate } from './orders.js';
import { formatar, milesimos } from './quantities.js';

type Remessa = Entregas['remessas'][number];
type Registro = NonNullable<Remessa['recebimento']>;
type Linha = Remessa['itens'][number] & { saidaNumero: number; preco: number };
type Resultado = { success: true; criado: boolean; data: { recebimentoId: string; numero: number } }
  | { success: false; error: 'remessa' | 'perfil' | 'itens' | 'conferencia' | 'conflito' };

async function itensDespachados(c: PoolConnection, pedido: number, saida: number | null): Promise<Linha[]> {
  return c.query<Linha[]>(
    `SELECT s.numero AS saidaNumero, i.apresentacao_id AS apresentacaoId, i.apresentacao, i.unidade,
       i.preco_unitario_centavos AS preco, SUM(l.quantidade) AS despachada
     FROM saidas_estoque s
     JOIN itens_saida_estoque l ON l.saida_numero = s.numero
     JOIN lotes_estoque lote ON lote.id = l.lote_id
     JOIN itens_pedido i ON i.pedido_numero = s.pedido_numero AND i.apresentacao_id = lote.apresentacao_id
     WHERE s.pedido_numero = ? ${saida === null ? '' : 'AND s.numero = ?'}
     GROUP BY s.numero, i.apresentacao_id, i.apresentacao, i.unidade, i.preco_unitario_centavos
     ORDER BY i.apresentacao_id`,
    saida === null ? [pedido] : [pedido, saida],
  );
}

export async function consultarEntregas(db: Pool, pedidoNumero: number, vendedorId?: number): Promise<Entregas | null> {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const [pedido] = await c.query<{ numero: number }[]>(
      `SELECT numero FROM pedidos WHERE numero = ? ${vendedorId === undefined ? '' : "AND usuario_id = ? AND origem = 'campo'"}`,
      vendedorId === undefined ? [pedidoNumero] : [pedidoNumero, vendedorId],
    );
    if (!pedido) {
      await c.rollback();
      return null;
    }
    const itensPedido = await c.query<Pick<Entregas['itens'][number], 'apresentacaoId' | 'apresentacao' | 'unidade' | 'pedida'>[]>(
      `SELECT apresentacao_id AS apresentacaoId, apresentacao, unidade, quantidade AS pedida
       FROM itens_pedido WHERE pedido_numero = ? ORDER BY apresentacao_id`, [pedidoNumero],
    );
    const saidas = await c.query<Pick<Remessa, 'numero' | 'modalidade'>[]>(
      'SELECT numero, modalidade FROM saidas_estoque WHERE pedido_numero = ? ORDER BY numero DESC', [pedidoNumero],
    );
    const despachos = Map.groupBy(await itensDespachados(c, pedidoNumero, null), (linha) => linha.saidaNumero);
    const registros = await c.query<(Omit<Registro, 'itens'> & { saidaNumero: number })[]>(
      `SELECT r.numero, r.saida_numero AS saidaNumero, r.responsavel, r.confirmado_em AS confirmadoEm, r.conferencia
       FROM recebimentos_remessa r JOIN saidas_estoque s ON s.numero = r.saida_numero WHERE s.pedido_numero = ?`,
      [pedidoNumero],
    );
    const detalhes = await c.query<(Omit<Registro['itens'][number], 'subtotalCentavos' | 'repor'> & {
      recebimentoNumero: number; repor: number; subtotalCentavos: bigint;
    })[]>(
      `SELECT i.recebimento_numero AS recebimentoNumero, i.apresentacao_id AS apresentacaoId, i.recebida, i.recusada,
         i.motivo, i.repor, i.subtotal_centavos AS subtotalCentavos
       FROM itens_recebimento_remessa i
       JOIN recebimentos_remessa r ON r.numero = i.recebimento_numero
       JOIN saidas_estoque s ON s.numero = r.saida_numero WHERE s.pedido_numero = ? ORDER BY i.apresentacao_id`,
      [pedidoNumero],
    );
    const cancelamentos = await consultarCancelamentos(c, pedidoNumero);
    await c.commit();
    const porRecebimento = Map.groupBy(detalhes, (item) => item.recebimentoNumero);
    const totais = new Map(itensPedido.map((item) => [item.apresentacaoId, {
      unidade: item.unidade, despachada: 0n, recebida: 0n, recusada: 0n, reposicao: 0n, cancelada: 0n,
    }]));
    function totalDoItem(apresentacaoId: number) {
      const total = totais.get(apresentacaoId);
      if (!total) throw new Error('A remessa contém apresentação ausente do pedido.');
      return total;
    }
    for (const registro of cancelamentos) {
      for (const item of registro.itens) {
        const total = totalDoItem(item.apresentacaoId);
        total.cancelada += milesimos(item.quantidade);
        item.quantidade = formatar(milesimos(item.quantidade), total.unidade);
      }
    }
    const porSaida = new Map(registros.map(({ saidaNumero, ...registro }) => [saidaNumero, {
      ...registro, itens: (porRecebimento.get(registro.numero) ?? []).map(({ recebimentoNumero: _, ...item }) => {
        const total = totalDoItem(item.apresentacaoId);
        const recebida = milesimos(item.recebida);
        const recusada = milesimos(item.recusada);
        total.recebida += recebida;
        total.recusada += recusada;
        if (item.repor) total.reposicao += recusada;
        return { ...item, recebida: formatar(recebida, total.unidade), recusada: formatar(recusada, total.unidade),
          repor: Boolean(item.repor), subtotalCentavos: Number(item.subtotalCentavos) };
      }),
    }]));
    const remessas: Remessa[] = saidas.map((saida) => ({
      ...saida, recebimento: porSaida.get(saida.numero) ?? null,
      itens: (despachos.get(saida.numero) ?? []).map(({ saidaNumero: _, preco: __, despachada, ...item }) => {
        const qtd = milesimos(despachada);
        totalDoItem(item.apresentacaoId).despachada += qtd;
        return { ...item, despachada: formatar(qtd, item.unidade) };
      }),
    }));
    const itens = itensPedido.map(({ pedida, ...item }) => {
      const { despachada, recebida, recusada, reposicao, cancelada } = totalDoItem(item.apresentacaoId);
      const qtd = milesimos(pedida);
      const exibir = (valor: bigint) => formatar(valor, item.unidade);
      const saldo = { pedida: exibir(qtd), despachada: exibir(despachada), cancelada: exibir(cancelada) };
      return { ...item, ...saldo, recebida: exibir(recebida), recusada: exibir(recusada),
        emTransito: exibir(despachada - recebida - recusada),
        pendenteDespacho: exibir(pendenteDeDespacho({ ...saldo, reposicao: exibir(reposicao) })),
        pendenteRecebimento: exibir(qtd - recebida - cancelada) };
    });
    return { pedidoNumero, situacao: situacaoDosItens(itens), remessas, itens, cancelamentos };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}

function situacaoDosItens(itens: Entregas['itens']): Entregas['situacao'] {
  const houveEntrega = itens.some((item) => milesimos(item.recebida) > 0n);
  if (itens.every((item) => milesimos(item.pendenteRecebimento) === 0n)) {
    if (!itens.some((item) => milesimos(item.cancelada) > 0n)) return 'entregue';
    return houveEntrega ? 'finalizado_entrega_parcial' : 'cancelado';
  }
  if (houveEntrega) return 'entrega_parcial';
  if (itens.some((item) => milesimos(item.emTransito) > 0n)) return 'em_entrega';
  if (itens.some((item) => milesimos(item.recusada) > 0n)) return 'sem_aceite';
  return 'aguardando_despacho';
}

export function resumoParaVendedor(entrega: Entregas) {
  return {
    pedidoNumero: entrega.pedidoNumero, situacao: entrega.situacao, itens: entrega.itens,
    remessas: entrega.remessas.map(({ recebimento, ...remessa }) => ({
      ...remessa, recebimento: recebimento && {
        confirmadoEm: recebimento.confirmadoEm,
        itens: recebimento.itens.map(({ apresentacaoId, recebida, recusada }) => ({ apresentacaoId, recebida, recusada })),
      },
    })),
  };
}

export async function registrarRecebimento(
  db: Pool, usuario: Usuario, pedido: number, saida: number, dados: Recebimento, agora: () => Date,
): Promise<Resultado> {
  const { recebimentoId, conferencia } = dados;
  const itens = dados.itens.map((item) => ({
    apresentacaoId: item.apresentacaoId, recebida: formatar(milesimos(item.recebida), 'kg'),
    recusada: formatar(milesimos(item.recusada), 'kg'), motivo: item.motivo ?? null, repor: item.repor ?? false,
  })).sort((a, b) => a.apresentacaoId - b.apresentacaoId);
  const hash = createHash('sha256').update(JSON.stringify({ pedido, saida, conferencia, itens })).digest('hex');
  const c = await db.getConnection();
  const sucesso = (numero: number, criado: boolean): Resultado =>
    ({ success: true, criado, data: { recebimentoId, numero } });
  async function recuperar(): Promise<Resultado | null> {
    const [registro] = await c.query<{ numero: number; hash: string }[]>(
      `SELECT numero, conteudo_hash AS hash FROM recebimentos_remessa WHERE usuario_id = ? AND recebimento_id = ?`,
      [usuario.id, recebimentoId],
    );
    return !registro ? null : registro.hash === hash ? sucesso(registro.numero, false) : { success: false, error: 'conflito' };
  }
  try {
    await c.beginTransaction();
    const resultado = await gravar();
    if (resultado.success && resultado.criado) await c.commit();
    else await c.rollback();
    return resultado;
  } catch (error) {
    await c.rollback();
    if (isDuplicate(error)) return await recuperar() ?? { success: false, error: 'conflito' };
    if (error instanceof Error && 'code' in error
      && (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT')) {
      return { success: false, error: 'conflito' };
    }
    throw error;
  } finally {
    c.release();
  }

  async function gravar(): Promise<Resultado> {
    // Compartilha o bloqueio do pedido com o despacho para não liberar reposição antes do commit.
    const [venda] = await c.query<{ numero: number }[]>('SELECT numero FROM pedidos WHERE numero = ? FOR UPDATE', [pedido]);
    if (!venda) return { success: false, error: 'remessa' };
    const [remessa] = await c.query<Pick<Remessa, 'modalidade'>[]>(
      'SELECT modalidade FROM saidas_estoque WHERE numero = ? AND pedido_numero = ?', [saida, pedido],
    );
    if (!remessa) return { success: false, error: 'remessa' };
    if (usuario.perfil === 'balcao' && remessa.modalidade !== 'retirada') return { success: false, error: 'perfil' };
    const recuperado = await recuperar();
    if (recuperado) return recuperado;
    const [confirmado] = await c.query('SELECT numero FROM recebimentos_remessa WHERE saida_numero = ?', [saida]);
    if (confirmado) return { success: false, error: 'conflito' };
    if ((remessa.modalidade === 'transportadora') !== (conferencia !== undefined)) return { success: false, error: 'conferencia' };

    const despachados = await itensDespachados(c, pedido, saida);
    if (itens.length !== despachados.length) return { success: false, error: 'itens' };
    const linhas = [];
    for (const [indice, item] of itens.entries()) {
      const despachado = despachados[indice];
      const recebida = milesimos(item.recebida);
      const recusada = milesimos(item.recusada);
      if (!despachado || despachado.apresentacaoId !== item.apresentacaoId
        || recebida + recusada !== milesimos(despachado.despachada)
        || (despachado.unidade !== 'kg' && (recebida % 1000n !== 0n || recusada % 1000n !== 0n))
        || (recusada > 0n ? item.motivo === null : item.motivo !== null || item.repor)) {
        return { success: false, error: 'itens' };
      }
      if (recusada > 0n && conferencia === 'sem_ressalvas') return { success: false, error: 'conferencia' };
      linhas.push({ ...item, subtotal: (recebida * BigInt(despachado.preco) + 500n) / 1000n });
    }
    const { insertId } = await c.query<{ insertId: bigint }>(
      `INSERT INTO recebimentos_remessa
       (recebimento_id, saida_numero, usuario_id, responsavel, confirmado_em, conferencia, conteudo_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [recebimentoId, saida, usuario.id, usuario.nome, agora().toISOString(), conferencia ?? null, hash],
    );
    const numero = Number(insertId);
    for (const item of linhas) {
      await c.query(
        `INSERT INTO itens_recebimento_remessa
         (recebimento_numero, apresentacao_id, recebida, recusada, motivo, repor, subtotal_centavos) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [numero, item.apresentacaoId, item.recebida, item.recusada, item.motivo, item.repor, item.subtotal],
      );
    }
    return sucesso(numero, true);
  }
}
