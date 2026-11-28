import { createHash } from 'node:crypto';
import type { Pool, PoolConnection } from 'mariadb';
import type { CorrecoesPedido, SolicitarCorrecao } from '../contracts/corrections.js';
import type { Usuario } from '../contracts/pilot.js';
import { lerItensParaDespacho } from './dispatch-balance.js';
import { formatar, milesimos } from './quantities.js';

type Registro = CorrecoesPedido['correcoes'][number];
type Item = CorrecoesPedido['itens'][number];
type Resultado = { success: true; numero: number; criado?: boolean }
  | { success: false; error: 'pedido' | 'correcao' | 'bloqueio' | 'pendente' | 'itens' | 'cancelamento' | 'conflito' };

// Válido em consultas com correcoes_pedido como c. O saldo já cancelado só aumenta.
const propostaIncompativel = `EXISTS (
  SELECT 1 FROM itens_correcao_pedido proposta
  JOIN cancelamentos_pedido cancelamento ON cancelamento.pedido_numero = c.pedido_numero
  JOIN itens_cancelamento_pedido linha ON linha.cancelamento_numero = cancelamento.numero
    AND linha.apresentacao_id = proposta.apresentacao_id
  WHERE proposta.correcao_numero = c.numero
  GROUP BY proposta.apresentacao_id, proposta.quantidade_proposta
  HAVING SUM(linha.quantidade) > proposta.quantidade_proposta
)`;
export const condicaoCorrecaoPendente = `c.autorizada_em IS NULL AND NOT ${propostaIncompativel}`;

