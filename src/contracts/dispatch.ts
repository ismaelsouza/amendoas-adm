import * as v from 'valibot';
import { dataIso, id, quantidade, texto, unidadeSchema } from './pilot.js';

export const modalidadesSaida = ['frota_propria', 'transportadora', 'retirada'] as const;
const modalidade = v.picklist(modalidadesSaida);
const saidaId = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const lotesSelecionados = v.array(v.strictObject({ loteId: id, quantidade }));
export const saidaEstoqueSchema = v.strictObject({
  saidaId, modalidade,
  lotes: v.pipe(lotesSelecionados, v.minLength(1), v.maxLength(100),
    v.check((lotes) => new Set(lotes.map((lote) => lote.loteId)).size === lotes.length)),
});
export type SaidaEstoque = v.InferOutput<typeof saidaEstoqueSchema>;
export const confirmacaoSaidaSchema = v.object({ saidaId, numero: id });

const saldo = v.pipe(v.string(), v.regex(/^\d+(\.\d{3})?$/));
const validade = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));
const produto = { apresentacaoId: id, apresentacao: texto, unidade: unidadeSchema };
const lote = { loteId: id, codigo: texto, validade };
const itemExpedicao = v.object({
  ...produto, pedida: saldo, despachada: saldo, pendente: saldo, disponivel: saldo,
  lotes: v.array(v.object({ ...lote, disponivel: saldo, sugerida: saldo })),
});
const remessa = v.object({
  numero: id, modalidade, responsavel: texto, confirmadaEm: dataIso,
  lotes: v.array(v.object({ ...produto, ...lote, quantidade })),
});
export const expedicaoSchema = v.object({
  pedidoNumero: id, retiradaImediata: v.boolean(), itens: v.array(itemExpedicao), saidas: v.array(remessa),
});
export type Expedicao = v.InferOutput<typeof expedicaoSchema>;
