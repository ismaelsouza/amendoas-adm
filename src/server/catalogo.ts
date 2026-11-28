import { createHash } from 'node:crypto';
import type { Pool } from 'mariadb';
import type { NovoProduto, Produto } from '../contracts/catalogo.js';
import { isDuplicate } from './orders.js';

export async function listarProdutos(db: Pool): Promise<Produto[]> {
  type Linha = Produto['apresentacoes'][number] & { produtoId: number; nomeProduto: string };
  const linhas = await db.query<Linha[]>(`SELECT p.id AS produtoId, p.nome AS nomeProduto,
    a.id, a.apresentacao AS nome, a.unidade, a.preco_padrao_centavos AS precoPadraoCentavos
    FROM produtos p JOIN produtos_apresentacoes pa ON pa.produto_id = p.id
    JOIN apresentacoes a ON a.id = pa.apresentacao_id
    ORDER BY p.nome, p.id, a.id`);
  const produtos = new Map<number, Produto>();
  for (const { produtoId, nomeProduto, ...apresentacao } of linhas) {
    const atual = produtos.get(produtoId);
    if (atual) atual.apresentacoes.push(apresentacao);
    else produtos.set(produtoId, { id: produtoId, nome: nomeProduto, apresentacoes: [apresentacao] });
  }
  return Array.from(produtos.values());
}

type Cadastro = { success: true; data: { id: number }; criado: boolean } | { success: false; error: 'conflito' };

export async function cadastrarProduto(db: Pool, cadastro: NovoProduto): Promise<Cadastro> {
  const { cadastroId, nome, apresentacao } = cadastro;
  const hash = createHash('sha256').update(JSON.stringify({ nome, apresentacao })).digest('hex');
  const conexao = await db.getConnection();
  try {
    await conexao.beginTransaction();
    const insercaoProduto = await conexao.query<{ insertId: bigint }>(
      'INSERT INTO produtos (nome, cadastro_id, cadastro_hash) VALUES (?, ?, ?)', [nome, cadastroId, hash],
    );
    const insercaoApresentacao = await conexao.query<{ insertId: bigint }>(
      'INSERT INTO apresentacoes (apresentacao, unidade, preco_padrao_centavos) VALUES (?, ?, ?)',
      [apresentacao.nome, apresentacao.unidade, apresentacao.precoPadraoCentavos],
    );
    await conexao.query('INSERT INTO produtos_apresentacoes (produto_id, apresentacao_id) VALUES (?, ?)',
      [insercaoProduto.insertId, insercaoApresentacao.insertId]);
    await conexao.commit();
    return { success: true, criado: true, data: { id: Number(insercaoProduto.insertId) } };
  } catch (error) {
    await conexao.rollback();
    if (!isDuplicate(error)) throw error;
    const [gravado] = await conexao.query<{ id: number; hash: string }[]>(
      'SELECT id, cadastro_hash AS hash FROM produtos WHERE cadastro_id = ?', [cadastroId],
    );
    if (!gravado) throw error;
    if (gravado.hash !== hash) return { success: false, error: 'conflito' };
    return { success: true, criado: false, data: { id: gravado.id } };
  } finally {
    conexao.release();
  }
}
