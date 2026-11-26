import * as v from 'valibot';
import { dataIso, id, quantidade, texto, unidadeSchema } from './pilot.js';
import type { Perfil } from './pilot.js';

export const perfisEstoque: readonly Perfil[] = ['administrador', 'gerente', 'estoque'];

const validade = v.pipe(v.string(), v.regex(/^[1-9]\d{3}-\d{2}-\d{2}$/), v.check((value) => {
  const data = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(data.getTime()) && data.toISOString().slice(0, 10) === value;
}));
const codigo = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80));
const entradaId = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const loteSchema = v.strictObject({ codigo, validade, quantidade });
export const entradaEstoqueSchema = v.strictObject({
  entradaId,
  apresentacaoId: id,
  lotes: v.pipe(v.array(loteSchema), v.minLength(1), v.maxLength(100),
    v.check((lotes) => new Set(lotes.map((lote) => JSON.stringify([lote.validade, lote.codigo]))).size === lotes.length)),
});
export type EntradaEstoque = v.InferOutput<typeof entradaEstoqueSchema>;

export const confirmacaoEntradaSchema = v.object({ numero: id, entradaId });
export const detalheEntradaSchema = v.object({
  numero: id, apresentacaoId: id, apresentacao: texto, unidade: unidadeSchema, recebidoEm: dataIso,
  responsavel: texto, lotes: v.array(loteSchema),
});
export type DetalheEntrada = v.InferOutput<typeof detalheEntradaSchema>;

export const apresentacoesEstoqueSchema = v.object({
  apresentacoes: v.array(v.object({ id, apresentacao: texto, unidade: unidadeSchema })),
});
export type ApresentacoesEstoque = v.InferOutput<typeof apresentacoesEstoqueSchema>;

const saldo = v.pipe(v.string(), v.regex(/^\d+(\.\d{3})?$/));
export const saldosEstoqueSchema = v.object({
  totalFisico: saldo, totalDisponivel: saldo,
  validades: v.array(v.object({ validade, fisico: saldo, disponivel: saldo, vencida: v.boolean() })),
});
export type SaldosEstoque = v.InferOutput<typeof saldosEstoqueSchema>;
