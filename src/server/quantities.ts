import type { Pedido } from '../contracts/pilot.js';

export function milesimos(quantidade: string): bigint {
  const [inteiro = '0', fracao = ''] = quantidade.split('.');
  return BigInt(inteiro) * 1000n + BigInt(fracao.padEnd(3, '0'));
}

export function formatar(quantidade: bigint, unidade: Pedido['itens'][number]['unidade']): string {
  const inteiro = String(quantidade / 1000n);
  return unidade === 'kg' ? `${inteiro}.${String(quantidade % 1000n).padStart(3, '0')}` : inteiro;
}
