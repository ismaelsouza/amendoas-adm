import * as v from 'valibot';
import { cancelamentoRegistradoSchema } from './cancellations.js';
import { modalidadesSaida } from './dispatch.js';
import { dataIso, id, texto, unidadeSchema } from './pilot.js';

const quantidade = v.pipe(v.string(), v.regex(/^\d{1,6}(\.\d{1,3})?$/));
const saldo = v.pipe(v.string(), v.regex(/^\d+(\.\d{3})?$/));
const recebimentoId = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const motivo = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(240));
const conferencia = v.picklist(['sem_ressalvas', 'divergencia_esclarecida']);
const linha = { apresentacaoId: id, recebida: quantidade, recusada: quantidade };
export const recebimentoSchema = v.strictObject({
  recebimentoId, conferencia: v.exactOptional(conferencia),
  itens: v.pipe(v.array(v.strictObject({ ...linha, motivo: v.exactOptional(motivo), repor: v.exactOptional(v.boolean()) })),
    v.minLength(1), v.maxLength(100), v.check((itens) => new Set(itens.map((item) => item.apresentacaoId)).size === itens.length)),
});
export type Recebimento = v.InferOutput<typeof recebimentoSchema>;
export const confirmacaoRecebimentoSchema = v.object({ recebimentoId, numero: id });
const produto = { apresentacaoId: id, apresentacao: texto, unidade: unidadeSchema };
const registro = v.object({
  numero: id, responsavel: texto, confirmadoEm: dataIso, conferencia: v.nullable(conferencia),
  itens: v.array(v.object({
    ...linha, motivo: v.nullable(motivo), repor: v.boolean(),
    subtotalCentavos: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  })),
});
const situacao = v.picklist([
  'aguardando_despacho', 'em_entrega', 'entrega_parcial', 'entregue', 'sem_aceite',
  'finalizado_entrega_parcial', 'cancelado',
]);
export const situacaoEntrega: Record<v.InferOutput<typeof situacao>, string> = {
  aguardando_despacho: 'Aguardando despacho', em_entrega: 'Em entrega', entrega_parcial: 'Entrega parcial',
  entregue: 'Entregue', sem_aceite: 'Recebimento sem aceite',
  finalizado_entrega_parcial: 'Finalizado com entrega parcial', cancelado: 'Cancelado',
};
export const entregasSchema = v.object({
  pedidoNumero: id, situacao,
  itens: v.array(v.object({
    ...produto, pedida: saldo, despachada: saldo, recebida: saldo, recusada: saldo, cancelada: saldo,
    emTransito: saldo, pendenteDespacho: saldo, pendenteRecebimento: saldo,
  })),
  remessas: v.array(v.object({
    numero: id, modalidade: v.picklist(modalidadesSaida),
    itens: v.array(v.object({ ...produto, despachada: quantidade })),
    recebimento: v.nullable(registro),
  })),
  cancelamentos: v.array(cancelamentoRegistradoSchema),
});
export type Entregas = v.InferOutput<typeof entregasSchema>;
