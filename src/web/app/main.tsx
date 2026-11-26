import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { parse } from 'valibot';
import { ambienteSchema, sessaoSchema } from '../../contracts/pilot.js';
import type { Ambiente, Usuario } from '../../contracts/pilot.js';
import { perfisEstoque } from '../../contracts/stock.js';
import { CadastrosPendentes, useTotalCadastrosPendentes } from '../pages/cadastros/pendentes.js';
import { Estoque } from '../pages/estoque/index.js';
import { Pedidos } from '../pages/pedidos/index.js';
import { Usuarios } from '../pages/usuarios/index.js';
import { api, json } from '../shared/api/index.js';
import './style.css';

function Identidade() {
  return <span className="brand"><span className="brand-mark" aria-hidden="true">CA</span>Casa das Amêndoas</span>;
}

function FaixaAmbiente({ ambiente }: { ambiente: Ambiente }) {
  if (ambiente !== 'dsv') return null;
  return <div className="env-banner env-banner-dsv" role="note">Ambiente de desenvolvimento (DSV) — dados de teste</div>;
}

function ambientePorHost(): Ambiente {
  return /(?:^|\.)[^.]*-dsv\./i.test(window.location.hostname) ? 'dsv' : 'prd';
}

function Login({ ambiente, onLogin }: { ambiente: Ambiente; onLogin: (usuario: Usuario) => void }) {
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dados = new FormData(event.currentTarget);
    setEnviando(true);
    const resultado = await api('/sessao/web', (value) => parse(sessaoSchema, value), json('POST', {
      login: dados.get('login'),
      senha: dados.get('senha'),
    }));
    setEnviando(false);
    if (resultado.success) onLogin(resultado.data);
    else setErro(resultado.mensagem);
  }

  return <>
    <FaixaAmbiente ambiente={ambiente} />
    <main className="login">
      <div className="login-header"><Identidade /></div>
      <form onSubmit={entrar} className="panel">
        <h1>Entrar no administrativo</h1>
        <label>Login<input name="login" autoComplete="username" required maxLength={60} /></label>
        <label>Senha<input name="senha" type="password" autoComplete="current-password" required maxLength={128} /></label>
        {erro && <p role="alert" className="erro">{erro}</p>}
        <button disabled={enviando} type="submit">{enviando ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  </>;
}

function App() {
  const [ambiente, setAmbiente] = useState<Ambiente>(() => ambientePorHost());
  const [usuario, setUsuario] = useState<Usuario | null | undefined>(undefined);
  const [tela, setTela] = useState<'pedidos' | 'estoque' | 'usuarios' | 'cadastros'>('pedidos');
  const [erro, setErro] = useState('');
  const [saindo, setSaindo] = useState(false);
  const podeConferirCadastro = usuario?.perfil === 'administrador';
  const pendencias = useTotalCadastrosPendentes(podeConferirCadastro);

  useEffect(() => {
    void api('/ambiente', (value) => parse(ambienteSchema, value)).then((resultado) => {
      if (resultado.success) setAmbiente(resultado.data.ambiente);
    });
    void api('/sessao/web', (value) => parse(sessaoSchema, value)).then((resultado) => {
      setUsuario(resultado.success ? resultado.data : null);
    });
  }, []);

  useEffect(() => {
    const base = 'Pedidos | Casa das Amêndoas';
    document.title = ambiente === 'dsv' ? `[DSV] ${base}` : base;
  }, [ambiente]);

  async function sair() {
    setSaindo(true);
    const resultado = await api('/sessao/web', () => null, json('DELETE', {}));
    setSaindo(false);
    if (resultado.success) {
      setUsuario(null);
      setTela('pedidos');
      setErro('');
    } else {
      setErro(resultado.mensagem);
    }
  }

  if (usuario === undefined) return <><FaixaAmbiente ambiente={ambiente} /><p className="status" role="status">Carregando o administrativo…</p></>;
  if (usuario === null) return <Login ambiente={ambiente} onLogin={setUsuario} />;
  const podeOperarEstoque = perfisEstoque.includes(usuario.perfil);

  return <>
    <FaixaAmbiente ambiente={ambiente} />
    <header className="masthead">
      <div className="shell masthead-inner">
        <Identidade />
        <div className="usuario"><span>{usuario.nome}</span><button type="button" className="link on-dark" disabled={saindo} onClick={sair}>Sair</button></div>
      </div>
    </header>
    <nav aria-label="Administrativo" className="nav">
      <div className="shell">
        <button type="button" aria-current={tela === 'pedidos' ? 'page' : undefined} onClick={() => setTela('pedidos')}>Pedidos</button>
        {podeOperarEstoque && <button type="button" aria-current={tela === 'estoque' ? 'page' : undefined} onClick={() => setTela('estoque')}>Estoque</button>}
        {podeConferirCadastro && <button type="button" aria-current={tela === 'cadastros' ? 'page' : undefined} onClick={() => setTela('cadastros')}>
          Cadastros{pendencias.total > 0 && <span className="contador-cadastros"> ({pendencias.total})</span>}
        </button>}
        {usuario.perfil === 'administrador' && <button type="button" aria-current={tela === 'usuarios' ? 'page' : undefined} onClick={() => setTela('usuarios')}>Usuários</button>}
      </div>
    </nav>
    <main className="shell main">
      {erro && <p role="alert" className="erro">{erro}</p>}
      {tela === 'pedidos' && <Pedidos usuarioId={usuario.id} podeRegistrar={usuario.perfil !== 'estoque'}
        podeExpedir={podeOperarEstoque} podeAutorizar={usuario.perfil === 'administrador' || usuario.perfil === 'gerente'} />}
      {tela === 'estoque' && podeOperarEstoque && <Estoque usuarioId={usuario.id} />}
      {tela === 'cadastros' && podeConferirCadastro && <CadastrosPendentes aoAtualizar={pendencias.atualizar} />}
      {tela === 'usuarios' && usuario.perfil === 'administrador' && <Usuarios usuarioAtual={usuario} />}
    </main>
  </>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Elemento principal ausente.');
createRoot(root).render(<App />);
