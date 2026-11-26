import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { parse, safeParse } from 'valibot';
import {
  apresentacoesEstoqueSchema, confirmacaoEntradaSchema, detalheEntradaSchema, entradaEstoqueSchema, saldosEstoqueSchema,
} from '../../../contracts/stock.js';
import type { ApresentacoesEstoque, DetalheEntrada, EntradaEstoque, SaldosEstoque } from '../../../contracts/stock.js';
import { api, json } from '../../shared/api/index.js';

type Apresentacao = ApresentacoesEstoque['apresentacoes'][number];
type Lote = EntradaEstoque['lotes'][number];
type Linha = Lote & { chave: number };
const novoLote = (chave: number): Linha => ({ chave, codigo: '', validade: '', quantidade: '' });
const dataCurta = (validade: string) => validade.split('-').reverse().join('/');
const quantidadeBr = (quantidade: string) => quantidade.replace('.', ',');
const dataHora = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Belem',
});

function recuperarEnvio(chave: string): EntradaEstoque | null {
  try {
    const texto = sessionStorage.getItem(chave);
    return texto ? parse(entradaEstoqueSchema, JSON.parse(texto)) : null;
  } catch {
    return null;
  }
}

function SaldoPorValidade({ apresentacao }: { apresentacao: Apresentacao }) {
  const [saldos, setSaldos] = useState<SaldosEstoque | null>(null);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api(`/estoque/saldos/${apresentacao.id}`, (valor) => parse(saldosEstoqueSchema, valor), {
      signal: controller.signal,
    }).then((r) => {
      if (controller.signal.aborted) return;
      if (r.success) setSaldos(r.data);
      else setErro(r.mensagem);
    });
    return () => controller.abort();
  }, [apresentacao.id, versao]);

  return <section className="panel estoque-painel" aria-label="Saldo por validade">
    <h2>Saldo por validade</h2>
    {erro && <p className="erro" role="alert">{erro}</p>}
    {!saldos && !erro && <p role="status">Consultando saldo…</p>}
    {saldos && <>
      <p>Saldo físico: <strong>{quantidadeBr(saldos.totalFisico)}</strong> {apresentacao.unidade}
        {' · '}Disponível: <strong>{quantidadeBr(saldos.totalDisponivel)}</strong> {apresentacao.unidade}</p>
      {saldos.validades.length === 0
        ? <p>Nenhum lote registrado para esta apresentação.</p>
        : <div className="table-panel"><table>
          <thead><tr><th>Validade</th><th>Físico</th><th>Disponível</th><th>Situação</th></tr></thead>
          <tbody>{saldos.validades.map((grupo) => <tr key={grupo.validade}>
            <td><time dateTime={grupo.validade}>{dataCurta(grupo.validade)}</time></td>
            <td>{quantidadeBr(grupo.fisico)}</td><td>{quantidadeBr(grupo.disponivel)}</td>
            <td>{grupo.vencida ? 'Vencida' : 'Dentro da validade'}</td>
          </tr>)}</tbody>
        </table></div>}
    </>}
    {(saldos || erro) && <button type="button" className="secondary" onClick={() => {
      setSaldos(null);
      setErro('');
      setVersao(versao + 1);
    }}>Atualizar saldo</button>}
  </section>;
}

