import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const fakeSalt = randomBytes(16).toString('hex');
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

function derivarChave(senha: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(senha, salt, 64, scryptOptions, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(senha: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await derivarChave(senha, salt);
  return salt + ':' + hash.toString('hex');
}

export async function checkPassword(senha: string, registrado: string | undefined): Promise<boolean> {
  const [salt = fakeSalt, hex] = registrado?.split(':') ?? [];
  const hash = await derivarChave(senha, salt);
  return hex !== undefined && /^[0-9a-f]{128}$/.test(hex)
    && timingSafeEqual(hash, Buffer.from(hex, 'hex'));
}

