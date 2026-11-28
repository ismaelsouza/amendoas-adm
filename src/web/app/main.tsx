import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { parse } from 'valibot';
import { loginWebConfigSchema } from '../../contracts/login-web.js';
import { ambienteSchema, sessaoSchema } from '../../contracts/pilot.js';
import type { Ambiente, Usuario } from '../../contracts/pilot.js';
import { perfisEstoque } from '../../contracts/stock.js';
import { CadastrosPendentes, useTotalCadastrosPendentes } from '../pages/cadastros/pendentes.js';
import { Estoque } from '../pages/estoque/index.js';
import { Pedidos } from '../pages/pedidos/index.js';
import { Produtos } from '../pages/produtos/index.js';
import { Usuarios } from '../pages/usuarios/index.js';
import { api, json } from '../shared/api/index.js';
import { tokenDoLogin } from './recaptcha.js';
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

function consultarConfiguracaoLogin() {
  return api('/sessao/web/configuracao', (value) => parse(loginWebConfigSchema, value));
}

function Login({ ambiente, onLogin }: { ambiente: Ambiente; onLogin: (usuario: Usuario) => void }) {
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [protegeComGoogle, setProtegeComGoogle] = useState(false);

  useEffect(() => {
    void consultarConfiguracaoLogin().then((config) => {
      if (config.success && config.data.chaveRecaptcha) setProtegeComGoogle(true);
    });
  }, []);

  async function entrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando) return;
    const dados = new FormData(event.currentTarget);
    setEnviando(true);
    setErro('');
    try {
      const config = await consultarConfiguracaoLogin();
      if (!config.success) return setErro(config.mensagem);
      const chave = config.data.chaveRecaptcha;
      setProtegeComGoogle(chave !== null);
      const tokenRecaptcha = chave ? await tokenDoLogin(chave) : undefined;
      const resultado = await api('/sessao/web', (value) => parse(sessaoSchema, value), json('POST', {
        login: dados.get('login'), senha: dados.get('senha'), tokenRecaptcha,
      }));
      if (!resultado.success) return setErro(resultado.mensagem);
      if (chave) {
        // A sessão já está no cookie. Recarregue sem levar o script do Google para o painel.
        window.location.reload();
      } else {
        onLogin(resultado.data);
      }
    } catch {
      setErro('Não foi possível carregar a verificação do Google. Confira a conexão e tente novamente.');
    } finally {
      setEnviando(false);
    }
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
        {protegeComGoogle && <p className="login-recaptcha">
          Este site é protegido pelo reCAPTCHA. Aplicam-se a{' '}
          <a href="https://policies.google.com/privacy">Política de Privacidade</a> e os{' '}
          <a href="https://policies.google.com/terms">Termos de Serviço</a> do Google.
        </p>}
      </form>
    </main>
  </>;
}

function App() {
  const [ambiente, setAmbiente] = useState<Ambiente>(() => ambientePorHost());
  const [usuario, setUsuario] = useState<Usuario | null | undefined>(undefined);
  const [tela, setTela] = useState<'pedidos' | 'estoque' | 'usuarios' | 'cadastros' | 'produtos'>('pedidos');
  const [erro, setErro] = useState('');
  const [saindo, setSaindo] = useState(false);
  const administrador = usuario?.perfil === 'administrador';
  const pendencias = useTotalCadastrosPendentes(administrador);

  useEffect(() => {
    void api('/ambiente', (value) => parse(ambienteSchema, value)).then((resultado) => {
      if (resultado.success) setAmbiente(resultado.data.ambiente);
    });
    void api('/sessao/web', (value) => parse(sessaoSchema, value)).then((resultado) => {
      setUsuario(resultado.success ? resultado.data : null);
    });
  }, []);

  useEffect(() => {
    const base = `${tela === 'produtos' ? 'Produtos' : 'Pedidos'} | Casa das Amêndoas`;
    document.title = ambiente === 'dsv' ? `[DSV] ${base}` : base;
  }, [ambiente, tela]);

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
        {administrador && <button type="button" aria-current={tela === 'produtos' ? 'page' : undefined} onClick={() => setTela('produtos')}>Produtos</button>}
        {administrador && <button type="button" aria-current={tela === 'cadastros' ? 'page' : undefined} onClick={() => setTela('cadastros')}>
          Cadastros{pendencias.total > 0 && <span className="contador-cadastros"> ({pendencias.total})</span>}
        </button>}
        {administrador && <button type="button" aria-current={tela === 'usuarios' ? 'page' : undefined} onClick={() => setTela('usuarios')}>Usuários</button>}
      </div>
    </nav>
    <main className="shell main">
      {erro && <p role="alert" className="erro">{erro}</p>}
      {tela === 'pedidos' && <Pedidos usuarioId={usuario.id} podeRegistrar={usuario.perfil !== 'estoque'}
        podeExpedir={podeOperarEstoque} podeAutorizar={usuario.perfil === 'administrador' || usuario.perfil === 'gerente'} />}
      {tela === 'estoque' && podeOperarEstoque && <Estoque usuarioId={usuario.id} />}
      {tela === 'produtos' && administrador && <Produtos usuarioId={usuario.id} />}
      {tela === 'cadastros' && administrador && <CadastrosPendentes aoAtualizar={pendencias.atualizar} />}
      {tela === 'usuarios' && administrador && <Usuarios usuarioAtual={usuario} />}
    </main>
  </>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Elemento principal ausente.');
createRoot(root).render(<App />);
