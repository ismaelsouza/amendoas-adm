import * as v from 'valibot';
import { loginSchema } from './pilot.js';

export const acaoRecaptcha = 'login_adm';
export const chaveRecaptcha = v.pipe(v.string(), v.regex(/^[\w-]{1,256}$/));
export const loginWebSchema = v.strictObject({
  ...loginSchema.entries,
  tokenRecaptcha: v.exactOptional(v.pipe(v.string(), v.minLength(1), v.maxLength(8192))),
});
export const loginWebConfigSchema = v.object({ chaveRecaptcha: v.nullable(chaveRecaptcha) });
