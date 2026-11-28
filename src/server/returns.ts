import { createHash } from 'node:crypto';
import type { Pool, PoolConnection } from 'mariadb';
import type { Usuario } from '../contracts/pilot.js';
import type { Devolucao, Devolucoes } from '../contracts/returns.js';
import { isDuplicate } from './orders.js';
import { formatar, milesimos } from './quantities.js';
import { dataLocal } from './stock.js';

type Historico = Devolucoes['devolucoes'][number];
type Lote = Omit<Devolucoes['lotes'][number], 'vencido' | 'saldoDevolvivel'>;
type Resultado = { success: true; criado: boolean; data: { devolucaoId: string; numero: number } }
  | { success: false; error: 'remessa' | 'recebimento' | 'quantidade' | 'vencido' | 'limite' | 'conflito' };

async function lerContexto(c: PoolConnection, pedido: number, saida: number, hoje: string) {
  const [remessa] = await c.query<{ recebimentoNumero: number | null }[]>(
    `SELECT r.numero AS recebimentoNumero FROM saidas_estoque s
     LEFT JOIN recebimentos_remessa r ON r.saida_numero = s.numero
     WHERE s.pedido_numero = ? AND s.numero = ?`, [pedido, saida],
  );
  if (!remessa || remessa.recebimentoNumero === null) return remessa ? { ...remessa, lotes: [], itens: [], devolucoes: [] } : null;
  const numero = remessa.recebimentoNumero;
  const lotes = await c.query<(Lote & { despachada: string })[]>(
    `SELECT l.id AS loteId, i.apresentacao_id AS apresentacaoId, i.apresentacao, i.unidade, l.codigo,
       DATE_FORMAT(l.validade, '%Y-%m-%d') AS validade, item.quantidade AS despachada
     FROM itens_saida_estoque item JOIN lotes_estoque l ON l.id = item.lote_id
     JOIN itens_pedido i ON i.pedido_numero = ? AND i.apresentacao_id = l.apresentacao_id
     WHERE item.saida_numero = ? ORDER BY i.apresentacao_id, l.validade, l.codigo`, [pedido, saida],
  );
  const itens = await c.query<{ apresentacaoId: number; unidade: Lote['unidade']; recebida: string; recusada: string }[]>(
    `SELECT r.apresentacao_id AS apresentacaoId, i.unidade, r.recebida, r.recusada FROM itens_recebimento_remessa r
     JOIN itens_pedido i ON i.apresentacao_id = r.apresentacao_id AND i.pedido_numero = ?
     WHERE r.recebimento_numero = ? ORDER BY r.apresentacao_id`, [pedido, numero],
  );
  const registros = await c.query<Omit<Historico, 'lotes'>[]>(
    `SELECT numero, origem, responsavel, registrada_em AS registradaEm
     FROM devolucoes_remessa WHERE recebimento_numero = ? ORDER BY numero DESC`, [numero],
  );
  const detalhes = await c.query<{ numero: number; loteId: number; apta: string; descartada: string; motivo: string | null }[]>(
    `SELECT d.numero, i.lote_id AS loteId, i.apta, i.descartada, i.motivo FROM devolucoes_remessa d
     JOIN itens_devolucao_remessa i ON i.devolucao_numero = d.numero
     WHERE d.recebimento_numero = ?`, [numero],
  );
  const porLote = Map.groupBy(detalhes, (item) => item.loteId);
  const porDevolucao = Map.groupBy(detalhes, (item) => item.numero);
  const total = (item: { apta: string; descartada: string }) => milesimos(item.apta) + milesimos(item.descartada);
  const devolvidoPorItem = new Map<number, Record<Devolucao['origem'], bigint>>();
  const porNumero = new Map(registros.map((registro) => [registro.numero, registro.origem]));
  const lotesExibidos = lotes.map(({ despachada, ...lote }) => {
    let devolvida = 0n;
    const origens = devolvidoPorItem.get(lote.apresentacaoId) ?? { recusa: 0n, apos_recebimento: 0n };
    for (const item of porLote.get(lote.loteId) ?? []) {
      const origem = porNumero.get(item.numero);
      if (origem === undefined) throw new Error('Devolução sem origem.');
      const quantidade = total(item);
      devolvida += quantidade;
      origens[origem] += quantidade;
    }
    devolvidoPorItem.set(lote.apresentacaoId, origens);
    return { ...lote, saldoDevolvivel: formatar(milesimos(despachada) - devolvida, lote.unidade), vencido: lote.validade < hoje };
  });
  const devolucoes = registros.map((registro) => {
    const linhas = new Map((porDevolucao.get(registro.numero) ?? []).map((item) => [item.loteId, item]));
    return { ...registro, lotes: lotes.flatMap(({ despachada: _, ...lote }) => {
      const item = linhas.get(lote.loteId);
      return item ? [{ ...lote, apta: formatar(milesimos(item.apta), lote.unidade),
        descartada: formatar(milesimos(item.descartada), lote.unidade), motivo: item.motivo }] : [];
    }) };
  });
  return { recebimentoNumero: numero, lotes: lotesExibidos, devolucoes, itens: itens.map((item) => {
    const origens = devolvidoPorItem.get(item.apresentacaoId);
    return { apresentacaoId: item.apresentacaoId,
      disponivelRecusa: formatar(milesimos(item.recusada) - (origens?.recusa ?? 0n), item.unidade),
      disponivelAposRecebimento: formatar(milesimos(item.recebida) - (origens?.apos_recebimento ?? 0n), item.unidade) };
  }) };
}

