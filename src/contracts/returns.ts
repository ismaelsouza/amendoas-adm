import * as v from 'valibot';
import { dataIso, id, texto, unidadeSchema } from './pilot.js';

const devolucaoId = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const origem = v.picklist(['recusa', 'apos_recebimento']);
const qtd = v.pipe(v.string(), v.regex(/^\d{1,6}(\.\d{1,3})?$/));
const motivo = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(240));
const validade = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/));
const lote = { loteId: id, apresentacaoId: id, apresentacao: texto, unidade: unidadeSchema, codigo: texto, validade };
export const devolucaoSchema = v.strictObject({
  devolucaoId, origem,
  lotes: v.pipe(v.array(v.strictObject({
    loteId: id, apta: qtd, descartada: qtd, motivo: v.exactOptional(motivo),
  })), v.minLength(1), v.maxLength(100), v.check((lotes) => new Set(lotes.map((l) => l.loteId)).size === lotes.length)),
});
export type Devolucao = v.InferOutput<typeof devolucaoSchema>;
export const confirmacaoDevolucaoSchema = v.object({ devolucaoId, numero: id });
export const devolucoesSchema = v.object({
  remessaNumero: id, recebimentoNumero: v.nullable(id),
  itens: v.array(v.object({ apresentacaoId: id, disponivelRecusa: qtd, disponivelAposRecebimento: qtd })),
  lotes: v.array(v.object({ ...lote, saldoDevolvivel: qtd, vencido: v.boolean() })),
  devolucoes: v.array(v.object({
    numero: id, origem, responsavel: texto, registradaEm: dataIso,
    lotes: v.array(v.object({ ...lote, apta: qtd, descartada: qtd, motivo: v.nullable(motivo) })),
  })),
});
export type Devolucoes = v.InferOutput<typeof devolucoesSchema>;
