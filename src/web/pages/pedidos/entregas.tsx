import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { parse, safeParse } from 'valibot';
import { confirmacaoRecebimentoSchema, entregasSchema, recebimentoSchema, situacaoEntrega } from '../../../contracts/delivery.js';
import type { Entregas, Recebimento } from '../../../contracts/delivery.js';
import { api, json } from '../../shared/api/index.js';
import { CancelamentoSaldo } from './cancelamento.js';
import { DevolucoesRemessa } from './devolucoes.js';
import { dinheiro } from './valor.js';

type Remessa = Entregas['remessas'][number];
const modalidades: Record<Remessa['modalidade'], string> = {
  frota_propria: 'Frota própria', transportadora: 'Transportadora', retirada: 'Retirada no balcão',
};
const conferencias = { sem_ressalvas: 'Comprovante sem ressalvas', divergencia_esclarecida: 'Divergência esclarecida com o cliente' };
const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Belem' });
const br = (quantidade: string) => quantidade.replace('.', ',');
const chaveEnvio = (usuario: number, pedido: number, saida: number) => `amendoas-recebimento-${usuario}-${pedido}-${saida}`;

function restaurar(chave: string): Recebimento | null {
  try {
    const salvo = sessionStorage.getItem(chave);
    return salvo ? parse(recebimentoSchema, JSON.parse(salvo)) : null;
  } catch { return null; }
}

function separar(item: Remessa['itens'][number], entrada = '') {
  const recusada = entrada.trim().replace(',', '.') || '0';
  const formato = item.unidade === 'kg' ? /^\d{1,6}(\.\d{1,3})?$/ : /^\d{1,6}$/;
  if (!formato.test(recusada) || Number(recusada) > Number(item.despachada)) return null;
  const recebida = Math.round(Number(item.despachada) * 1000) - Math.round(Number(recusada) * 1000);
  return { recusada, recebida: (recebida / 1000).toFixed(item.unidade === 'kg' ? 3 : 0) };
}

function ReceberRemessa({ remessa, pedido, chave, onSaved, onConflict }: {
  remessa: Remessa; pedido: number; chave: string; onSaved(numero: number): void; onConflict(): void;
}) {
  const [pendente, setPendente] = useState(() => restaurar(chave));
  const [conferencia, setConferencia] = useState('');
  const [recusas, setRecusas] = useState<Record<number, { qtd: string; motivo: string; repor: boolean }>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const semRessalvas = conferencia === 'sem_ressalvas';
  const transportadora = remessa.modalidade === 'transportadora';
  const porItem = remessa.itens.map((item) => {
    const recusa = semRessalvas ? undefined : recusas[item.apresentacaoId];
    return { item, recusa, quantidades: separar(item, recusa?.qtd) };
  });

  async function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    setErro('');
    let envio = pendente;
    if (!envio) {
      const itens = porItem.flatMap(({ item, recusa, quantidades }) => {
        if (!quantidades) return [];
        const houveRecusa = Number(quantidades.recusada) > 0;
        return [{ apresentacaoId: item.apresentacaoId, ...quantidades,
          ...(houveRecusa && { motivo: recusa?.motivo.trim(), repor: recusa?.repor ?? false }) }];
      });
      const dados = safeParse(recebimentoSchema, { recebimentoId: crypto.randomUUID(),
        ...(transportadora && { conferencia }), itens });
      if (itens.length !== remessa.itens.length || !dados.success
        || dados.output.itens.some((item) => Number(item.recusada) > 0 && !item.motivo)) {
        setErro('Confira as quantidades, a conferência da transportadora e o motivo de cada recusa.');
        return;
      }
      try { sessionStorage.setItem(chave, JSON.stringify(dados.output)); }
      catch { setErro('Habilite o armazenamento da aba para recuperar a confirmação se a conexão cair.'); return; }
      envio = dados.output;
      setPendente(envio);
    }
    setOcupado(true);
    const r = await api(`/pedidos/${pedido}/saidas/${remessa.numero}/recebimento`,
      (payload) => parse(confirmacaoRecebimentoSchema, payload), json('POST', envio));
    setOcupado(false);
    if (r.success || [400, 404, 409, 422].includes(r.status)) {
      try { sessionStorage.removeItem(chave); } catch { /* O histórico continua disponível. */ }
      setPendente(null);
    }
    if (r.success) onSaved(r.data.numero);
    else {
      setErro(r.mensagem);
      if (r.status === 409) onConflict();
    }
  }

  return <form className="recebimento-form" onSubmit={confirmar}>
    {pendente ? <p role="status">Recupere a confirmação antes de enviar novos dados.</p> : <>
      <p>Confirme depois de verificar o que o cliente realmente recebeu. A confirmação não altera o estoque.</p>
      <fieldset disabled={ocupado}>
        {transportadora && <label>Conferência do comprovante
          <select value={conferencia} required onChange={(e) => setConferencia(e.target.value)}>
            <option value="">Selecione depois de conferir</option>
            <option value="sem_ressalvas">{conferencias.sem_ressalvas}</option>
            <option value="divergencia_esclarecida">{conferencias.divergencia_esclarecida}</option>
          </select>
        </label>}
        {porItem.map(({ item, recusa, quantidades }) => {
          const atualizar = (campos: Partial<{ qtd: string; motivo: string; repor: boolean }>) =>
            setRecusas((atuais) => ({ ...atuais, [item.apresentacaoId]: {
              qtd: '', motivo: '', repor: false, ...atuais[item.apresentacaoId], ...campos,
            } }));
          return <div className="conferencia-item" key={item.apresentacaoId}>
            <strong>{item.apresentacao}</strong>
            <p>{br(item.despachada)} {item.unidade} despachado(s) · {
              quantidades ? `${br(quantidades.recebida)} ${item.unidade} recebido(s)` : 'Revise a quantidade recusada'
            }</p>
            {!semRessalvas && <label>Quantidade recusada ({item.unidade})
              <input aria-label={`Quantidade recusada de ${item.apresentacao}`}
                value={recusa?.qtd ?? ''} placeholder="0" maxLength={10}
                inputMode={item.unidade === 'kg' ? 'decimal' : 'numeric'}
                onChange={(e) => atualizar({ qtd: e.target.value })} />
            </label>}
            {quantidades && Number(quantidades.recusada) > 0 && <>
              <label>Motivo da recusa
                <input aria-label={`Motivo da recusa de ${item.apresentacao}`} required maxLength={240}
                  value={recusa?.motivo ?? ''} onChange={(e) => atualizar({ motivo: e.target.value })} />
              </label>
              <label className="opcao-reposicao"><input type="checkbox" checked={recusa?.repor ?? false}
                onChange={(e) => atualizar({ repor: e.target.checked })} /> Cliente pediu reposição do recusado</label>
            </>}
          </div>;
        })}
      </fieldset>
    </>}
    {erro && <p className="erro" role="alert">{erro}</p>}
    <button type="submit" disabled={ocupado}>{ocupado ? 'Confirmando…' : pendente ? 'Recuperar confirmação' : 'Confirmar recebimento'}</button>
  </form>;
}

