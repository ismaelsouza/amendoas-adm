import * as v from 'valibot';
import { id, preco, texto, unidadeSchema } from './pilot.js';

const dadosApresentacao = { nome: texto, unidade: unidadeSchema, precoPadraoCentavos: preco };
export const novoProdutoSchema = v.strictObject({
  cadastroId: v.pipe(v.string(), v.uuid(), v.toLowerCase()),
  nome: texto,
  apresentacao: v.strictObject(dadosApresentacao),
});
export type NovoProduto = v.InferOutput<typeof novoProdutoSchema>;

export const produtoSchema = v.object({
  id,
  nome: v.string(),
  apresentacoes: v.array(v.object({
    id,
    nome: v.string(),
    unidade: unidadeSchema,
    precoPadraoCentavos: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(4_294_967_295)),
  })),
});
export const catalogoProdutosSchema = v.object({ produtos: v.array(produtoSchema) });
export const produtoCadastradoSchema = v.object({ id });
export type Produto = v.InferOutput<typeof produtoSchema>;