async function transacao<T>(db: Pool, operar: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await db.getConnection();
  try {
    await c.beginTransaction();
    const r = await operar(c);
    await c.commit();
    return r;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally { c.release(); }
}

async function pedidoCampo(c: PoolConnection, pedido: number, vendedorId: number | undefined, bloquear: boolean) {
  const [linha] = await c.query<{ numero: number }[]>(
    `SELECT numero FROM pedidos WHERE numero = ? AND origem = 'campo'
     ${vendedorId === undefined ? '' : 'AND usuario_id = ?'} ${bloquear ? 'FOR UPDATE' : ''}`,
    vendedorId === undefined ? [pedido] : [pedido, vendedorId],
  );
  return linha !== undefined;
}

async function temSaida(c: PoolConnection, pedido: number) {
  const [saida] = await c.query('SELECT numero FROM saidas_estoque WHERE pedido_numero = ? LIMIT 1', [pedido]);
  return saida !== undefined;
}

async function itensVigentes(c: PoolConnection, pedido: number): Promise<Item[]> {
  const itens = await c.query<Item[]>(
    `SELECT apresentacao_id AS apresentacaoId, apresentacao, unidade, quantidade, preco_unitario_centavos AS precoUnitarioCentavos
     FROM itens_pedido WHERE pedido_numero = ? ORDER BY apresentacao_id`, [pedido],
  );
  return itens.map((item) => ({ ...item, quantidade: formatar(milesimos(item.quantidade), item.unidade) }));
}

async function movimento(db: Pool, operar: (c: PoolConnection) => Promise<Resultado>): Promise<Resultado> {
  try { return await transacao(db, operar); }
  catch (error) {
    if (error instanceof Error && 'code' in error
      && (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT')) {
      return { success: false, error: 'conflito' };
    }
    throw error;
  }
}

export async function solicitarCorrecao(
  db: Pool, usuario: Usuario, pedido: number, dados: SolicitarCorrecao, agora: () => Date,
): Promise<Resultado> {
  const { correcaoId, motivo } = dados;
  const itens = dados.itens.map((item) => ({ ...item, quantidade: formatar(milesimos(item.quantidade), 'kg') }))
    .sort((a, b) => a.apresentacaoId - b.apresentacaoId);
  const hash = createHash('sha256').update(JSON.stringify({ motivo, itens })).digest('hex');
  return movimento(db, async (c) => {
    // A mesma linha é bloqueada para autorizar correção, cancelar saldo e confirmar a saída física.
    if (!await pedidoCampo(c, pedido, usuario.id, true)) return { success: false, error: 'pedido' };
    const [existente] = await c.query<{ numero: number; hash: string }[]>(
      'SELECT numero, conteudo_hash AS hash FROM correcoes_pedido WHERE pedido_numero = ? AND correcao_id = ?', [pedido, correcaoId],
    );
    if (existente) return existente.hash === hash ? { success: true, numero: existente.numero } : { success: false, error: 'conflito' };
    if (await temSaida(c, pedido)) return { success: false, error: 'bloqueio' };
    const [pendente] = await c.query(
      `SELECT c.numero FROM correcoes_pedido c WHERE c.pedido_numero = ? AND ${condicaoCorrecaoPendente} LIMIT 1`, [pedido],
    );
    if (pendente) return { success: false, error: 'pendente' };
    const vigentes = new Map((await itensVigentes(c, pedido)).map((item) => [item.apresentacaoId, item]));
    const saldos = new Map((await lerItensParaDespacho(c, pedido)).map((item) => [item.apresentacaoId, item.cancelada]));
    const mudancas = [];
    for (const item of itens) {
      const anterior = vigentes.get(item.apresentacaoId);
      const quantidade = milesimos(item.quantidade);
      if (!anterior || (anterior.unidade !== 'kg' && quantidade % 1000n !== 0n)) return { success: false, error: 'itens' };
      if (quantidade < milesimos(saldos.get(item.apresentacaoId) ?? '0')) return { success: false, error: 'cancelamento' };
      if (quantidade !== milesimos(anterior.quantidade) || item.precoUnitarioCentavos !== anterior.precoUnitarioCentavos) {
        mudancas.push({ anterior, proposta: item });
      }
    }
    if (!mudancas.length) return { success: false, error: 'itens' };
    const { insertId } = await c.query<{ insertId: bigint }>(
      `INSERT INTO correcoes_pedido (pedido_numero, correcao_id, conteudo_hash, motivo, solicitada_em, solicitada_por)
       VALUES (?, ?, ?, ?, ?, ?)`, [pedido, correcaoId, hash, motivo, agora().toISOString(), usuario.nome],
    );
    const numero = Number(insertId);
    for (const { anterior, proposta } of mudancas) {
      await c.query(
        `INSERT INTO itens_correcao_pedido
         (correcao_numero, apresentacao_id, quantidade_anterior, quantidade_proposta, preco_anterior, preco_proposto)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [numero, proposta.apresentacaoId, anterior.quantidade, proposta.quantidade, anterior.precoUnitarioCentavos, proposta.precoUnitarioCentavos],
      );
    }
    return { success: true, numero, criado: true };
  });
}

export async function aprovarCorrecao(
  db: Pool, usuario: Usuario, pedido: number, numero: number, agora: () => Date,
): Promise<Resultado> {
  return movimento(db, async (c) => {
    if (!await pedidoCampo(c, pedido, undefined, true)) return { success: false, error: 'pedido' };
    const [registro] = await c.query<{ autorizadaEm: string | null }[]>(
      'SELECT autorizada_em AS autorizadaEm FROM correcoes_pedido WHERE pedido_numero = ? AND numero = ?', [pedido, numero],
    );
    if (!registro) return { success: false, error: 'correcao' };
    if (registro.autorizadaEm) return { success: true, numero };
    if (await temSaida(c, pedido)) return { success: false, error: 'bloqueio' };
    const itens = await c.query<SolicitarCorrecao['itens']>(
      `SELECT apresentacao_id AS apresentacaoId, quantidade_proposta AS quantidade, preco_proposto AS precoUnitarioCentavos
       FROM itens_correcao_pedido WHERE correcao_numero = ? ORDER BY apresentacao_id`, [numero],
    );
    const saldos = new Map((await lerItensParaDespacho(c, pedido)).map((item) => [item.apresentacaoId, item.cancelada]));
    if (itens.some((item) => milesimos(item.quantidade) < milesimos(saldos.get(item.apresentacaoId) ?? '0'))) {
      return { success: false, error: 'cancelamento' };
    }
    for (const item of itens) {
      await c.query(
        'UPDATE itens_pedido SET quantidade = ?, preco_unitario_centavos = ? WHERE pedido_numero = ? AND apresentacao_id = ?',
        [item.quantidade, item.precoUnitarioCentavos, pedido, item.apresentacaoId],
      );
    }
    await c.query(
      'UPDATE correcoes_pedido SET autorizada_em = ?, autorizada_por = ?, autorizador_id = ? WHERE numero = ?',
      [agora().toISOString(), usuario.nome, usuario.id, numero],
    );
    return { success: true, numero };
  });
}

export async function consultarCorrecoes(db: Pool, pedido: number, vendedorId?: number): Promise<CorrecoesPedido | null> {
  return transacao(db, async (c) => {
    if (!await pedidoCampo(c, pedido, vendedorId, false)) return null;
    const saiu = await temSaida(c, pedido);
    const itens = await itensVigentes(c, pedido);
    const nomes = new Map(itens.map((item) => [item.apresentacaoId, item]));
    const linhas = await c.query<(Omit<Registro, 'itens' | 'situacao'> & {
      apresentacaoId: number; quantidadeAnterior: string; quantidadeProposta: string; precoAnterior: number; precoProposto: number;
      propostaIncompativel: number;
    })[]>(
      `SELECT c.numero, c.motivo, c.solicitada_em AS solicitadaEm, c.solicitada_por AS solicitadaPor,
         c.autorizada_em AS autorizadaEm, c.autorizada_por AS autorizadaPor, ${propostaIncompativel} AS propostaIncompativel,
         i.apresentacao_id AS apresentacaoId, i.quantidade_anterior AS quantidadeAnterior,
         i.quantidade_proposta AS quantidadeProposta, i.preco_anterior AS precoAnterior, i.preco_proposto AS precoProposto
       FROM correcoes_pedido c JOIN itens_correcao_pedido i ON i.correcao_numero = c.numero
       WHERE c.pedido_numero = ? ORDER BY c.numero DESC, i.apresentacao_id`, [pedido],
    );
    const registros = new Map<number, Registro>();
    for (const { apresentacaoId, quantidadeAnterior, quantidadeProposta, precoAnterior, precoProposto, propostaIncompativel, ...r } of linhas) {
      const item = nomes.get(apresentacaoId);
      if (!item) throw new Error('A correção aponta para uma apresentação ausente do pedido.');
      const registro: Registro = registros.get(r.numero) ?? {
        ...r, itens: [], situacao: r.autorizadaEm ? 'aprovada' : saiu || propostaIncompativel ? 'impedida' : 'pendente',
      };
      const quantidade = (qtd: string) => formatar(milesimos(qtd), item.unidade);
      registro.itens.push({ apresentacaoId, apresentacao: item.apresentacao, unidade: item.unidade,
        anterior: { quantidade: quantidade(quantidadeAnterior), precoUnitarioCentavos: precoAnterior },
        proposta: { quantidade: quantidade(quantidadeProposta), precoUnitarioCentavos: precoProposto } });
      registros.set(r.numero, registro);
    }
    const correcoes = [...registros.values()];
    return { pedidoNumero: pedido, podeSolicitar: !saiu && !correcoes.some((r) => r.situacao === 'pendente'), itens, correcoes };
  });
}
