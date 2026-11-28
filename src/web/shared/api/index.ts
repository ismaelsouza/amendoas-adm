import * as v from 'valibot';
import { erroSchema } from '../../../contracts/pilot.js';

type ApiResult<T> = { success: true; data: T }
  | { success: false; mensagem: string; status: number };

export async function api<T>(
  url: string, ler: (payload: unknown) => T, options?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const response = await fetch('/api/v1' + url, options);
    if (!response.ok) {
      const problema = v.safeParse(erroSchema, await response.json().catch(() => null));
      return {
        success: false,
        status: response.status,
        mensagem: problema.success ? problema.output.mensagem : 'A operação não pôde ser concluída.',
      };
    }
    const payload: unknown = response.status === 204 ? null : await response.json();
    return { success: true, data: ler(payload) };
  } catch {
    return { success: false, status: 0, mensagem: 'Não foi possível confirmar a operação. Tente novamente.' };
  }
}

export function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