export function EntregasPedido({ pedidoNumero, usuarioId, podeConfirmarQualquerRemessa, podeCancelar }: {
  pedidoNumero: number; usuarioId: number; podeConfirmarQualquerRemessa: boolean; podeCancelar: boolean;
}) {
  const [entregas, setEntregas] = useState<Entregas | null>(null);
  const [consultando, setConsultando] = useState(true);
  const [erro, setErro] = useState('');
  const [confirmado, setConfirmado] = useState<number | null>(null);
  const [aberta, setAberta] = useState<number | null>(null);
  const [devolucoesAbertas, setDevolucoesAbertas] = useState<number | null>(null);
  const carregar = useCallback(async (signal?: AbortSignal) => {
    setConsultando(true);
    setErro('');
    const r = await api(`/pedidos/${pedidoNumero}/entregas`, (dados) => parse(entregasSchema, dados),
      signal ? { signal } : undefined);
    if (signal?.aborted) return;
    setConsultando(false);
    if (r.success) {
      setEntregas(r.data);
      for (const remessa of r.data.remessas) {
        if (!remessa.recebimento) continue;
        try { sessionStorage.removeItem(chaveEnvio(usuarioId, pedidoNumero, remessa.numero)); } catch { /* Leitura disponível sem armazenamento. */ }
      }
    } else setErro(r.mensagem);
  }, [pedidoNumero, usuarioId]);
  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    return () => controller.abort();
  }, [carregar]);
  return <section className="panel entregas-pedido" aria-label={`Entregas do pedido ${pedidoNumero}`}>
    <div className="actions">
      <h2>Entregas</h2>
      <button type="button" className="secondary" disabled={consultando} onClick={() => void carregar()}>Atualizar entregas</button>
    </div>
    {confirmado !== null && <p className="confirmed" role="status">Recebimento nº {confirmado} confirmado.</p>}
    {erro && <p className="erro" role="alert">{erro}</p>}
    {consultando && <p role="status">Consultando entregas…</p>}
    {entregas && <>
      <p><strong>{situacaoEntrega[entregas.situacao]}</strong></p>
      <div className="table-panel">
        <table aria-label="Balanço das entregas">
          <thead><tr><th>Apresentação</th><th>Pedida</th><th>Despachada</th><th>Recebida</th><th>Recusada</th>
            <th>Cancelada</th><th>Sem confirmação</th><th>A despachar</th><th>A receber</th></tr></thead>
          <tbody>{entregas.itens.map((item) => <tr key={item.apresentacaoId}><th scope="row">{item.apresentacao}</th>
            {[item.pedida, item.despachada, item.recebida, item.recusada, item.cancelada, item.emTransito, item.pendenteDespacho, item.pendenteRecebimento]
              .map((qtd, indice) => <td key={indice}>{br(qtd)} {item.unidade}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      {podeCancelar && <CancelamentoSaldo entregas={entregas} usuario={usuarioId} atualizar={() => void carregar()} />}
      {entregas.cancelamentos.length > 0 && <div>
        <h3>Histórico de cancelamentos</h3>
        {entregas.cancelamentos.map((registro) => <article className="historico-entrega" key={registro.numero}>
          <h4>Cancelamento nº {registro.numero}</h4>
          <p>{registro.responsavel} · <time dateTime={registro.autorizadoEm}>{dataHora.format(new Date(registro.autorizadoEm))}</time></p>
          <p>{registro.motivo}</p>
          <ul>{registro.itens.map((item) => {
            const produto = entregas.itens.find(({ apresentacaoId }) => apresentacaoId === item.apresentacaoId);
            return <li key={item.apresentacaoId}>{produto?.apresentacao}: {br(item.quantidade)} {produto?.unidade}</li>;
          })}</ul>
        </article>)}
      </div>}
      {!entregas.remessas.length && <p>Nenhuma remessa saiu deste pedido.</p>}
      {entregas.remessas.map((remessa) => {
        const registro = remessa.recebimento;
        const podeConfirmar = podeConfirmarQualquerRemessa || remessa.modalidade === 'retirada';
        return <article key={remessa.numero} className="historico-entrega">
          <h3>Remessa nº {remessa.numero} · {modalidades[remessa.modalidade]}</h3>
          {registro ? <>
            <p>Recebimento nº {registro.numero} · {registro.responsavel} · <time dateTime={registro.confirmadoEm}>
              {dataHora.format(new Date(registro.confirmadoEm))}</time></p>
            {registro.conferencia && <p>{conferencias[registro.conferencia]}</p>}
            <div className="table-panel"><table aria-label={`Recebimento da remessa ${remessa.numero}`}>
              <thead><tr><th>Apresentação</th><th>Despachada</th><th>Recebida</th><th>Recusada</th><th>Motivo</th><th>Reposição</th><th>Valor recebido</th></tr></thead>
              <tbody>{remessa.itens.map((item) => {
                const linha = registro.itens.find(({ apresentacaoId }) => apresentacaoId === item.apresentacaoId);
                if (!linha) return null;
                return <tr key={item.apresentacaoId}><th scope="row">{item.apresentacao}</th>
                  <td>{br(item.despachada)} {item.unidade}</td><td>{br(linha.recebida)} {item.unidade}</td>
                  <td>{br(linha.recusada)} {item.unidade}</td><td>{linha.motivo ?? '—'}</td>
                  <td>{linha.repor ? 'Solicitada' : '—'}</td><td>{dinheiro.format(linha.subtotalCentavos / 100)}</td>
                </tr>;
              })}</tbody>
            </table></div>
            {podeConfirmarQualquerRemessa && <button type="button" className="secondary" aria-expanded={devolucoesAbertas === remessa.numero}
              onClick={() => setDevolucoesAbertas(devolucoesAbertas === remessa.numero ? null : remessa.numero)}>
              {devolucoesAbertas === remessa.numero ? 'Fechar devoluções' : 'Devoluções'}
            </button>}
            {podeConfirmarQualquerRemessa && devolucoesAbertas === remessa.numero &&
              <DevolucoesRemessa pedido={pedidoNumero} remessa={remessa.numero} usuario={usuarioId} />}
          </> : <>
            <p>Recebimento ainda não confirmado.</p>
            {podeConfirmar && <button type="button" className="secondary" aria-expanded={aberta === remessa.numero}
              onClick={() => setAberta(aberta === remessa.numero ? null : remessa.numero)}>
              {aberta === remessa.numero ? 'Fechar conferência' : 'Conferir recebimento'}
            </button>}
            {podeConfirmar && aberta === remessa.numero && <ReceberRemessa remessa={remessa} pedido={pedidoNumero}
              chave={chaveEnvio(usuarioId, pedidoNumero, remessa.numero)} onSaved={(numero) => {
                setConfirmado(numero); setAberta(null); void carregar();
              }} onConflict={() => void carregar()} />}
          </>}
        </article>;
      })}
    </>}
  </section>;
}
