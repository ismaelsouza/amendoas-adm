import { useCallback, useEffect, useState } from 'react';
import { parse } from 'valibot';
import { filaSchema } from '../../../contracts/pilot.js';
import type { PedidoFila } from '../../../contracts/pilot.js';
import { api } from '../../shared/api/index.js';
import { CorrecoesDoPedido } from './correcoes.js';
import { EntregasPedido } from './entregas.js';
import { PedidoBalcao, recuperarPedidoBalcao } from './pedido-balcao.js';
import { SaidaPedido } from './saida.js';
import { dinheiro } from './valor.js';

const data = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function Pedidos({ usuarioId, podeRegistrar, podeExpedir, podeAutorizar }: {
  usuarioId: number; podeRegistrar: boolean; podeExpedir: boolean; podeAutorizar: boolean;
}) {
  const [pedidos, setPedidos] = useState<PedidoFila[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [confirmado, setConfirmado] = useState<number | null>(null);
  const [novo, setNovo] = useState(() => podeRegistrar && recuperarPedidoBalcao(usuarioId) !== null);
  const [painel, setPainel] = useState<{ pedido: number; tipo: 'saida' | 'entregas' | 'correcoes' } | null>(null);

  const carregar = useCallback(async (antesDe: number | null = null, signal?: AbortSignal) => {
    setCarregando(true);
    setErro('');
    const resultado = await api('/pedidos' + (antesDe === null ? '' : '?antesDe=' + antesDe),
      (value) => parse(filaSchema, value), signal ? { signal } : undefined);
    if (signal?.aborted) return;
    setCarregando(false);
    if (resultado.success) {
      setPedidos((atuais) => antesDe === null ? resultado.data.pedidos : [...atuais, ...resultado.data.pedidos]);
      setCursor(resultado.data.proximoAntesDe);
    } else {
      setErro(resultado.mensagem);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(null, controller.signal);
    return () => controller.abort();
  }, [carregar]);

  return <>
    <div className="page-header">
      <h1>Fila de pedidos</h1>
      <div className="actions">
        <button type="button" className="secondary" disabled={carregando} onClick={() => void carregar()}>Atualizar fila</button>
        {podeRegistrar && !novo && <button type="button" onClick={() => { setNovo(true); setConfirmado(null); }}>Novo pedido de balcão</button>}
      </div>
    </div>
    {confirmado !== null && <p className="status confirmed" role="status">Pedido nº {confirmado} registrado.</p>}
    {novo && <PedidoBalcao usuarioId={usuarioId} onCancel={() => setNovo(false)} onSaved={(numero) => {
      setNovo(false);
      setConfirmado(numero);
      void carregar();
    }} />}
    {erro && <p className="erro" role="alert">{erro}</p>}
    {carregando && <p className="status" role="status">Carregando pedidos…</p>}
    {!carregando && !erro && pedidos.length === 0 && <p className="panel">A fila ainda está vazia.</p>}
    {pedidos.length > 0 && <div className="fila">
      <div className="fila-head" aria-hidden="true"><span>Pedido</span><span>Supermercado</span><span>Origem</span><span>Responsável</span><span>Fechamento</span></div>
      {pedidos.map((pedido) => {
        const saidaAberta = painel?.pedido === pedido.numero && painel.tipo === 'saida';
        const entregasAbertas = painel?.pedido === pedido.numero && painel.tipo === 'entregas';
        const correcoesAbertas = painel?.pedido === pedido.numero && painel.tipo === 'correcoes';
        return <details key={pedido.numero}>
        <summary>
          <strong>#{pedido.numero}</strong>
          <span>{pedido.cliente}</span>
          <span className="origem">{pedido.origem === 'campo' ? 'Campo' : 'Balcão'}
            {podeAutorizar && pedido.correcaoPendente && <small className="correcao-pendente">Correção pendente</small>}
          </span>
          <span>{pedido.responsavel}</span>
          <time dateTime={pedido.fechadoEm}>{data.format(new Date(pedido.fechadoEm))}</time>
        </summary>
        <div className="pedido-detail">
          {pedido.retiradaImediata && <p className="retirada">Retirada imediata no balcão</p>}
          <table aria-label="Itens vigentes">
            <thead><tr><th scope="col">Apresentação</th><th scope="col">Quantidade</th><th scope="col">Preço unitário</th></tr></thead>
            <tbody>{pedido.itens.map((item) => <tr key={item.apresentacaoId}>
              <td>{item.apresentacao}</td>
              <td>{item.quantidade.replace('.', ',')} {item.unidade}</td>
              <td>{dinheiro.format(item.precoUnitarioCentavos / 100)}</td>
            </tr>)}</tbody>
          </table>
          <div className="actions next">
            {podeExpedir && <button type="button" className="secondary" aria-expanded={saidaAberta}
              onClick={() => setPainel(saidaAberta ? null : { pedido: pedido.numero, tipo: 'saida' })}>
              {saidaAberta ? 'Fechar saída' : 'Saída física'}
            </button>}
            <button type="button" className="secondary" aria-expanded={entregasAbertas}
              onClick={() => setPainel(entregasAbertas ? null : { pedido: pedido.numero, tipo: 'entregas' })}>
              {entregasAbertas ? 'Fechar entregas' : 'Entregas'}
            </button>
            {podeAutorizar && pedido.origem === 'campo' && <button type="button" className="secondary" aria-expanded={correcoesAbertas}
              onClick={() => setPainel(correcoesAbertas ? null : { pedido: pedido.numero, tipo: 'correcoes' })}>
              {correcoesAbertas ? 'Fechar correções' : 'Correções'}
            </button>}
          </div>
          {podeExpedir && saidaAberta && <SaidaPedido pedidoNumero={pedido.numero}
            usuarioId={usuarioId} retiradaImediata={pedido.retiradaImediata} />}
          {entregasAbertas && <EntregasPedido key={pedido.numero} pedidoNumero={pedido.numero} usuarioId={usuarioId}
            podeConfirmarQualquerRemessa={podeExpedir} podeCancelar={podeAutorizar} />}
          {correcoesAbertas && podeAutorizar && <CorrecoesDoPedido pedido={pedido.numero} aoAprovar={() => void carregar()} />}
        </div>
      </details>;
      })}
    </div>}
    {cursor !== null && <button className="secondary next" type="button" disabled={carregando} onClick={() => void carregar(cursor)}>Carregar pedidos anteriores</button>}
  </>;
}
