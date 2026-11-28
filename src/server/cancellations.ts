import { createHash } from 'node:crypto';
import type { Pool, PoolConnection } from 'mariadb';
import type { CancelamentoRegistrado, CancelarSaldo } from '../contracts/cancellations.js';
import type { Usuario } from '../contracts/pilot.js';
import { lerItensParaDespacho, pendenteDeDespacho } from './dispatch-balance.js';
import { isDuplicate } from './orders.js';
import { formatar, milesimos } from './quantities.js';

type Resultado = { success: true; criado: boolean; data: { numero: number; cancelamentoId: string } }
  | { success: false; error: 'pedido' | 'quantidade' | 'pendente' | 'conflito' };

export async function registrarCancelamento(
  db: Pool, usuario: Usuario, pedido: number, dados: CancelarSaldo, agora: () => Date,
): Promise<Resultado> {
  const { cancelamentoId, motivo } = dados;
  const itens = dados.itens.map(({ apresentacaoId, quantidade }) => ({
    apresentacaoId, quantidade: formatar(milesimos(quantidade), 'kg'),
  })).sort((a, b) => a.apresentacaoId - b.apresentacaoId);
  const hash = createHash('sha256').update(JSON.stringify({ pedido, motivo, itens })).digest('hex');
  const conexao = await db.getConnection();
  const sucesso = (numero: number, criado: boolean): Resultado => ({ success: true, criado, data: { numero, cancelamentoId } });

  async function recuperar(): Promise<Resultado | null> {
    const [r] = await conexao.query<{ numero: number; hash: string }[]>(
      'SELECT numero, conteudo_hash AS hash FROM cancelamentos_pedido WHERE usuario_id = ? AND cancelamento_id = ?',
      [usuario.id, cancelamentoId],
    );
    return r ? r.hash === hash ? sucesso(r.numero, false) : { success: false, error: 'conflito' } : null;
  }

  async function gravar(): Promise<Resultado> {
    // O mesmo bloqueio serializa despacho, recebimento e cancelamento do pedido.
    const [existe] = await conexao.query('SELECT numero FROM pedidos WHERE numero = ? FOR UPDATE', [pedido]);
    if (!existe) return { success: false, error: 'pedido' };
    const anterior = await recuperar();
    if (anterior) return anterior;
    const saldos = new Map((await lerItensParaDespacho(conexao, pedido)).map((item) => [item.apresentacaoId, item]));
    for (const { apresentacaoId, quantidade } of itens) {
      const item = saldos.get(apresentacaoId);
      const qtd = milesimos(quantidade);
      if (!item || (item.unidade !== 'kg' && qtd % 1000n !== 0n)) return { success: false, error: 'quantidade' };
      if (qtd > pendenteDeDespacho(item)) return { success: false, error: 'pendente' };
    }
    const { insertId } = await conexao.query<{ insertId: bigint }>(
      `INSERT INTO cancelamentos_pedido
       (cancelamento_id, pedido_numero, usuario_id, responsavel, autorizado_em, motivo, conteudo_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cancelamentoId, pedido, usuario.id, usuario.nome, agora().toISOString(), motivo, hash],
    );
    const numero = Number(insertId);
    for (const item of itens) {
      await conexao.query(
        'INSERT INTO itens_cancelamento_pedido (cancelamento_numero, apresentacao_id, quantidade) VALUES (?, ?, ?)',
        [numero, item.apresentacaoId, item.quantidade],
      );
    }
    return sucesso(numero, true);
  }

  try {
    await conexao.beginTransaction();
    const r = await gravar();
    if (r.success && r.criado) await conexao.commit();
    else await conexao.rollback();
    return r;
  } catch (error) {
    await conexao.rollback();
    if (isDuplicate(error)) return await recuperar() ?? { success: false, error: 'conflito' };
    if (error instanceof Error && 'code' in error
      && (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT')) {
      return { success: false, error: 'conflito' };
    }
    throw error;
  } finally {
    conexao.release();
  }
}

export async function consultarCancelamentos(conexao: PoolConnection, pedido: number): Promise<CancelamentoRegistrado[]> {
  type Linha = Omit<CancelamentoRegistrado, 'itens'> & CancelamentoRegistrado['itens'][number];
  const linhas = await conexao.query<Linha[]>(
    `SELECT c.numero, c.responsavel, c.motivo, c.autorizado_em AS autorizadoEm,
       i.apresentacao_id AS apresentacaoId, i.quantidade
     FROM cancelamentos_pedido c JOIN itens_cancelamento_pedido i ON i.cancelamento_numero = c.numero
     WHERE c.pedido_numero = ? ORDER BY c.numero DESC, i.apresentacao_id`,
    [pedido],
  );
  const registros = new Map<number, CancelamentoRegistrado>();
  for (const { numero, responsavel, motivo, autorizadoEm, apresentacaoId, quantidade } of linhas) {
    const r = registros.get(numero) ?? { numero, responsavel, motivo, autorizadoEm, itens: [] };
    r.itens.push({ apresentacaoId, quantidade });
    registros.set(numero, r);
  }
  return [...registros.values()];
}