export async function consultarDevolucoes(db: Pool, pedido: number, saida: number, agora: Date): Promise<Devolucoes | null> {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const dados = await lerContexto(c, pedido, saida, dataLocal(agora));
    await c.commit();
    return dados ? { remessaNumero: saida, ...dados } : null;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally { c.release(); }
}

export async function registrarDevolucao(
  db: Pool, usuario: Usuario, pedido: number, saida: number, devolucao: Devolucao, agora: () => Date,
): Promise<Resultado> {
  const { devolucaoId, origem } = devolucao;
  const lotes = devolucao.lotes.map((lote) => ({ ...lote,
    apta: formatar(milesimos(lote.apta), 'kg'), descartada: formatar(milesimos(lote.descartada), 'kg'), motivo: lote.motivo ?? null,
  })).sort((a, b) => a.loteId - b.loteId);
  const hash = createHash('sha256').update(JSON.stringify({
    pedido, saida, origem, lotes: lotes.map(({ loteId, apta, descartada, motivo }) => ({ loteId, apta, descartada, motivo })),
  })).digest('hex');
  const c = await db.getConnection();
  const sucesso = (numero: number, criado: boolean): Resultado =>
    ({ success: true, criado, data: { devolucaoId, numero } });
  async function recuperar(): Promise<Resultado | null> {
    const [existente] = await c.query<{ numero: number; hash: string }[]>(
      'SELECT numero, conteudo_hash AS hash FROM devolucoes_remessa WHERE usuario_id = ? AND devolucao_id = ?', [usuario.id, devolucaoId],
    );
    return !existente ? null : existente.hash === hash ? sucesso(existente.numero, false) : { success: false, error: 'conflito' };
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
  } finally { c.release(); }

  async function gravar(): Promise<Resultado> {
    const [venda] = await c.query<{ numero: number }[]>('SELECT numero FROM pedidos WHERE numero = ? FOR UPDATE', [pedido]);
    if (!venda) return { success: false, error: 'remessa' };
    const existente = await recuperar();
    if (existente) return existente;
    const dados = await lerContexto(c, pedido, saida, dataLocal(agora()));
    if (!dados) return { success: false, error: 'remessa' };
    if (dados.recebimentoNumero === null) return { success: false, error: 'recebimento' };
    const porLote = new Map(dados.lotes.map((lote) => [lote.loteId, lote]));
    const porItem = new Map(dados.itens.map((item) => [
      item.apresentacaoId, milesimos(origem === 'recusa' ? item.disponivelRecusa : item.disponivelAposRecebimento),
    ]));
    for (const item of lotes) {
      const lote = porLote.get(item.loteId);
      const apta = milesimos(item.apta);
      const descartada = milesimos(item.descartada);
      const quantidade = apta + descartada;
      if (!lote || quantidade === 0n || (descartada > 0n) !== (item.motivo !== null)
        || (lote.unidade !== 'kg' && (apta % 1000n !== 0n || descartada % 1000n !== 0n))) {
        return { success: false, error: 'quantidade' };
      }
      const podeRetornar = porItem.get(lote.apresentacaoId) ?? 0n;
      if (quantidade > podeRetornar || quantidade > milesimos(lote.saldoDevolvivel)) {
        return { success: false, error: 'limite' };
      }
      porItem.set(lote.apresentacaoId, podeRetornar - quantidade);
    }
    const reposicoes = lotes.filter((item) => milesimos(item.apta) > 0n);
    if (reposicoes.length) {
      await c.query(
        `SELECT id FROM lotes_estoque WHERE id IN (${reposicoes.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`,
        reposicoes.map((item) => item.loteId),
      );
    }
    const registradaEm = agora();
    const hoje = dataLocal(registradaEm);
    if (reposicoes.some((item) => (porLote.get(item.loteId)?.validade ?? '') < hoje)) {
      return { success: false, error: 'vencido' };
    }
    const { insertId } = await c.query<{ insertId: bigint }>(
      `INSERT INTO devolucoes_remessa
       (devolucao_id, recebimento_numero, usuario_id, responsavel, registrada_em, origem, conteudo_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [devolucaoId, dados.recebimentoNumero, usuario.id, usuario.nome, registradaEm.toISOString(), origem, hash],
    );
    const numero = Number(insertId);
    for (const item of lotes) {
      if (milesimos(item.apta) > 0n) await c.query('UPDATE lotes_estoque SET saldo = saldo + ? WHERE id = ?', [item.apta, item.loteId]);
      await c.query(
        'INSERT INTO itens_devolucao_remessa (devolucao_numero, lote_id, apta, descartada, motivo) VALUES (?, ?, ?, ?, ?)',
        [numero, item.loteId, item.apta, item.descartada, item.motivo],
      );
    }
    return sucesso(numero, true);
  }
}
