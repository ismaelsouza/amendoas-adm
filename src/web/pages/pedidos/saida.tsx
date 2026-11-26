import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { parse, safeParse } from 'valibot';
import { confirmacaoSaidaSchema, expedicaoSchema, modalidadesSaida, saidaEstoqueSchema } from '../../../contracts/dispatch.js';
import type { Expedicao, SaidaEstoque } from '../../../contracts/dispatch.js';
import { api, json } from '../../shared/api/index.js';

const modalidades: Record<SaidaEstoque['modalidade'], string> = {
  frota_propria: 'Frota própria', transportadora: 'Transportadora', retirada: 'Retirada no balcão',
};
const quantidadeBr = (valor: string) => valor.replace('.', ',');
const dataCurta = (valor: string) => valor.split('-').reverse().join('/');
const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Belem' });

function recuperarEnvio(chave: string): SaidaEstoque | null {
  try {
    const salvo = sessionStorage.getItem(chave);
    return salvo ? parse(saidaEstoqueSchema, JSON.parse(salvo)) : null;
  } catch {
    return null;
  }
}

function HistoricoSaidas({ saidas }: Pick<Expedicao, 'saidas'>) {
  if (!saidas.length) return <p>Nenhuma saída confirmada.</p>;
  return <section className="historico-saidas" aria-label="Saídas confirmadas">
    <h3>Saídas confirmadas</h3>
    {saidas.map((saida) => <article key={saida.numero}>
      <p><strong>Saída nº {saida.numero} · {modalidades[saida.modalidade]}</strong></p>
      <p>{saida.responsavel} · <time dateTime={saida.confirmadaEm}>{dataHora.format(new Date(saida.confirmadaEm))}</time></p>
      <div className="table-panel">
        <table aria-label={`Lotes da saída ${saida.numero}`}>
          <thead><tr><th>Apresentação</th><th>Lote</th><th>Validade</th><th>Saiu</th></tr></thead>
          <tbody>{saida.lotes.map((lote) => <tr key={lote.loteId}>
            <td>{lote.apresentacao}</td><td>{lote.codigo}</td><td>{dataCurta(lote.validade)}</td>
            <td>{quantidadeBr(lote.quantidade)} {lote.unidade}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </article>)}
  </section>;
}

export function SaidaPedido({ pedidoNumero, usuarioId, retiradaImediata }: {
  pedidoNumero: number; usuarioId: number; retiradaImediata: boolean;
}) {
  const chave = `amendoas-saida-${usuarioId}-${pedidoNumero}`;
  const rota = `/pedidos/${pedidoNumero}/saidas`;
  const [envio, setEnvio] = useState(() => recuperarEnvio(chave));
  const [modalidade, setModalidade] = useState<string>(envio?.modalidade ?? (retiradaImediata ? 'retirada' : ''));
  const [quantidades, setQuantidades] = useState<Record<number, string>>({});
  const [expedicao, setExpedicao] = useState<Expedicao | null>(null);
  const [confirmada, setConfirmada] = useState<number | null>(null);
  const [consultando, setConsultando] = useState(true);
  const [aguardando, setAguardando] = useState(false);
  const [erro, setErro] = useState('');
  const [erroConsulta, setErroConsulta] = useState('');

  const carregar = useCallback(async (usarSugestao: boolean, signal?: AbortSignal) => {
    setConsultando(true);
    setErroConsulta('');
    const r = await api(rota, (valor) => parse(expedicaoSchema, valor), signal ? { signal } : undefined);
    if (signal?.aborted) return;
    setConsultando(false);
    if (!r.success) {
      setExpedicao(null);
      setErroConsulta(r.mensagem);
      return;
    }
    setExpedicao(r.data);
    setQuantidades(usarSugestao ? Object.fromEntries(r.data.itens.flatMap(({ lotes }) => lotes.flatMap((lote) =>
      Number(lote.sugerida) > 0 ? [[lote.loteId, quantidadeBr(lote.sugerida)]] : []))) : {});
  }, [rota]);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(true, controller.signal);
    return () => controller.abort();
  }, [carregar]);

  const itensPendentes = expedicao?.itens.filter((item) => Number(item.pendente) > 0) ?? [];
  const disponiveis = itensPendentes.filter((item) => item.lotes.length > 0);

  async function confirmar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (aguardando) return;
    setErro('');
    setConfirmada(null);
    let payload = envio;
    if (!payload && !consultando && disponiveis.length > 0) {
      const lotes = disponiveis.flatMap((item) => item.lotes.flatMap(({ loteId }) => {
        const quantidade = quantidades[loteId]?.trim().replace(',', '.');
        return quantidade && !/^0+(?:\.0+)?$/.test(quantidade) ? [{ loteId, quantidade }] : [];
      }));
      const dados = safeParse(saidaEstoqueSchema, { saidaId: crypto.randomUUID(), modalidade, lotes });
      if (!dados.success) {
        setErro('Informe a modalidade e uma quantidade válida em pelo menos um lote.');
        return;
      }
      try {
        sessionStorage.setItem(chave, JSON.stringify(dados.output));
      } catch {
        setErro('Habilite o armazenamento desta aba para recuperar a saída se a conexão cair.');
        return;
      }
      payload = dados.output;
      setEnvio(payload);
    }
    if (!payload) return;
    setAguardando(true);
    const r = await api(rota, (valor) => parse(confirmacaoSaidaSchema, valor), json('POST', payload));
    setAguardando(false);
    if (r.success || [400, 409, 422].includes(r.status)) {
      if (recuperarEnvio(chave)?.saidaId === payload.saidaId) sessionStorage.removeItem(chave);
      setEnvio(null);
    }
    if (r.success) {
      setConfirmada(r.data.numero);
      void carregar(false);
    } else {
      setErro(r.mensagem);
      if (r.status === 409) void carregar(false);
    }
  }

  return <section className="panel saida-pedido" aria-label={`Saída física do pedido ${pedidoNumero}`}>
    <div className="actions">
      <h2>Saída física</h2>
      <button className="secondary" type="button" disabled={consultando || aguardando || envio !== null}
        onClick={() => { setErro(''); void carregar(true); }}>Atualizar sugestões</button>
    </div>
    {confirmada !== null && <p className="confirmed" role="status">Saída nº {confirmada} confirmada.</p>}
    {erro && <p className="erro" role="alert">{erro}</p>}
    {erroConsulta && <p className="erro" role="alert">{erroConsulta}</p>}
    {consultando && <p role="status">Consultando pedido e lotes…</p>}
    {expedicao && <div className="table-panel">
      <table aria-label="Quantidades do pedido">
        <thead><tr><th>Apresentação</th><th>Pedida</th><th>Despachada</th><th>Pendente de despacho</th><th>Em estoque</th></tr></thead>
        <tbody>{expedicao.itens.map((item) => <tr key={item.apresentacaoId}>
          <td>{item.apresentacao}</td>
          <td>{quantidadeBr(item.pedida)} {item.unidade}</td>
          <td>{quantidadeBr(item.despachada)} {item.unidade}</td>
          <td>{quantidadeBr(item.pendente)} {item.unidade}</td>
          <td>{quantidadeBr(item.disponivel)} {item.unidade}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {expedicao && !consultando && !envio && (itensPendentes.length === 0
      ? <p>Não há quantidade pendente de despacho.</p>
      : disponiveis.length === 0 && <p>Nenhum lote disponível para os itens pendentes.</p>)}
    {(envio !== null || disponiveis.length > 0) && <form className="saida-form" onSubmit={confirmar}>
      {envio ? <p role="status">Recupere a confirmação antes de registrar outra saída.</p> : <>
        <p>Confira as etiquetas e ajuste as quantidades. Confirme somente quando a mercadoria tiver saído.</p>
        <fieldset disabled={consultando || aguardando}>
          <label>Modalidade de saída
            <select value={modalidade} required disabled={retiradaImediata}
              onChange={(event) => setModalidade(event.target.value)}>
              <option value="" disabled>Selecione</option>
              {modalidadesSaida.map((opcao) => <option key={opcao} value={opcao}>{modalidades[opcao]}</option>)}
            </select>
          </label>
          {disponiveis.map((item) => <div className="table-panel" key={item.apresentacaoId}>
            <h3>{item.apresentacao}</h3>
            <table aria-label={`Lotes disponíveis de ${item.apresentacao}`}>
              <thead><tr><th>Lote</th><th>Validade</th><th>Disponível</th><th>Sugerida</th><th>Quantidade ({item.unidade})</th></tr></thead>
              <tbody>{item.lotes.map((lote) => <tr key={lote.loteId}>
                <td>{lote.codigo}</td><td>{dataCurta(lote.validade)}</td>
                <td>{quantidadeBr(lote.disponivel)}</td><td>{quantidadeBr(lote.sugerida)}</td>
                <td><input aria-label={`Quantidade do lote ${lote.codigo} · ${dataCurta(lote.validade)} · ${item.apresentacao}`}
                  placeholder="0" inputMode={item.unidade === 'kg' ? 'decimal' : 'numeric'} maxLength={10}
                  value={quantidades[lote.loteId] ?? ''}
                  onChange={(event) => setQuantidades({ ...quantidades, [lote.loteId]: event.target.value })} /></td>
              </tr>)}</tbody>
            </table>
          </div>)}
        </fieldset>
      </>}
      <button type="submit" disabled={aguardando || (!envio && consultando)}>
        {aguardando ? 'Confirmando…' : envio ? 'Recuperar confirmação' : 'Confirmar saída física'}
      </button>
    </form>}
    {expedicao && <HistoricoSaidas saidas={expedicao.saidas} />}
  </section>;
}
