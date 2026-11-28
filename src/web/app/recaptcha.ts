import { acaoRecaptcha } from '../../contracts/login-web.js';

type GoogleRecaptcha = {
  ready(callback: () => void): void;
  execute(chave: string, options: { action: string }): Promise<string>;
};

declare global {
  interface Window {
    grecaptcha?: GoogleRecaptcha;
  }
}

let carregamento: { chave: string; promessa: Promise<GoogleRecaptcha> } | undefined;

function carregar(chave: string): Promise<GoogleRecaptcha> {
  if (carregamento?.chave === chave) return carregamento.promessa;
  const script = document.createElement('script');
  script.src = 'https://www.google.com/recaptcha/api.js?render=' + encodeURIComponent(chave);
  script.async = true;
  const promessa = new Promise<GoogleRecaptcha>((resolve, reject) => {
    const falhar = () => {
      clearTimeout(prazo);
      reject(new Error('reCAPTCHA indisponível.'));
    };
    const prazo = window.setTimeout(falhar, 8000);
    script.onerror = falhar;
    script.onload = () => {
      const google = window.grecaptcha;
      if (!google) return falhar();
      google.ready(() => {
        clearTimeout(prazo);
        resolve(google);
      });
    };
    document.head.append(script);
  }).catch((error: unknown) => {
    script.remove();
    if (carregamento?.promessa === promessa) carregamento = undefined;
    throw error;
  });
  carregamento = { chave, promessa };
  return promessa;
}

export async function tokenDoLogin(chave: string): Promise<string> {
  const google = await carregar(chave);
  let prazo: number | undefined;
  try {
    return await Promise.race([
      google.execute(chave, { action: acaoRecaptcha }),
      new Promise<never>((_, reject) => {
        prazo = window.setTimeout(() => reject(new Error('Verificação não concluída.')), 8000);
      }),
    ]);
  } finally {
    clearTimeout(prazo);
  }
}
