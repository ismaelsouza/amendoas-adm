import * as v from 'valibot';
import { dataIso, id, itensVendaSchema, pedidoSchema, preco, quantidade, texto, unidadeSchema } from './pilot.js';

export const perfisCorrecao = ['administrador', 'gerente'] as const;
const correcaoId = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const motivo = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(240));
export const solicitarCorrecaoSchema = v.strictObject({ correcaoId, motivo, itens: itensVendaSchema });
export type SolicitarCorrecao = v.InferOutput<typeof solicitarCorrecaoSchema>;
export const confirmacaoCorrecaoSchema = v.object({ numero: id });

const valor = v.object({ quantidade, precoUnitarioCentavos: preco });
const itemCorrigido = v.object({
  apresentacaoId: id, apresentacao: texto, unidade: unidadeSchema, anterior: valor, proposta: valor,
});
const correcao = v.object({
  numero: id, motivo, solicitadaEm: dataIso, solicitadaPor: texto,
  situacao: v.picklist(['pendente', 'aprovada', 'impedida']),
  autorizadaEm: v.nullable(dataIso), autorizadaPor: v.nullable(texto),
  itens: v.array(itemCorrigido),
});
export const correcoesPedidoSchema = v.object({
  pedidoNumero: id, podeSolicitar: v.boolean(), itens: pedidoSchema.entries.itens, correcoes: v.array(correcao),
});
export type CorrecoesPedido = v.InferOutput<typeof correcoesPedidoSchema>;
