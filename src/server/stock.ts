import { createHash } from 'node:crypto';
import type { Pool } from 'mariadb';
import type { Usuario } from '../contracts/pilot.js';
import type { ApresentacoesEstoque, DetalheEntrada, EntradaEstoque, SaldosEstoque } from '../contracts/stock.js';
import { isDuplicate } from './orders.js';

type Apresentacao = ApresentacoesEstoque['apresentacoes'][number];
type Confirmacao = { numero: number; entradaId: string };
type Recepcao = { success: true; criado: boolean; data: Confirmacao }
  | { success: false; error: 'cadastro' | 'quantidade' | 'conflito' };

const dataOperacao = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Belem', year: 'numeric', month: '2-digit', day: '2-digit',
});
export function dataLocal(agora: Date): string {
  const partes = Object.fromEntries(dataOperacao.formatToParts(agora).map(({ type, value }) => [type, value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function mostrarQuantidade(quantidade: string, unidade: Apresentacao['unidade']): string {
  return unidade === 'kg' ? quantidade : quantidade.split('.')[0] ?? '0';
}

export async function registrarEntrada(db: Pool, usuario: Usuario, entrada: EntradaEstoque, agora: Date): Promise<Recepcao> {
  const { entradaId, apresentacaoId } = entrada;
  const lotes = entrada.lotes.map((lote) => ({ ...lote, quantidade: String(Number(lote.quantidade)) }))
    .sort((a, b) => comparar(a.validade, b.validade) || comparar(a.codigo, b.codigo));
  const conteudo = createHash('sha256').update(JSON.stringify({ apresentacaoId, lotes })).digest('hex');
  const conexao = await db.getConnection();
  try {
    await conexao.beginTransaction();
    const [produto] = await conexao.query<Apresentacao[]>(
      'SELECT id, apresentacao, unidade FROM apresentacoes WHERE id = ?', [apresentacaoId],
    );
    if (!produto || (produto.unidade !== 'kg' && lotes.some((lote) => lote.quantidade.includes('.')))) {
      await conexao.rollback();
      return { success: false, error: produto ? 'quantidade' : 'cadastro' };
    }
    const insercao = await conexao.query<{ insertId: bigint }>(
      `INSERT INTO entradas_estoque (entrada_id, usuario_id, responsavel, apresentacao_id, apresentacao, unidade,
        recebido_em, conteudo_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entradaId, usuario.id, usuario.nome, produto.id, produto.apresentacao, produto.unidade, agora.toISOString(), conteudo],
    );
    const numero = Number(insercao.insertId);
    for (const lote of lotes) {
      const saldo = await conexao.query<{ insertId: bigint }>(
        `INSERT INTO lotes_estoque (apresentacao_id, validade, codigo, saldo) VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), saldo = saldo + VALUES(saldo)`,
        [apresentacaoId, lote.validade, lote.codigo, lote.quantidade],
      );
      await conexao.query(
        'INSERT INTO itens_entrada_estoque (entrada_numero, lote_id, quantidade) VALUES (?, ?, ?)',
        [numero, saldo.insertId, lote.quantidade],
      );
    }
    await conexao.commit();
    return { success: true, criado: true, data: { entradaId, numero } };
  } catch (error) {
    await conexao.rollback();
    if (!isDuplicate(error)) throw error;
    const [gravada] = await conexao.query<{ numero: number; conteudo: string }[]>(
      'SELECT numero, conteudo_hash AS conteudo FROM entradas_estoque WHERE usuario_id = ? AND entrada_id = ?',
      [usuario.id, entradaId],
    );
    if (!gravada) throw error;
    if (gravada.conteudo !== conteudo) return { success: false, error: 'conflito' };
    return { success: true, criado: false, data: { entradaId, numero: gravada.numero } };
  } finally {
    conexao.release();
  }
}

export async function consultarEntrada(db: Pool, numero: number): Promise<DetalheEntrada | null> {
  const [entrada] = await db.query<Omit<DetalheEntrada, 'lotes'>[]>(
    `SELECT numero, apresentacao_id AS apresentacaoId, apresentacao, unidade, responsavel, recebido_em AS recebidoEm
     FROM entradas_estoque WHERE numero = ?`, [numero],
  );
  if (!entrada) return null;
  const lotes = await db.query<DetalheEntrada['lotes']>(
    `SELECT l.codigo, DATE_FORMAT(l.validade, '%Y-%m-%d') AS validade, i.quantidade
     FROM itens_entrada_estoque i JOIN lotes_estoque l ON l.id = i.lote_id
     WHERE i.entrada_numero = ? ORDER BY l.validade, l.codigo`, [numero],
  );
  return { ...entrada, lotes: lotes.map((lote) => ({
    ...lote, quantidade: mostrarQuantidade(lote.quantidade, entrada.unidade),
  })) };
}

export async function listarApresentacoesEstoque(db: Pool): Promise<ApresentacoesEstoque> {
  const apresentacoes = await db.query<Apresentacao[]>(
    'SELECT id, apresentacao, unidade FROM apresentacoes ORDER BY apresentacao, id',
  );
  return { apresentacoes };
}

export async function consultarSaldos(db: Pool, apresentacaoId: number, agora: Date): Promise<SaldosEstoque | null> {
  const [apresentacao] = await db.query<Pick<Apresentacao, 'unidade'>[]>(
    'SELECT unidade FROM apresentacoes WHERE id = ?', [apresentacaoId],
  );
  if (!apresentacao) return null;
  const hoje = dataLocal(agora);
  type Linha = { validade: string | null; fisico: string | null; disponivel: string | null };
  const grupos = await db.query<Linha[]>(
    `SELECT DATE_FORMAT(validade, '%Y-%m-%d') AS validade, SUM(saldo) AS fisico,
       SUM(CASE WHEN validade >= ? THEN saldo ELSE 0 END) AS disponivel
     FROM lotes_estoque WHERE apresentacao_id = ?
     GROUP BY validade WITH ROLLUP`, [hoje, apresentacaoId],
  );
  const formatar = (quantidade: string | null) => mostrarQuantidade(quantidade ?? '0.000', apresentacao.unidade);
  const zero = formatar('0.000');
  const totais = grupos.find((linha) => linha.validade === null);
  return {
    totalFisico: totais ? formatar(totais.fisico) : zero,
    totalDisponivel: totais ? formatar(totais.disponivel) : zero,
    validades: grupos.flatMap(({ validade, fisico, disponivel }) => validade === null ? [] : [{
      validade, fisico: formatar(fisico), disponivel: formatar(disponivel), vencida: validade < hoje,
    }]).sort((a, b) => comparar(a.validade, b.validade)),
  };
}
