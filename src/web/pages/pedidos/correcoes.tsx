import { useCallback, useEffect, useState } from 'react';
import { parse } from 'valibot';
import { confirmacaoCorrecaoSchema, correcoesPedidoSchema } from '../../../contracts/corrections.js';
import type { CorrecoesPedido } from '../../../contracts/corrections.js';
import { api, json } from '../../shared/api/index.js';
import { dinheiro } from './valor.js';

const estados = { pendente: 'Aguardando autorização', aprovada: 'Aprovada', impedida: 'Impedida' };
const horario = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Belem' });

export function CorrecoesDoPedido({ pedido, aoAprovar }: { pedido: number; aoAprovar(): void }) {
  const [registros, setRegistros] = useState<CorrecoesPedido['correcoes'] | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async (signal?: AbortSignal) => {
    const r = await api(`/pedidos/${pedido}/correcoes`, (value) => parse(correcoesPedidoSchema, value),
      signal ? { signal } : undefined);
    if (signal?.aborted) return;
    if (r.success) setRegistros(r.data.correcoes);
    else setErro(r.mensagem);
  }, [pedido]);
  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    return () => controller.abort();
  }, [carregar]);

  async function aprovar(numero: number) {
    if (ocupado) return;
    setOcupado(true);
    setErro('');
    const r = await api(`/pedidos/${pedido}/correcoes/${numero}/aprovacao`,
      (value) => parse(confirmacaoCorrecaoSchema, value), json('POST', {}));
    if (r.success) aoAprovar();
    else setErro(r.mensagem);
    await carregar();
    setOcupado(false);
  }

  return <section className="panel" aria-label={`Correções do pedido ${pedido}`}>
    <h2>Correções do pedido</h2>
    {erro && <p className="erro" role="alert">{erro}</p>}
    {!registros && !erro && <p role="status">Consultando correções…</p>}
    {registros?.length === 0 && <p>Nenhuma correção solicitada.</p>}
    {registros?.map((r) => <article className="historico-entrega" key={r.numero}>
      <h3>Correção nº {r.numero} · {estados[r.situacao]}</h3>
      <p>{r.motivo}</p>
      <p>Solicitada por {r.solicitadaPor} em {horario.format(new Date(r.solicitadaEm))}.</p>
      {r.autorizadaEm && <p>Autorizada por {r.autorizadaPor} em {horario.format(new Date(r.autorizadaEm))}.</p>}
      {r.situacao === 'impedida' && <p>O pedido mudou desde a solicitação. A proposta não altera os itens vigentes.</p>}
      <div className="table-panel"><table aria-label={`Alterações da correção ${r.numero}`}>
        <thead><tr><th>Apresentação</th><th>Antes</th><th>Proposta</th></tr></thead>
        <tbody>{r.itens.map((item) => <tr key={item.apresentacaoId}>
          <th scope="row">{item.apresentacao}</th>
          {[item.anterior, item.proposta].map(({ quantidade, precoUnitarioCentavos }, i) => <td key={i}>
            {quantidade.replace('.', ',')} {item.unidade} · {dinheiro.format(precoUnitarioCentavos / 100)}
          </td>)}
        </tr>)}</tbody>
      </table></div>
      {r.situacao === 'pendente' && <button type="button" disabled={ocupado} onClick={() => void aprovar(r.numero)}>Aprovar correção</button>}
    </article>)}
  </section>;
}
