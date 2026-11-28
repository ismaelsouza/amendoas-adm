import * as v from 'valibot';
import { acaoRecaptcha, chaveRecaptcha } from '../contracts/login-web.js';

type Verificacao = 'aceita' | 'recusada' | 'indisponivel';
export type Recaptcha = { chave: string; verificar(token: string): Promise<Verificacao> } | 'invalida';

const resposta = v.object({
  success: v.boolean(),
  score: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1))),
  action: v.optional(v.string()),
  hostname: v.optional(v.string()),
  'error-codes': v.optional(v.array(v.string()), []),
});
const errosDoToken = new Set(['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate']);
const hostname = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function configurarRecaptcha(env: NodeJS.ProcessEnv, requisitar = fetch): Recaptcha | null {
  const chave = env.RECAPTCHA_SITE_KEY?.trim() ?? '';
  const segredo = env.RECAPTCHA_SECRET_KEY?.trim() ?? '';
  const listaDominios = env.RECAPTCHA_HOSTNAMES?.trim() ?? '';
  const score = env.RECAPTCHA_MIN_SCORE?.trim() ?? '';
  if (!chave && !segredo && !listaDominios && !score) return null;
  const dominios = listaDominios.split(',').map((item) => item.trim().toLowerCase());
  if (!v.is(chaveRecaptcha, chave) || !v.is(chaveRecaptcha, segredo)
    || !dominios.every((dominio) => dominio.length <= 253 && hostname.test(dominio))
    || (score && !/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(score))) {
    return 'invalida';
  }
  const limite = Number(score || '0.5');

  return {
    chave,
    async verificar(token) {
      try {
        const res = await requisitar('https://www.google.com/recaptcha/api/siteverify', {
          method: 'POST',
          body: new URLSearchParams({ secret: segredo, response: token }),
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return 'indisponivel';
        const verificada = v.safeParse(resposta, await res.json());
        if (!verificada.success) return 'indisponivel';
        const r = verificada.output;
        if (r['error-codes'].some((codigo) => !errosDoToken.has(codigo))) {
          return 'indisponivel';
        }
        return r.success && r['error-codes'].length === 0 && r.action === acaoRecaptcha
          && r.hostname !== undefined && dominios.includes(r.hostname.toLowerCase())
          && r.score !== undefined && r.score >= limite ? 'aceita' : 'recusada';
      } catch {
        return 'indisponivel';
      }
    },
  };
}
