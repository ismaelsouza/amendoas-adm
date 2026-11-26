import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'mariadb';
import type { InferOutput } from 'valibot';
import type { Usuario, alterarUsuarioSchema } from '../contracts/pilot.js';
import { checkPassword, hashPassword } from './password.js';

export type Canal = 'app' | 'web';
type Conta = InferOutput<typeof alterarUsuarioSchema>;
const columns = 'id, nome, login, perfil';
export const sessionDurationMs = 24 * 60 * 60 * 1000;

function digest(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export async function criarSessao(db: Pool, canal: Canal, login: string, senha: string): Promise<{
  usuario: Usuario; token: string;
} | null> {
  const [row] = await db.query<(Usuario & { senhaHash: string })[]>(
    `SELECT ${columns}, senha_hash AS senhaHash FROM usuarios WHERE login = ?`, [login],
  );
  const valida = await checkPassword(senha, row?.senhaHash);
  if (!valida || !row) return null;

  const { senhaHash, ...usuario } = row;
  if ((canal === 'app') !== (usuario.perfil === 'vendedor')) return null;
  const token = randomBytes(32).toString('base64url');
  const agora = Date.now();
  await db.query('DELETE FROM sessoes WHERE expira_em <= ?', [agora]);
  const resultado = await db.query<{ affectedRows: number }>(
    `INSERT INTO sessoes (token_hash, usuario_id, canal, expira_em)
     SELECT ?, id, ?, ? FROM usuarios
     WHERE id = ? AND BINARY senha_hash = ? AND perfil = ?`,
    [digest(token), canal, agora + sessionDurationMs, usuario.id, senhaHash, usuario.perfil],
  );
  return resultado.affectedRows ? { usuario, token } : null;
}

export async function consultarSessao(db: Pool, canal: Canal, token: string): Promise<Usuario | null> {
  const [usuario] = await db.query<Usuario[]>(
    `SELECT u.id, u.nome, u.login, u.perfil FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ? AND s.canal = ? AND s.expira_em > ?`,
    [digest(token), canal, Date.now()],
  );
  if (!usuario || (canal === 'app') !== (usuario.perfil === 'vendedor')) return null;
  return usuario;
}

export async function encerrarSessao(db: Pool, canal: Canal, token: string): Promise<void> {
  await db.query('DELETE FROM sessoes WHERE token_hash = ? AND canal = ?', [digest(token), canal]);
}

export async function listarUsuarios(db: Pool): Promise<Usuario[]> {
  return db.query<Usuario[]>(`SELECT ${columns} FROM usuarios ORDER BY nome, id`);
}

export async function criarUsuario(
  db: Pool, administradorId: number, conta: Conta & { senha: string },
): Promise<Usuario | null> {
  const { senha, ...usuario } = conta;
  const resultado = await db.query<{ insertId: bigint; affectedRows: number }>(
    `INSERT INTO usuarios (nome, login, perfil, senha_hash)
     SELECT ?, ?, ?, ? FROM usuarios WHERE id = ? AND perfil = 'administrador'`,
    [usuario.nome, usuario.login, usuario.perfil, await hashPassword(senha), administradorId],
  );
  return resultado.affectedRows ? { ...usuario, id: Number(resultado.insertId) } : null;
}

type Alteracao = { success: true; data: Usuario }
  | { success: false; error: 'permissao' | 'perfilProprio' | 'naoEncontrado' };

export async function alterarUsuario(
  db: Pool, administrador: Usuario, id: number, conta: Conta,
): Promise<Alteracao> {
  const { senha, ...alteracoes } = conta;
  if (id === administrador.id && alteracoes.perfil !== 'administrador') {
    return { success: false, error: 'perfilProprio' };
  }
  const novoHash = senha === undefined ? null : await hashPassword(senha);
  const conexao = await db.getConnection();
  try {
    await conexao.beginTransaction();
    const admins = await conexao.query<{ id: number }[]>(
      "SELECT id FROM usuarios WHERE perfil = 'administrador' ORDER BY id FOR UPDATE",
    );
    if (!admins.some((usuario) => usuario.id === administrador.id)) {
      await conexao.rollback();
      return { success: false, error: 'permissao' };
    }
    const [atual] = await conexao.query<{ perfil: Usuario['perfil'] }[]>(
      'SELECT perfil FROM usuarios WHERE id = ? FOR UPDATE', [id],
    );
    if (!atual) {
      await conexao.rollback();
      return { success: false, error: 'naoEncontrado' };
    }
    await conexao.query(
      'UPDATE usuarios SET nome = ?, login = ?, perfil = ?, senha_hash = COALESCE(?, senha_hash) WHERE id = ?',
      [alteracoes.nome, alteracoes.login, alteracoes.perfil, novoHash, id],
    );
    if (novoHash !== null || alteracoes.perfil !== atual.perfil) {
      await conexao.query('DELETE FROM sessoes WHERE usuario_id = ?', [id]);
    }
    await conexao.commit();
    return { success: true, data: { ...alteracoes, id } };
  } catch (error) {
    await conexao.rollback();
    throw error;
  } finally {
    conexao.release();
  }
}

