import { useState } from 'react';
import type { FormEvent } from 'react';
import { parse, safeParse } from 'valibot';
import { cancelarSaldoSchema, confirmacaoCancelamentoSchema } from '../../../contracts/cancellations.js';
import type { CancelarSaldo } from '../../../contracts/cancellations.js';
import type { Entregas } from '../../../contracts/delivery.js';
import { api, json } from '../../shared/api/index.js';

function restaurar(chave: string): CancelarSaldo | null {
  try {
    const salvo = sessionStorage.getItem(chave);
    return salvo ? parse(cancelarSaldoSchema, JSON.parse(salvo)) : null;
  } catch { return null; }
}

export function CancelamentoSaldo({ entregas, usuario, atualizar }: {
  entregas: Entregas; usuario: number; atualizar(): void;
}) {
  const chave = `amendoas-cancelamento-${usuario}-${entregas.pedidoNumero}`;
  const [pendente, setPendente] = useState(() => restaurar(chave));
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [quantidades, setQuantidades] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const itensPendentes = entregas.itens.filter((item) => Number(item.pendenteDespacho) > 0);

  async function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    setErro('');
    let envio = pendente;
    if (!envio) {
      const itens = itensPendentes.flatMap((item) => {
        const quantidade = (quantidades[item.apresentacaoId] ?? '').trim().replace(',', '.');
        return !quantidade || /^0+(?:\.0{1,3})?$/.test(quantidade) ? [] : [{ apresentacaoId: item.apresentacaoId, quantidade }];
      });
      const dados = safeParse(cancelarSaldoSchema, { cancelamentoId: crypto.randomUUID(), motivo, itens });
      if (!dados.success) { setErro('Informe ao menos uma quantidade e o motivo do cancelamento.'); return; }
      try { sessionStorage.setItem(chave, JSON.stringify(dados.output)); }
      catch { setErro('Habilite o armazenamento da aba para recuperar a confirmação se a conexão cair.'); return; }
      envio = dados.output;
      setPendente(envio);
    }
    setOcupado(true);
    const r = await api(`/pedidos/${entregas.pedidoNumero}/cancelamentos`,
      (value) => parse(confirmacaoCancelamentoSchema, value), json('POST', envio));
    setOcupado(false);
    if (r.success || [400, 404, 409, 422].includes(r.status)) {
      try { sessionStorage.removeItem(chave); } catch { /* O histórico continua disponível. */ }
      setPendente(null);
    }
    if (r.success) {
      setAberto(false);
      setMotivo('');
      setQuantidades({});
      atualizar();
    } else {
      setErro(r.mensagem);
      if (r.status === 409) atualizar();
    }
  }

  if (!pendente && itensPendentes.length === 0) return null;
  if (!aberto && !pendente) return <button type="button" className="secondary" onClick={() => setAberto(true)}>
    Cancelar saldo pendente
  </button>;
  return <form className="recebimento-form" onSubmit={confirmar}>
    {pendente ? <p role="status">Recupere a autorização antes de informar outro cancelamento.</p> : <>
      <p>Informe só o que o cliente dispensou. O cancelamento não altera o estoque nem as remessas anteriores.</p>
      <fieldset disabled={ocupado}>
        {itensPendentes.map((item) => <label key={item.apresentacaoId}>Quantidade a cancelar de {item.apresentacao}
          {` (${item.pendenteDespacho.replace('.', ',')} ${item.unidade} a despachar)`}
          <input inputMode={item.unidade === 'kg' ? 'decimal' : 'numeric'} maxLength={10}
            value={quantidades[item.apresentacaoId] ?? ''}
            onChange={(e) => setQuantidades((atuais) => ({ ...atuais, [item.apresentacaoId]: e.target.value }))} />
        </label>)}
        <label>Motivo do cancelamento
          <input required maxLength={240} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </label>
      </fieldset>
    </>}
    {erro && <p role="alert" className="erro">{erro}</p>}
    <div className="actions">
      <button type="submit" disabled={ocupado}>{ocupado ? 'Autorizando…' : pendente ? 'Recuperar autorização' : 'Autorizar cancelamento'}</button>
      {!pendente && <button className="secondary" type="button" onClick={() => setAberto(false)}>Voltar</button>}
    </div>
  </form>;
}
