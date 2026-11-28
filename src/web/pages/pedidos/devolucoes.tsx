import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { parse, safeParse } from 'valibot';
import { confirmacaoDevolucaoSchema, devolucaoSchema, devolucoesSchema } from '../../../contracts/returns.js';
import type { Devolucao, Devolucoes } from '../../../contracts/returns.js';
import { api, json } from '../../shared/api/index.js';

const origens: Record<Devolucao['origem'], string> = { recusa: 'Recusa na entrega', apos_recebimento: 'Após o recebimento' };
const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Belem' });
const br = (valor: string) => valor.replace('.', ',');

function lerEnvio(chave: string): Devolucao | null {
  try {
    const salvo = sessionStorage.getItem(chave);
    return salvo ? parse(devolucaoSchema, JSON.parse(salvo)) : null;
  } catch { return null; }
}

export function DevolucoesRemessa({ pedido, remessa, usuario }: { pedido: number; remessa: number; usuario: number }) {
  const rota = `/pedidos/${pedido}/saidas/${remessa}/devolucoes`;
  const chave = `amendoas-devolucao-${usuario}-${pedido}-${remessa}`;
  const [dados, setDados] = useState<Devolucoes | null>(null);
  const [pendente, setPendente] = useState(() => lerEnvio(chave));
  const [origem, setOrigem] = useState<Devolucao['origem'] | ''>('');
  const [campos, setCampos] = useState<Record<number, { apta: string; descartada: string; motivo: string }>>({});
  const [erro, setErro] = useState('');
  const [erroConsulta, setErroConsulta] = useState('');
  const [confirmada, setConfirmada] = useState<number | null>(null);
  const [consultando, setConsultando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const carregar = useCallback(async (signal?: AbortSignal) => {
    setConsultando(true);
    setErroConsulta('');
    const resultado = await api(rota, (payload) => parse(devolucoesSchema, payload), signal ? { signal } : undefined);
    if (signal?.aborted) return;
    setConsultando(false);
    if (resultado.success) setDados(resultado.data);
    else setErroConsulta(resultado.mensagem);
  }, [rota]);
  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    return () => controller.abort();
  }, [carregar]);

  const disponiveis = origem && dados ? new Map(dados.itens.map((item) => [item.apresentacaoId,
    origem === 'recusa' ? item.disponivelRecusa : item.disponivelAposRecebimento])) : new Map<number, string>();
  const lotes = dados?.lotes.filter((lote) => Number(lote.saldoDevolvivel) > 0
    && Number(disponiveis.get(lote.apresentacaoId)) > 0) ?? [];

  async function confirmar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando) return;
    setErro('');
    setConfirmada(null);
    let envio = pendente;
    if (!envio) {
      const preenchidos = lotes.flatMap(({ loteId, vencido }) => {
        const campo = campos[loteId];
        if (!campo) return [];
        const apta = (vencido ? '' : campo.apta.trim().replace(',', '.')) || '0';
        const descartada = campo.descartada.trim().replace(',', '.') || '0';
        const zero = /^0+(?:\.0{1,3})?$/;
        return zero.test(apta) && zero.test(descartada) ? [] : [
          { loteId, apta, descartada, ...(Number(descartada) > 0 && { motivo: campo.motivo.trim() }) },
        ];
      });
      const r = safeParse(devolucaoSchema, { devolucaoId: crypto.randomUUID(), origem, lotes: preenchidos });
      if (!r.success) { setErro('Informe quantidades válidas e o motivo de cada descarte.'); return; }
      try { sessionStorage.setItem(chave, JSON.stringify(r.output)); }
      catch { setErro('Habilite o armazenamento da aba para recuperar a confirmação.'); return; }
      envio = r.output;
      setPendente(envio);
    }
    setEnviando(true);
    const r = await api(rota, (payload) => parse(confirmacaoDevolucaoSchema, payload), json('POST', envio));
    setEnviando(false);
    if (r.success || [400, 404, 409, 422].includes(r.status)) {
      try { sessionStorage.removeItem(chave); } catch { /* Permite recuperar pelo histórico. */ }
      setPendente(null);
    }
    if (r.success) {
      setConfirmada(r.data.numero);
      setCampos({});
      void carregar();
    } else {
      setErro(r.mensagem);
      if (r.status === 409) void carregar();
    }
  }

  return <section className="devolucoes-remessa" aria-label={`Devoluções da remessa ${remessa}`}>
    <div className="actions">
      <h4>Devoluções</h4>
      <button type="button" className="secondary" disabled={consultando || enviando} onClick={() => void carregar()}>
        Atualizar devoluções
      </button>
    </div>
    {consultando && <p role="status">Consultando devoluções…</p>}
    {erroConsulta && <p className="erro" role="alert">{erroConsulta}</p>}
    {confirmada !== null && <p className="confirmed" role="status">Devolução nº {confirmada} registrada.</p>}
    {erro && <p className="erro" role="alert">{erro}</p>}
    {(pendente || (dados && dados.lotes.some((l) => Number(l.saldoDevolvivel) > 0))) && <form className="recebimento-form" onSubmit={confirmar}>
      {pendente ? <p role="status">Recupere a confirmação antes de lançar outra devolução.</p> : <fieldset disabled={consultando || enviando}>
        <p>Confira a etiqueta dos lotes que voltaram. Apenas a quantidade apta retorna ao estoque.</p>
        <label>Origem da devolução
          <select required value={origem} onChange={(event) => {
            const valor = event.target.value;
            setOrigem(valor === 'recusa' || valor === 'apos_recebimento' ? valor : '');
            setCampos({});
          }}>
            <option value="">Selecione</option>
            <option value="recusa">{origens.recusa}</option>
            <option value="apos_recebimento">{origens.apos_recebimento}</option>
          </select>
        </label>
        {origem && lotes.length === 0 && <p>Não há quantidade devolvível para esta origem.</p>}
        {lotes.map((lote) => {
          const campo = campos[lote.loteId];
          const atualizar = (dados: Partial<{ apta: string; descartada: string; motivo: string }>) =>
            setCampos((atuais) => ({ ...atuais, [lote.loteId]: { apta: '', descartada: '', motivo: '', ...atuais[lote.loteId], ...dados } }));
          const rotulo = `${lote.apresentacao}, lote ${lote.codigo}, validade ${lote.validade}`;
          const inputMode = lote.unidade === 'kg' ? 'decimal' : 'numeric';
          return <div className="conferencia-item" key={lote.loteId}>
            <strong>{rotulo}</strong>
            <p>Limite do lote: {br(lote.saldoDevolvivel)} {lote.unidade}. Limite da apresentação nesta origem: {br(disponiveis.get(lote.apresentacaoId) ?? '0')} {lote.unidade}.</p>
            {lote.vencido && <p>Lote vencido. Não pode voltar para venda.</p>}
            <div className="actions">
              <label>Apta para venda
                <input aria-label={`Apta para venda de ${rotulo}`} disabled={lote.vencido} inputMode={inputMode}
                  maxLength={10} placeholder="0" value={lote.vencido ? '' : campo?.apta ?? ''} onChange={(e) => atualizar({ apta: e.target.value })} />
              </label>
              <label>Para descarte
                <input aria-label={`Para descarte de ${rotulo}`} inputMode={inputMode} maxLength={10} placeholder="0"
                  value={campo?.descartada ?? ''} onChange={(e) => atualizar({ descartada: e.target.value })} />
              </label>
            </div>
            {Number(campo?.descartada.replace(',', '.')) > 0 && <label>Motivo do descarte
              <input aria-label={`Motivo do descarte de ${rotulo}`} required maxLength={240}
                value={campo?.motivo ?? ''} onChange={(e) => atualizar({ motivo: e.target.value })} />
            </label>}
          </div>;
        })}
      </fieldset>}
      {(pendente || lotes.length > 0) && <button type="submit" disabled={enviando || (!pendente && consultando)}>
        {enviando ? 'Registrando…' : pendente ? 'Recuperar devolução' : 'Registrar devolução'}
      </button>}
    </form>}
    {dados && dados.devolucoes.length === 0 && <p>Nenhuma devolução registrada.</p>}
    {dados?.devolucoes.map((devolucao) => <article className="historico-entrega" key={devolucao.numero}>
      <strong>Devolução nº {devolucao.numero} · {origens[devolucao.origem]}</strong>
      <p>{devolucao.responsavel} · <time dateTime={devolucao.registradaEm}>{dataHora.format(new Date(devolucao.registradaEm))}</time></p>
      <div className="table-panel"><table aria-label={`Lotes da devolução ${devolucao.numero}`}>
        <thead><tr><th>Apresentação</th><th>Lote</th><th>Validade</th><th>Apta</th><th>Descartada</th><th>Motivo</th></tr></thead>
        <tbody>{devolucao.lotes.map((lote) => <tr key={lote.loteId}><th scope="row">{lote.apresentacao}</th>
          <td>{lote.codigo}</td><td>{lote.validade}</td><td>{br(lote.apta)} {lote.unidade}</td>
          <td>{br(lote.descartada)} {lote.unidade}</td><td>{lote.motivo ?? '—'}</td>
        </tr>)}</tbody>
      </table></div>
    </article>)}
  </section>;
}
