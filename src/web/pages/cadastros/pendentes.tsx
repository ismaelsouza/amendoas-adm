import { useCallback, useEffect, useRef, useState } from 'react';
import { parse } from 'valibot';
import { cadastrosPendentesSchema, totalCadastrosPendentesSchema } from '../../../contracts/field-customers.js';
import type { ClientePendente } from '../../../contracts/field-customers.js';
import { api, json } from '../../shared/api/index.js';

const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Belem' });

export function useTotalCadastrosPendentes(autorizado: boolean): { total: number; atualizar(): void } {
  const [total, setTotal] = useState(0);
  const requisicao = useRef<AbortController | null>(null);
  const atualizar = useCallback(() => {
    if (!autorizado) return;
    requisicao.current?.abort();
    const controller = new AbortController();
    requisicao.current = controller;
    void api('/cadastros/conferencia/total', (value) => parse(totalCadastrosPendentesSchema, value), {
      signal: controller.signal,
    }).then((r) => {
      if (r.success && !controller.signal.aborted) setTotal(r.data.total);
    });
  }, [autorizado]);
  useEffect(() => {
    if (!autorizado) return;
    atualizar();
    window.addEventListener('focus', atualizar);
    const busca = window.setInterval(atualizar, 30_000);
    return () => {
      window.clearInterval(busca);
      window.removeEventListener('focus', atualizar);
      requisicao.current?.abort();
    };
  }, [autorizado, atualizar]);
  return { total: autorizado ? total : 0, atualizar };
}

function Ficha({ cliente, ocupado, aoConferir }: { cliente: ClientePendente; ocupado: boolean; aoConferir(): void }) {
  const { cnpj, endereco, telefone } = cliente;
  const documento = cnpj.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');
  const cep = endereco.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2');
  return <article className="panel ficha-cadastro">
    <h2>{cliente.nome}</h2>
    <p>Cadastrado por {cliente.vendedor} em <time dateTime={cliente.cadastradoEm}>
      {dataHora.format(new Date(cliente.cadastradoEm))}</time>.</p>
    <dl>
      <dt>CNPJ</dt><dd>{documento}</dd>
      <dt>Telefone</dt><dd>{`(${telefone.slice(0, 2)}) ${telefone.slice(2, -4)}-${telefone.slice(-4)}`}</dd>
      <dt>Endereço</dt><dd>
        <div>{endereco.logradouro}, {endereco.numero ?? 'sem número'}</div>
        {endereco.complemento && <div>{endereco.complemento}</div>}
        <div>{endereco.bairro} · {endereco.municipio}/{endereco.uf} · CEP {cep}</div>
      </dd>
    </dl>
    <button type="button" disabled={ocupado} onClick={aoConferir}>Marcar como conferido</button>
  </article>;
}

export function CadastrosPendentes({ aoAtualizar }: { aoAtualizar(): void }) {
  const [cadastros, setCadastros] = useState<ClientePendente[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async (antesDe: number | null = null, signal?: AbortSignal) => {
    setCarregando(true);
    setErro('');
    const rota = '/cadastros/conferencia' + (antesDe === null ? '' : `?antesDe=${antesDe}`);
    const r = await api(rota, (value) => parse(cadastrosPendentesSchema, value), signal ? { signal } : undefined);
    if (signal?.aborted) return;
    setCarregando(false);
    if (r.success) {
      setCadastros((anteriores) => antesDe === null ? r.data.cadastros : [...(anteriores ?? []), ...r.data.cadastros]);
      setCursor(r.data.proximoAntesDe);
      aoAtualizar();
    } else setErro(r.mensagem);
  }, [aoAtualizar]);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(null, controller.signal);
    return () => controller.abort();
  }, [carregar]);

  async function conferir(cliente: ClientePendente) {
    if (conferindo || carregando) return;
    setConferindo(true);
    setErro('');
    setAviso('');
    const r = await api(`/cadastros/conferencia/${cliente.clienteId}/conferir`, () => null, json('POST', {}));
    setConferindo(false);
    if (r.success) {
      setAviso(`Cadastro de ${cliente.nome} marcado como conferido.`);
      setCadastros((atuais) => atuais?.filter(({ clienteId }) => clienteId !== cliente.clienteId) ?? null);
      aoAtualizar();
    } else setErro(r.mensagem);
  }

  return <>
    <div className="page-header">
      <h1>Cadastros pendentes</h1>
      <button type="button" className="secondary" disabled={carregando || conferindo} onClick={() => void carregar()}>
        Atualizar cadastros
      </button>
    </div>
    {erro && <p role="alert" className="erro">{erro}</p>}
    {aviso && <p role="status" className="confirmed">{aviso}</p>}
    {carregando && <p role="status">Consultando cadastros…</p>}
    {cadastros?.length === 0 && cursor === null && !carregando && <p>Nenhum cadastro pendente de conferência.</p>}
    <div className="lista-cadastros">
      {cadastros?.map((cliente) => <Ficha key={cliente.clienteId} cliente={cliente} ocupado={carregando || conferindo}
        aoConferir={() => void conferir(cliente)} />)}
    </div>
    {cursor !== null && <button type="button" className="secondary next" disabled={carregando || conferindo}
      onClick={() => void carregar(cursor)}>Carregar cadastros anteriores</button>}
  </>;
}
