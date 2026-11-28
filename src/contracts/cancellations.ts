import * as v from 'valibot';
import { dataIso, id, quantidade, texto } from './pilot.js';

export const perfisCancelamento = ['administrador', 'gerente'] as const;
const cancelamentoId = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const motivo = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(240));
const item = v.strictObject({ apresentacaoId: id, quantidade });

export const cancelarSaldoSchema = v.strictObject({
  cancelamentoId, motivo,
  itens: v.pipe(v.array(item), v.minLength(1), v.maxLength(100),
    v.check((itens) => new Set(itens.map(({ apresentacaoId }) => apresentacaoId)).size === itens.length)),
});
export type CancelarSaldo = v.InferOutput<typeof cancelarSaldoSchema>;
export const confirmacaoCancelamentoSchema = v.object({ cancelamentoId, numero: id });
export const cancelamentoRegistradoSchema = v.object({
  numero: id, responsavel: texto, motivo, autorizadoEm: dataIso, itens: v.array(item),
});
export type CancelamentoRegistrado = v.InferOutput<typeof cancelamentoRegistradoSchema>;
