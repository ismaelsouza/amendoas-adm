import * as v from 'valibot';

export const perfilSchema = v.picklist(['administrador', 'gerente', 'estoque', 'balcao', 'vendedor']);
export type Perfil = v.InferOutput<typeof perfilSchema>;
export const id = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(4_294_967_295));
export const texto = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120));
const login = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.regex(/^[a-z0-9._-]{3,60}$/));
export const dataIso = v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  v.check((value) => {
    const timestamp = new Date(value);
    return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
  }));

export const sessaoSchema = v.object({ id, nome: texto, login, perfil: perfilSchema });
export type Usuario = v.InferOutput<typeof sessaoSchema>;
export const loginSchema = v.strictObject({
  login,
  senha: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
});
const novaSenha = v.pipe(v.string(), v.minLength(12), v.maxLength(128));
export const novoUsuarioSchema = v.strictObject({ nome: texto, login, perfil: perfilSchema, senha: novaSenha });
export const alterarUsuarioSchema = v.strictObject({
  nome: texto, login, perfil: perfilSchema, senha: v.exactOptional(novaSenha),
});
export const usuariosSchema = v.object({ usuarios: v.array(sessaoSchema) });
export const unidadeSchema = v.picklist(['pacote', 'caixa', 'kg']);
export const quantidade = v.pipe(v.string(), v.regex(/^\d{1,6}(\.\d{1,3})?$/), v.check((value) => Number(value) > 0));
export const preco = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(999_999_999));
const itemEnvio = v.strictObject({ apresentacaoId: id, quantidade, precoUnitarioCentavos: preco });
export const itensVendaSchema = v.pipe(v.array(itemEnvio), v.minLength(1), v.maxLength(100),
  v.check((items) => new Set(items.map((item) => item.apresentacaoId)).size === items.length));
const vendaId = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const pedido = { vendaId, clienteId: id, fechadoEm: dataIso, itens: itensVendaSchema };
export const vendaCampoSchema = v.strictObject(pedido);
export const vendaBalcaoSchema = v.strictObject({ ...pedido, retiradaImediata: v.boolean() });
export type Venda = v.InferOutput<typeof vendaCampoSchema>;
export const confirmacaoSchema = v.object({ vendaId, numero: id });
const origem = v.picklist(['campo', 'balcao']);
export const pedidoSchema = v.object({
  numero: id, origem, responsavel: texto, cliente: texto, fechadoEm: dataIso, retiradaImediata: v.boolean(),
  itens: v.array(v.object({
    apresentacaoId: id, apresentacao: texto, unidade: unidadeSchema, quantidade, precoUnitarioCentavos: preco,
  })),
});
export type Pedido = v.InferOutput<typeof pedidoSchema>;
const pedidoFilaSchema = v.object({ ...pedidoSchema.entries, correcaoPendente: v.boolean() });
export type PedidoFila = v.InferOutput<typeof pedidoFilaSchema>;
export const filaSchema = v.object({ pedidos: v.array(pedidoFilaSchema), proximoAntesDe: v.nullable(id) });
export const cadastrosSchema = v.object({
  clientes: v.array(v.object({ id, nome: texto })),
  apresentacoes: v.array(v.object({ id, apresentacao: texto, unidade: unidadeSchema, precoUnitarioCentavos: preco })),
});
export type Cadastros = v.InferOutput<typeof cadastrosSchema>;
export const erroSchema = v.object({ mensagem: v.string() });
export const ambienteValorSchema = v.picklist(['dsv', 'hml', 'prd']);
export type Ambiente = v.InferOutput<typeof ambienteValorSchema>;
export const ambienteSchema = v.object({ ambiente: ambienteValorSchema });