function ConsultaEntrada() {
  const [entrada, setEntrada] = useState<DetalheEntrada | null>(null);
  const [erro, setErro] = useState('');
  const [consultando, setConsultando] = useState(false);
  async function consultar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (consultando) return;
    const numero = Number(new FormData(event.currentTarget).get('numero'));
    setEntrada(null);
    setErro('');
    setConsultando(true);
    const r = await api(`/estoque/entradas/${numero}`, (valor) => parse(detalheEntradaSchema, valor));
    setConsultando(false);
    if (r.success) setEntrada(r.data);
    else setErro(r.mensagem);
  }
  return <section className="panel estoque-painel" aria-label="Histórico de entradas">
    <h2>Histórico de entradas</h2>
    <form className="estoque-consulta" onSubmit={consultar}>
      <label>Número da entrada<input name="numero" inputMode="numeric" pattern="[1-9][0-9]{0,9}" required maxLength={10} /></label>
      <button type="submit" className="secondary" disabled={consultando}>{consultando ? 'Consultando…' : 'Consultar entrada'}</button>
    </form>
    {erro && <p className="erro" role="alert">{erro}</p>}
    {entrada && <>
      <p><strong>Entrada nº {entrada.numero} · {entrada.apresentacao}</strong></p>
      <p>{entrada.responsavel} · <time dateTime={entrada.recebidoEm}>{dataHora.format(new Date(entrada.recebidoEm))}</time></p>
      <div className="table-panel"><table>
        <thead><tr><th>Lote</th><th>Validade</th><th>Quantidade ({entrada.unidade})</th></tr></thead>
        <tbody>{entrada.lotes.map((lote) => <tr key={JSON.stringify([lote.validade, lote.codigo])}>
          <td>{lote.codigo}</td><td><time dateTime={lote.validade}>{dataCurta(lote.validade)}</time></td>
          <td>{quantidadeBr(lote.quantidade)}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}

export function Estoque({ usuarioId }: { usuarioId: number }) {
  const chaveEnvio = `amendoas-entrada-estoque-${usuarioId}`;
  const [envio, setEnvio] = useState(() => recuperarEnvio(chaveEnvio));
  const [apresentacaoId, setApresentacaoId] = useState(envio?.apresentacaoId ?? 0);
  const [linhas, setLinhas] = useState<Linha[]>(() => envio
    ? envio.lotes.map((lote, chave) => ({ ...lote, quantidade: quantidadeBr(lote.quantidade), chave }))
    : [novoLote(0)]);
  const proximaChave = useRef(linhas.length);
  const [apresentacoes, setApresentacoes] = useState<Apresentacao[] | null>(null);
  const [erroCatalogo, setErroCatalogo] = useState('');
  const [versaoCatalogo, setVersaoCatalogo] = useState(0);
  const [versaoSaldo, setVersaoSaldo] = useState(0);
  const [erro, setErro] = useState('');
  const [confirmada, setConfirmada] = useState<number | null>(null);
  const [aguardando, setAguardando] = useState(false);
  const apresentacao = apresentacoes?.find((opcao) => opcao.id === apresentacaoId);

  useEffect(() => {
    const controller = new AbortController();
    void api('/estoque/apresentacoes', (valor) => parse(apresentacoesEstoqueSchema, valor), {
      signal: controller.signal,
    }).then((r) => {
      if (controller.signal.aborted) return;
      if (r.success) setApresentacoes(r.data.apresentacoes);
      else setErroCatalogo(r.mensagem);
    });
    return () => controller.abort();
  }, [versaoCatalogo]);

  function alterarLinha(chave: number, campo: keyof Lote, valor: string) {
    setLinhas((atuais) => atuais.map((linha) => linha.chave === chave ? { ...linha, [campo]: valor } : linha));
  }

  async function registrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (aguardando) return;
    setErro('');
    setConfirmada(null);
    let payload = envio;
    if (!payload && apresentacao) {
      const dados = safeParse(entradaEstoqueSchema, {
        entradaId: crypto.randomUUID(), apresentacaoId,
        lotes: linhas.map(({ codigo, validade, quantidade }) => ({
          codigo, validade, quantidade: quantidade.trim().replace(',', '.'),
        })),
      });
      if (!dados.success) {
        setErro('Confira os lotes, validades e quantidades. Não repita lote e validade.');
        return;
      }
      if (apresentacao.unidade !== 'kg' && dados.output.lotes.some(({ quantidade }) => !Number.isInteger(Number(quantidade)))) {
        setErro('Pacotes e caixas exigem quantidade inteira.');
        return;
      }
      try {
        sessionStorage.setItem(chaveEnvio, JSON.stringify(dados.output));
      } catch {
        setErro('Habilite o armazenamento desta aba para recuperar a entrada se a conexão cair.');
        return;
      }
      payload = dados.output;
      setEnvio(payload);
    }
    if (!payload) return;
    setAguardando(true);
    const r = await api('/estoque/entradas', (valor) => parse(confirmacaoEntradaSchema, valor), json('POST', payload));
    setAguardando(false);
    if (r.success || r.status === 400 || r.status === 422) {
      if (recuperarEnvio(chaveEnvio)?.entradaId === payload.entradaId) sessionStorage.removeItem(chaveEnvio);
      setEnvio(null);
    }
    if (r.success) {
      setConfirmada(r.data.numero);
      setLinhas([novoLote(proximaChave.current++)]);
      setVersaoSaldo((versaoAtual) => versaoAtual + 1);
    } else {
      setErro(r.mensagem);
    }
  }

  return <>
    <header className="page-header"><h1>Estoque</h1></header>
    <div className="estoque-grade">
      <form className="panel estoque-painel" onSubmit={registrar} aria-label="Entrada de mercadoria">
        <h2>Entrada de mercadoria</h2>
        {confirmada !== null && <p className="confirmed" role="status">Entrada nº {confirmada} registrada.</p>}
        {erro && <p className="erro" role="alert">{erro}</p>}
        {envio && <p role="status">Recupere a confirmação desta entrada antes de registrar outra.</p>}
        {!envio && erroCatalogo && <>
          <p className="erro" role="alert">{erroCatalogo}</p>
          <button type="button" onClick={() => { setErroCatalogo(''); setVersaoCatalogo(versaoCatalogo + 1); }}>Tentar novamente</button>
        </>}
        {!envio && !apresentacoes && !erroCatalogo && <p role="status">Carregando apresentações…</p>}
        {!envio && apresentacoes?.length === 0 && <p>Nenhum produto foi cadastrado.</p>}
        {apresentacoes && apresentacoes.length > 0 && <fieldset disabled={envio !== null || aguardando} hidden={envio !== null}>
          <label>Produto e apresentação
            <select value={apresentacaoId || ''} required onChange={(event) => setApresentacaoId(Number(event.target.value))}>
              <option value="" disabled>Selecione</option>
              {apresentacoes.map((opcao) => <option key={opcao.id} value={opcao.id}>{opcao.apresentacao} · {opcao.unidade}</option>)}
            </select>
          </label>
          {apresentacao && <>
            {linhas.map((lote, indice) => <div className="lote-linha" key={lote.chave}>
              <div className="actions"><h3>Lote {indice + 1}</h3>
                {linhas.length > 1 && <button type="button" className="link" aria-label={`Remover lote ${indice + 1}`}
                  onClick={() => setLinhas((atuais) => atuais.filter((linha) => linha.chave !== lote.chave))}>Remover</button>}
              </div>
              <label>Código do lote<input value={lote.codigo} maxLength={80} required
                onChange={(event) => alterarLinha(lote.chave, 'codigo', event.target.value)} /></label>
              <div className="lote-valores">
                <label>Validade<input type="date" value={lote.validade} required
                  onChange={(event) => alterarLinha(lote.chave, 'validade', event.target.value)} /></label>
                <label>Quantidade ({apresentacao.unidade})<input value={lote.quantidade} maxLength={10}
                  inputMode={apresentacao.unidade === 'kg' ? 'decimal' : 'numeric'} required
                  onChange={(event) => alterarLinha(lote.chave, 'quantidade', event.target.value)} /></label>
              </div>
            </div>)}
            <button type="button" className="secondary" disabled={linhas.length >= 100}
              onClick={() => setLinhas([...linhas, novoLote(proximaChave.current++)])}>Adicionar lote</button>
          </>}
        </fieldset>}
        {(envio || apresentacao) && <button type="submit" disabled={aguardando}>
          {aguardando ? 'Registrando…' : envio ? 'Recuperar confirmação' : 'Registrar entrada'}
        </button>}
      </form>
      <div className="estoque-coluna">
        {apresentacao && <SaldoPorValidade key={`${apresentacao.id}:${versaoSaldo}`} apresentacao={apresentacao} />}
        <ConsultaEntrada />
      </div>
    </div>
  </>;
}
