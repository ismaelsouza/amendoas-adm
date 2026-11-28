import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { maxLength, parse, pipe, regex, safeParse, string, transform, trim } from 'valibot';
import { catalogoProdutosSchema, novoProdutoSchema, produtoCadastradoSchema } from '../../../contracts/catalogo.js';
import type { NovoProduto, Produto } from '../../../contracts/catalogo.js';
import { api, json } from '../../shared/api/index.js';
import './produtos.css';

const rotulosUnidade = { kg: 'Quilograma (kg)', pacote: 'Pacote', caixa: 'Caixa' };
const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const valorEmReais = new Intl.NumberFormat('pt-BR', {
  useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const precoEmCentavos = pipe(string(), trim(), maxLength(10), regex(/^\d{1,7}(?:[,.]\d{1,2})?$/),
  transform((valor) => {
    const [reais, centavos = ''] = valor.split(/[,.]/);
    return Number(reais) * 100 + Number(centavos.padEnd(2, '0'));
  }));

function recuperarCadastro(chave: string): NovoProduto | null {
  try {
    const salvo = sessionStorage.getItem(chave);
    return salvo ? parse(novoProdutoSchema, JSON.parse(salvo)) : null;
  } catch {
    return null;
  }
}

function FormularioProduto({ chave, aoSalvar, aoCancelar }: {
  chave: string; aoSalvar: (nome: string) => void; aoCancelar: () => void;
}) {
  const [pendente, setPendente] = useState(() => recuperarCadastro(chave));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const nomeProduto = useRef<HTMLInputElement>(null);
  useEffect(() => nomeProduto.current?.focus(), []);

  function limparEnvio() {
    setPendente(null);
    try {
      sessionStorage.removeItem(chave);
    } catch {
      // O navegador pode bloquear o armazenamento da aba.
    }
  }

  async function salvar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (salvando) return;
    const campos = new FormData(event.currentTarget);
    const preco = safeParse(precoEmCentavos, campos.get('preco'));
    const dados = safeParse(novoProdutoSchema, pendente ?? {
      cadastroId: crypto.randomUUID(),
      nome: campos.get('nomeProduto'),
      apresentacao: {
        nome: campos.get('nomeApresentacao'),
        unidade: campos.get('unidade'),
        precoPadraoCentavos: preco.success ? preco.output : null,
      },
    });
    if (!dados.success) {
      setErro('Confira os nomes, a unidade e o preço em reais. Use até duas casas decimais.');
      return;
    }
    setSalvando(true);
    setErro('');
    setPendente(dados.output);
    try {
      sessionStorage.setItem(chave, JSON.stringify(dados.output));
    } catch {
      // A mesma aba ainda consegue reenviar o cadastro com o mesmo identificador.
    }
    const resultado = await api('/produtos', (valor) => parse(produtoCadastradoSchema, valor), json('POST', dados.output));
    setSalvando(false);
    if (resultado.success) {
      limparEnvio();
      aoSalvar(dados.output.nome);
    } else {
      if (resultado.status === 400 || resultado.status === 409) limparEnvio();
      setErro(resultado.mensagem);
    }
  }

  return <form className="panel form-panel" onSubmit={salvar} aria-labelledby="novo-produto-titulo">
    <h2 id="novo-produto-titulo">Novo produto</h2>
    <fieldset disabled={pendente !== null || salvando}>
      <label>Nome do produto
        <input ref={nomeProduto} name="nomeProduto" maxLength={120} required defaultValue={pendente?.nome} />
      </label>
    </fieldset>
    <fieldset className="produto-apresentacao" disabled={pendente !== null || salvando}>
      <legend>Apresentação inicial</legend>
      <label>Nome da apresentação
        <input name="nomeApresentacao" maxLength={120} required defaultValue={pendente?.apresentacao.nome} />
      </label>
      <div className="produto-valores">
        <label>Unidade
          <select name="unidade" required defaultValue={pendente?.apresentacao.unidade ?? ''}>
            <option value="">Selecione</option>
            {Object.entries(rotulosUnidade).map(([unidade, rotulo]) =>
              <option key={unidade} value={unidade}>{rotulo}</option>,
            )}
          </select>
        </label>
        <label>Preço padrão (R$)
          <input name="preco" inputMode="decimal" maxLength={10} placeholder="0,00" required
            defaultValue={pendente ? valorEmReais.format(pendente.apresentacao.precoPadraoCentavos / 100) : ''} />
        </label>
      </div>
    </fieldset>
    {erro && <p className="erro" role="alert">{erro}</p>}
    {pendente && !salvando && <p className="status">Envio sem confirmação. Tente confirmar novamente ou volte à grade para conferir se o produto já aparece.</p>}
    <div className="actions">
      <button type="submit" disabled={salvando}>
        {salvando ? 'Salvando…' : pendente ? 'Confirmar envio' : 'Salvar produto'}
      </button>
      <button type="button" className="secondary" disabled={salvando} onClick={() => {
        limparEnvio();
        aoCancelar();
      }}>{pendente ? 'Voltar à grade' : 'Cancelar'}</button>
    </div>
  </form>;
}

export function Produtos({ usuarioId }: { usuarioId: number }) {
  const chave = `amendoas:novo-produto:${usuarioId}`;
  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [versao, setVersao] = useState(0);
  const [mostraFormulario, setMostraFormulario] = useState(() => recuperarCadastro(chave) !== null);
  const botaoNovo = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const consulta = new AbortController();
    void api('/produtos', (valor) => parse(catalogoProdutosSchema, valor), { signal: consulta.signal }).then((resultado) => {
      if (consulta.signal.aborted) return;
      if (resultado.success) setProdutos(resultado.data.produtos);
      else setErro(resultado.mensagem);
    });
    return () => consulta.abort();
  }, [versao]);

  function atualizar() {
    setErro('');
    setProdutos(null);
    setVersao((atual) => atual + 1);
  }

  function fecharFormulario() {
    setMostraFormulario(false);
    botaoNovo.current?.focus();
  }

  return <>
    <header className="page-header">
      <div><h1>Produtos</h1><p>Consulte o catálogo e cadastre apresentações com o preço padrão de venda.</p></div>
      <button ref={botaoNovo} type="button" aria-expanded={mostraFormulario} onClick={() => {
        setMensagem('');
        setMostraFormulario(true);
      }}>Novo produto</button>
    </header>
    {mostraFormulario && <FormularioProduto chave={chave} aoCancelar={() => {
      fecharFormulario();
      atualizar();
    }} aoSalvar={(nome) => {
      fecharFormulario();
      setMensagem(`Produto ${nome} cadastrado.`);
      atualizar();
    }} />}
    <div role="status">{mensagem && <p className="confirmed">{mensagem}</p>}</div>
    {erro ? <>
      <p className="erro" role="alert">{erro}</p>
      <button type="button" className="secondary" onClick={atualizar}>Tentar novamente</button>
    </> : produtos === null ? <p className="status" role="status">Carregando produtos…</p>
      : produtos.length === 0 ? <div className="panel produtos-vazio">
        <h2>Nenhum produto cadastrado</h2><p>Cadastre um produto para adicioná-lo ao catálogo.</p>
      </div> : <ul className="produtos-grade" aria-label="Catálogo de produtos">
        {produtos.map((produto) => {
          const nome = produto.nome.trim() || `Produto #${produto.id}`;
          return <li key={produto.id}>
            <details className="produto-ficha">
              <summary>
                <strong>{nome}</strong>
                <span>{produto.apresentacoes.map((item) => {
                  const apresentacao = item.nome.trim();
                  return !apresentacao || apresentacao === nome ? rotulosUnidade[item.unidade] : apresentacao;
                }).join(' · ')}</span>
              </summary>
              <dl aria-label={`Apresentações de ${nome}`}>
                {produto.apresentacoes.map((item) => <div key={item.id}>
                  <dt>{item.nome.trim() || `Apresentação #${item.id}`}</dt>
                  <dd>{rotulosUnidade[item.unidade]} · {dinheiro.format(item.precoPadraoCentavos / 100)}</dd>
                </div>)}
              </dl>
            </details>
          </li>;
        })}
      </ul>}
  </>;
}
