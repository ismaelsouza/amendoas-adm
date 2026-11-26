import * as v from 'valibot';
import { dataIso, id, texto } from './pilot.js';

const formatoCnpj = /^(?:[0-9A-Z]{12}[0-9]{2}|[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-[0-9]{2})$/;
export const cnpjSchema = v.pipe(v.string(), v.trim(),
  v.check((valor) => /^[0-9a-zA-Z./-]{14,18}$/.test(valor)), v.toUpperCase(), v.regex(formatoCnpj),
  v.transform((valor) => valor.replace(/[./-]/g, '')), v.check(cnpjValido));

function digito(base: string): string {
  // O módulo 11 usa os valores ASCII menos 48 no CNPJ numérico e no alfanumérico.
  let soma = 0;
  for (let i = 0; i < base.length; i++) {
    soma += (base.charCodeAt(i) - 48) * (2 + (base.length - 1 - i) % 8);
  }
  const resto = soma % 11;
  return String(resto < 2 ? 0 : 11 - resto);
}

function cnpjValido(valor: string): boolean {
  if (/^(\d)\1{13}$/.test(valor)) return false;
  const base = valor.slice(0, 12);
  const primeiro = digito(base);
  return valor === base + primeiro + digito(base + primeiro);
}

const uf = v.picklist([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);
const cep = v.pipe(v.string(), v.trim(), v.regex(/^\d{5}-?\d{3}$/), v.transform((s) => s.replace('-', '')));
const numero = v.nullable(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(20)));
const telefone = v.pipe(v.string(), v.trim(), v.regex(/^(?:\+55 ?)?[()\d -]{10,20}$/),
  v.transform((s) => s.replace(/^\+55 ?/, '').replace(/\D/g, '')), v.regex(/^[1-9]\d{9,10}$/));
const endereco = { cep, logradouro: texto, numero, bairro: texto, municipio: texto, uf };

export const novoClienteCampoSchema = v.strictObject({
  cnpj: cnpjSchema, nome: texto, telefone,
  endereco: v.strictObject({ ...endereco, complemento: v.exactOptional(texto) }),
});
export type NovoClienteCampo = v.InferOutput<typeof novoClienteCampoSchema>;

const clientePendenteSchema = v.object({
  clienteId: id, cnpj: cnpjSchema, nome: texto, telefone, vendedor: texto, cadastradoEm: dataIso,
  endereco: v.object({ ...endereco, complemento: v.nullable(texto) }),
});
export type ClientePendente = v.InferOutput<typeof clientePendenteSchema>;
export const cadastrosPendentesSchema = v.object({
  cadastros: v.array(clientePendenteSchema), proximoAntesDe: v.nullable(id),
});
export type CadastrosPendentes = v.InferOutput<typeof cadastrosPendentesSchema>;
export const totalCadastrosPendentesSchema = v.object({ total: v.pipe(v.number(), v.safeInteger(), v.minValue(0)) });
