import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { parse, safeParse } from 'valibot';
import type { InferOutput } from 'valibot';
import { cadastrosSchema, confirmacaoSchema, vendaBalcaoSchema } from '../../../contracts/pilot.js';
import type { Cadastros } from '../../../contracts/pilot.js';
import { api, json } from '../../shared/api/index.js';
import { dinheiro } from './valor.js';

type VendaBalcao = InferOutput<typeof vendaBalcaoSchema>;
type Props = { usuarioId: number; onCancel: () => void; onSaved: (numero: number) => void };

function chaveDoPedido(usuarioId: number): string {
  return 'amendoas-pedido-balcao-' + usuarioId;
}

export function recuperarPedidoBalcao(usuarioId: number): VendaBalcao | null {
  try {
    const dados = sessionStorage.getItem(chaveDoPedido(usuarioId));
    return dados ? parse(vendaBalcaoSchema, JSON.parse(dados)) : null;
  } catch {
    return null;
  }
}

export function PedidoBalcao({ usuarioId, onCancel, onSaved }: Props) {
  const [cadastros, setCadastros] = useState<Cadastros | null>(null);
  const [quantidades, setQuantidades] = useState<Record<number, string>>({});
  const [envio, setEnvio] = useState(() => recuperarPedidoBalcao(usuarioId));
  const [erro, setErro] = useState('');
  const [aguardando, setAguardando] = useState(false);
  const [recarregar, setRecarregar] = useState(0);
  const temEnvio = envio !== null;

  useEffect(() => {
    if (temEnvio) return;
    const controller = new AbortController();
    void api('/cadastros/balcao', (value) => parse(cadastrosSchema, value), { signal: controller.signal }).then((r) => {
      if (controller.signal.aborted) return;
      if (r.success) setCadastros(r.data);
      else setErro(r.mensagem);
    });
    return () => controller.abort();
  }, [recarregar, temEnvio]);

  async function registrar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (aguardando) return;
    setErro('');
    let payload = envio;

    if (!payload && cadastros) {
      const dados = new FormData(event.currentTarget);
      const venda = safeParse(vendaBalcaoSchema, {
        vendaId: crypto.randomUUID(), fechadoEm: new Date().toISOString(),
        clienteId: Number(dados.get('cliente')), retiradaImediata: dados.get('retirada') === 'on',
        itens: cadastros.apresentacoes.flatMap((item) => {
          const quantidade = quantidades[item.id]?.trim().replace(',', '.');
          return quantidade ? [{ apresentacaoId: item.id, quantidade, precoUnitarioCentavos: item.precoUnitarioCentavos }] : [];
        }),
      });
      if (!venda.success) {
        setErro('Selecione um supermercado e preencha a quantidade de pelo menos um item.');
        return;
      }

      try {
        sessionStorage.setItem(chaveDoPedido(usuarioId), JSON.stringify(venda.output));
      } catch {
        setErro('Habilite o armazenamento desta aba para recuperar o pedido se a conexão cair.');
        return;
      }
      payload = venda.output;
      setEnvio(payload);
    }

    if (!payload) return;
    setAguardando(true);
    const r = await api('/pedidos/balcao', (value) => parse(confirmacaoSchema, value), json('POST', payload));
    setAguardando(false);
    if (r.success || r.status === 400 || r.status === 422) {
      if (recuperarPedidoBalcao(usuarioId)?.vendaId === payload.vendaId) {
        sessionStorage.removeItem(chaveDoPedido(usuarioId));
      }
      setEnvio(null);
    }
    if (r.success) onSaved(r.data.numero);
    else setErro(r.mensagem);
  }

  return <form className="panel form-panel" onSubmit={registrar}>
    <h2>Pedido de balcão</h2>
    {erro && <p className="erro" role="alert">{erro}</p>}
    {temEnvio && <p role="status">Recupere a confirmação desta venda antes de registrar outra.</p>}
    {cadastros && <fieldset disabled={temEnvio || aguardando} hidden={temEnvio}>
      <label>Supermercado
        <select name="cliente" defaultValue="" required>
          <option value="" disabled>Selecione</option>
          {cadastros.clientes.map((cliente) => <option key={cliente.id} value={cliente.id}>{cliente.nome}</option>)}
        </select>
      </label>
      <h3>Itens</h3>
      <div className="itens">{cadastros.apresentacoes.map((item) => <label key={item.id} className="item">
        <span>{item.apresentacao}<small>{dinheiro.format(item.precoUnitarioCentavos / 100)} / {item.unidade}</small></span>
        <input aria-label={`Quantidade em ${item.unidade} de ${item.apresentacao}`} inputMode="decimal"
          value={quantidades[item.id] ?? ''} maxLength={10} placeholder="0"
          onChange={(event) => setQuantidades({ ...quantidades, [item.id]: event.target.value })} />
      </label>)}</div>
      <label className="checkbox"><input type="checkbox" name="retirada" /> Retirada imediata</label>
    </fieldset>}
    {!cadastros && !temEnvio && !erro && <p role="status">Carregando clientes e apresentações…</p>}
    <div className="actions">
      {(temEnvio || cadastros) && <button disabled={aguardando} type="submit">{aguardando ? 'Registrando…' : temEnvio ? 'Recuperar confirmação' : 'Registrar pedido'}</button>}
      {!cadastros && !temEnvio && erro && <button type="button" onClick={() => { setErro(''); setRecarregar(recarregar + 1); }}>Tentar novamente</button>}
      {!temEnvio && <button className="secondary" type="button" onClick={onCancel}>Cancelar</button>}
    </div>
  </form>;
}

