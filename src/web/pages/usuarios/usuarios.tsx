import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { parse } from 'valibot';
import { sessaoSchema, usuariosSchema } from '../../../contracts/pilot.js';
import type { Perfil, Usuario } from '../../../contracts/pilot.js';
import { api, json } from '../../shared/api/index.js';

const perfis: Record<Perfil, string> = {
  administrador: 'Administrador', gerente: 'Gerente', estoque: 'Estoque', balcao: 'Balcão', vendedor: 'Vendedor',
};

export function Usuarios({ usuarioAtual }: { usuarioAtual: Usuario }) {
  const [lista, setLista] = useState<Usuario[]>([]);
  const [editando, setEditando] = useState<Usuario | 'novo' | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');

  const carregar = useCallback(async (signal?: AbortSignal) => {
    setCarregando(true);
    setErro('');
    const resultado = await api('/usuarios', (value) => parse(usuariosSchema, value), signal ? { signal } : undefined);
    if (signal?.aborted) return;
    setCarregando(false);
    if (resultado.success) setLista(resultado.data.usuarios);
    else setErro(resultado.mensagem);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    return () => controller.abort();
  }, [carregar]);

  return <>
    <div className="page-header">
      <h1>Usuários</h1>
      {!editando && <button type="button" onClick={() => { setEditando('novo'); setAviso(''); }}>Novo usuário</button>}
    </div>
    {aviso && <p className="status confirmed" role="status">{aviso}</p>}
    {erro && <div className="status"><p className="erro" role="alert">{erro}</p>
      <button type="button" className="secondary" onClick={() => void carregar()}>Atualizar usuários</button>
    </div>}
    {editando && <Conta key={editando === 'novo' ? 'novo' : editando.id}
      usuario={editando === 'novo' ? null : editando} usuarioAtual={usuarioAtual}
      onCancel={() => setEditando(null)}
      onSaved={(usuario, trocouSenha) => {
        setEditando(null);
        if (usuario.id === usuarioAtual.id && trocouSenha) {
          window.location.reload();
          return;
        }
        setAviso('Cadastro salvo para ' + usuario.nome + '.');
        void carregar();
      }} />}
    {carregando && <p className="status" role="status">Carregando usuários…</p>}
    {!carregando && !erro && lista.length === 0 && <p className="panel">Nenhum usuário cadastrado.</p>}
    {lista.length > 0 && <div className="panel table-panel">
      <table>
        <thead><tr><th scope="col">Nome</th><th scope="col">Login</th><th scope="col">Perfil</th><th scope="col">Ações</th></tr></thead>
        <tbody>{lista.map((usuario) => <tr key={usuario.id}>
          <td>{usuario.nome}</td><td>{usuario.login}</td><td>{perfis[usuario.perfil]}</td>
          <td><button className="link" type="button" aria-label={'Editar ' + usuario.nome}
            onClick={() => { setEditando(usuario); setAviso(''); }}>Editar</button></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </>;
}

function Conta({ usuario, usuarioAtual, onSaved, onCancel }: {
  usuario: Usuario | null;
  usuarioAtual: Usuario;
  onSaved: (usuario: Usuario, trocouSenha: boolean) => void;
  onCancel: () => void;
}) {
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const proprioPerfil = usuario?.id === usuarioAtual.id;

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formulario = new FormData(event.currentTarget);
    const senha = formulario.get('senha');
    const dados = {
      nome: formulario.get('nome'),
      login: formulario.get('login'),
      perfil: proprioPerfil ? usuarioAtual.perfil : formulario.get('perfil'),
      ...(senha ? { senha } : {}),
    };
    setSalvando(true);
    const resultado = await api(usuario ? '/usuarios/' + usuario.id : '/usuarios',
      (value) => parse(sessaoSchema, value), json(usuario ? 'PATCH' : 'POST', dados));
    setSalvando(false);
    if (resultado.success) onSaved(resultado.data, Boolean(senha));
    else setErro(resultado.mensagem);
  }

  return <form className="panel form-panel" onSubmit={salvar}>
    <h2>{usuario ? 'Editar usuário' : 'Novo usuário'}</h2>
    <label>Nome<input name="nome" defaultValue={usuario?.nome} required maxLength={120} /></label>
    <label>Login<input name="login" autoComplete="off" defaultValue={usuario?.login}
      required minLength={3} maxLength={60} pattern="[a-zA-Z0-9._\-]{3,60}" /></label>
    <label>Perfil<select name="perfil" disabled={proprioPerfil} defaultValue={usuario?.perfil ?? 'vendedor'}>
      {Object.entries(perfis).map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
    </select></label>
    <label>{usuario ? 'Nova senha (opcional)' : 'Senha'}
      <input name="senha" type="password" autoComplete="new-password" required={!usuario} minLength={12} maxLength={128} />
    </label>
    {erro && <p className="erro" role="alert">{erro}</p>}
    <div className="actions">
      <button type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar usuário'}</button>
      <button type="button" className="secondary" disabled={salvando} onClick={onCancel}>Cancelar</button>
    </div>
  </form>;
}

