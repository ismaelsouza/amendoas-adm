import { fileURLToPath } from 'node:url';
import { parseCookie } from 'cookie';
import express from 'express';
import type { ErrorRequestHandler, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'mariadb';
import * as v from 'valibot';
import { cancelarSaldoSchema, perfisCancelamento } from '../contracts/cancellations.js';
import { perfisCorrecao, solicitarCorrecaoSchema } from '../contracts/corrections.js';
import { recebimentoSchema } from '../contracts/delivery.js';
import { saidaEstoqueSchema } from '../contracts/dispatch.js';
import { cnpjSchema, novoClienteCampoSchema } from '../contracts/field-customers.js';
import { loginWebSchema } from '../contracts/login-web.js';
import {
  alterarUsuarioSchema, loginSchema, novoUsuarioSchema, vendaBalcaoSchema, vendaCampoSchema,
} from '../contracts/pilot.js';
import type { Ambiente, Perfil, Usuario } from '../contracts/pilot.js';
import { devolucaoSchema } from '../contracts/returns.js';
import { entradaEstoqueSchema, perfisEstoque } from '../contracts/stock.js';
import {
  alterarUsuario, consultarSessao, criarSessao, criarUsuario, encerrarSessao, listarUsuarios, sessionDurationMs,
} from './accounts.js';
import type { Canal } from './accounts.js';
import { registrarCancelamento } from './cancellations.js';
import { aprovarCorrecao, consultarCorrecoes, solicitarCorrecao } from './corrections.js';
import { consultarEntregas, registrarRecebimento, resumoParaVendedor } from './delivery.js';
import { consultarExpedicao, registrarSaida } from './dispatch.js';
import { consultarCatalogoDoCliente, listarApresentacoesDeCampo, listarClientesDeCampo } from './field-catalog.js';
import { cadastrarClienteCampo, conferirClienteCampo, listarCadastrosPendentes, totalCadastrosPendentes } from './field-customers.js';
import { consultarPedidoDoVendedor, isDuplicate, listarCadastros, listarPedidos, listarPedidosDoVendedor, registrarPedido } from './orders.js';
import { consultarDevolucoes, registrarDevolucao } from './returns.js';
import type { Recaptcha } from './recaptcha.js';
import { consultarEntrada, consultarSaldos, listarApresentacoesEstoque, registrarEntrada } from './stock.js';

const cookieName = 'amendoas_sessao';
const tokenFormat = /^[A-Za-z0-9_-]{43}$/;
const filaPerfis: Perfil[] = ['administrador', 'gerente', 'estoque', 'balcao'];
const balcaoPerfis: Perfil[] = ['administrador', 'gerente', 'balcao'];
const validarId = v.pipe(v.string(), v.regex(/^[1-9]\d{0,9}$/), v.transform(Number), v.maxValue(4_294_967_295));
const verificacaoIndisponivel = 'A verificação do login do ADM está indisponível. Tente novamente em instantes.';

function criarLimiteLogin() {
  return rateLimit({
    windowMs: 60_000, limit: 12, skipSuccessfulRequests: true,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { mensagem: 'Muitas tentativas. Aguarde um minuto.' },
  });
}

function tokenDe(req: Request, canal: Canal): string | undefined {
  const token = canal === 'app'
    ? req.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/i)?.[1]
    : parseCookie(req.get('Cookie') ?? '')[cookieName];
  return token && tokenFormat.test(token) ? token : undefined;
}

function erro(res: Response, status: number, mensagem: string): void {
  res.status(status).json({ mensagem });
}

function responderCorrecao(res: Response, r: Awaited<ReturnType<typeof solicitarCorrecao>>): void {
  if (r.success) {
    res.status(r.criado ? 201 : 200).json({ numero: r.numero });
    return;
  }
  switch (r.error) {
    case 'pedido': return erro(res, 404, 'Pedido não encontrado.');
    case 'correcao': return erro(res, 404, 'Correção não encontrada neste pedido.');
    case 'bloqueio': return erro(res, 409, 'A primeira saída já foi confirmada e o pedido não pode ser corrigido.');
    case 'pendente': return erro(res, 409, 'Já há uma correção aguardando autorização neste pedido.');
    case 'itens': return erro(res, 422, 'Informe uma mudança nas quantidades ou preços vigentes. Pacotes e caixas exigem quantidades inteiras.');
    case 'cancelamento': return erro(res, 409, 'A nova quantidade seria menor que o saldo já cancelado.');
    case 'conflito': return erro(res, 409, 'Atualize o pedido e confira o histórico de correções.');
  }
}

export function createApp(db: Pool, {
  secureCookie, trustLoopbackProxy = false, ambiente = 'prd', agora = () => new Date(), recaptcha = null,
}: {
  secureCookie: boolean; trustLoopbackProxy?: boolean; ambiente?: Ambiente; agora?: () => Date;
  recaptcha?: Recaptcha | null;
}): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (trustLoopbackProxy) app.set('trust proxy', 'loopback');
  const api = express.Router();
  app.use('/api/v1', api);
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '64kb' }));

  api.get('/ambiente', (_req, res) => {
    res.json({ ambiente });
  });
  api.get('/saude', async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', ambiente });
    } catch {
      res.status(503).json({ status: 'indisponivel', ambiente });
    }
  });

  async function autorizar(req: Request, res: Response, canal: Canal, perfis: readonly Perfil[]): Promise<Usuario | null> {
    const token = tokenDe(req, canal);
    // Distingue um usuário do outro canal de um cliente sem autenticação.
    const outroCanal = canal === 'app' ? 'web' : 'app';
    const outroToken = token ? undefined : tokenDe(req, outroCanal);
    const usuario = token ? await consultarSessao(db, canal, token) : null;
    if (!usuario) {
      if (outroToken && await consultarSessao(db, outroCanal, outroToken)) {
        erro(res, 403, 'Seu perfil não tem acesso a esta operação.');
      } else {
        erro(res, 401, 'Entre para continuar.');
      }
      return null;
    }
    if (!perfis.includes(usuario.perfil)) {
      erro(res, 403, 'Seu perfil não tem acesso a esta operação.');
      return null;
    }
    return usuario;
  }

  const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: secureCookie, path: '/api/v1' };
  const limiteLogin = criarLimiteLogin();
  const limiteWeb = recaptcha === null ? limiteLogin : criarLimiteLogin();
  api.get('/sessao/web/configuracao', (_req, res) => {
    if (recaptcha === 'invalida') return erro(res, 503, verificacaoIndisponivel);
    res.json({ chaveRecaptcha: recaptcha?.chave ?? null });
  });
  for (const canal of ['app', 'web'] as const) {
    api.post('/sessao/' + canal, canal === 'web' ? limiteWeb : limiteLogin, async (req, res) => {
      const dados = v.safeParse(canal === 'web' ? loginWebSchema : loginSchema, req.body);
      if (!dados.success) return erro(res, 400, 'Informe o login e a senha.');
      if (canal === 'web' && recaptcha) {
        if (recaptcha === 'invalida') return erro(res, 503, verificacaoIndisponivel);
        const token = 'tokenRecaptcha' in dados.output ? dados.output.tokenRecaptcha : undefined;
        const verificacao = typeof token === 'string' ? await recaptcha.verificar(token) : 'recusada';
        if (verificacao === 'indisponivel') return erro(res, 503, 'A verificação do Google está indisponível. Tente novamente em instantes.');
        if (verificacao === 'recusada') return erro(res, 403, 'Não foi possível validar esta tentativa. Tente entrar novamente.');
      }
      const { login, senha } = dados.output;
      const sessao = await criarSessao(db, canal, login, senha);
      if (!sessao) return erro(res, 401, 'Login ou senha inválidos para este aplicativo.');
      if (canal === 'web') {
        res.cookie(cookieName, sessao.token, { ...cookieOptions, maxAge: sessionDurationMs });
        res.json(sessao.usuario);
      } else {
        res.json(sessao);
      }
    });
    api.delete('/sessao/' + canal, async (req, res) => {
      const token = tokenDe(req, canal);
      // Evita aceitar uma solicitação de saída feita por um formulário de outro site.
      if (canal === 'web' && !req.is('application/json')) return erro(res, 415, 'Envie JSON.');
      if (token) await encerrarSessao(db, canal, token);
      if (canal === 'web') res.clearCookie(cookieName, cookieOptions);
      res.sendStatus(204);
    });
  }
  api.get('/sessao/web', async (req, res) => {
    const usuario = await autorizar(req, res, 'web', filaPerfis);
    if (usuario) res.json(usuario);
  });

  api.get('/pedidos', async (req, res) => {
    if (!await autorizar(req, res, 'web', filaPerfis)) return;
    const cursor = v.safeParse(v.optional(validarId), req.query.antesDe);
    if (!cursor.success) return erro(res, 400, 'Página inválida.');
    res.json(await listarPedidos(db, cursor.output));
  });
  api.get('/cadastros/balcao', async (req, res) => {
    if (await autorizar(req, res, 'web', balcaoPerfis)) res.json(await listarCadastros(db));
  });
  api.get('/cadastros/campo/catalogo', async (req, res) => {
    if (!await autorizar(req, res, 'app', ['vendedor'])) return;
    res.json({ apresentacoes: await listarApresentacoesDeCampo(db, null) });
  });
  api.get('/cadastros/campo/clientes', async (req, res) => {
    if (!await autorizar(req, res, 'app', ['vendedor'])) return;
    res.json({ clientes: await listarClientesDeCampo(db) });
  });
  api.get('/cadastros/campo/cliente', async (req, res) => {
    if (!await autorizar(req, res, 'app', ['vendedor'])) return;
    const porId = req.query.id !== undefined;
    if (porId && req.query.cnpj !== undefined) return erro(res, 400, 'Informe só o CNPJ ou o ID do cliente.');
    const chave = porId ? v.safeParse(validarId, req.query.id) : v.safeParse(cnpjSchema, req.query.cnpj);
    if (!chave.success) return erro(res, 400, porId ? 'Confira o cliente informado.' : 'Confira o CNPJ informado.');
    const catalogo = await consultarCatalogoDoCliente(db, chave.output);
    if (!catalogo) return erro(res, 404, porId ? 'Cliente não cadastrado no Essentials.' : 'CNPJ não cadastrado no Essentials.');
    res.json(catalogo);
  });
  api.post('/cadastros/campo/cliente', async (req, res) => {
    const vendedor = await autorizar(req, res, 'app', ['vendedor']);
    if (!vendedor) return;
    const dados = v.safeParse(novoClienteCampoSchema, req.body);
    if (!dados.success) return erro(res, 400, 'Confira o CNPJ, o nome, o telefone com DDD e o endereço completo.');
    const catalogo = await cadastrarClienteCampo(db, vendedor, dados.output, agora());
    if (!catalogo) return erro(res, 409, 'Este CNPJ já está cadastrado. Consulte o cadastro existente.');
    res.status(201).json(catalogo);
  });
  api.get('/cadastros/conferencia', async (req, res) => {
    if (!await autorizar(req, res, 'web', ['administrador'])) return;
    const cursor = v.safeParse(v.optional(validarId), req.query.antesDe);
    if (!cursor.success) return erro(res, 400, 'Página inválida.');
    res.json(await listarCadastrosPendentes(db, cursor.output));
  });
  api.get('/cadastros/conferencia/total', async (req, res) => {
    if (!await autorizar(req, res, 'web', ['administrador'])) return;
    res.json({ total: await totalCadastrosPendentes(db) });
  });
  api.post('/cadastros/conferencia/:cliente/conferir', async (req, res) => {
    const administrador = await autorizar(req, res, 'web', ['administrador']);
    if (!administrador) return;
    const cliente = v.safeParse(validarId, req.params.cliente);
    if (!cliente.success) return erro(res, 400, 'Cliente inválido.');
    if (!await conferirClienteCampo(db, cliente.output, administrador.id, agora())) return erro(res, 404, 'Cadastro de campo não encontrado.');
    res.sendStatus(204);
  });
  api.get('/pedidos/campo', async (req, res) => {
    const vendedor = await autorizar(req, res, 'app', ['vendedor']);
    if (!vendedor) return;
    const cursor = v.safeParse(v.optional(validarId), req.query.antesDe);
    if (!cursor.success) return erro(res, 400, 'Página inválida.');
    res.json(await listarPedidosDoVendedor(db, vendedor.id, cursor.output));
  });
  api.get('/pedidos/campo/:numero/entregas', async (req, res) => {
    const vendedor = await autorizar(req, res, 'app', ['vendedor']);
    if (!vendedor) return;
    const numero = v.safeParse(validarId, req.params.numero);
    if (!numero.success) return erro(res, 400, 'Número do pedido inválido.');
    const entrega = await consultarEntregas(db, numero.output, vendedor.id);
    if (!entrega) return erro(res, 404, 'Pedido não encontrado.');
    res.json(resumoParaVendedor(entrega));
  });
  api.get('/pedidos/campo/:numero', async (req, res) => {
    const vendedor = await autorizar(req, res, 'app', ['vendedor']);
    if (!vendedor) return;
    const numero = v.safeParse(validarId, req.params.numero);
    if (!numero.success) return erro(res, 400, 'Número do pedido inválido.');
    const pedido = await consultarPedidoDoVendedor(db, vendedor.id, numero.output);
    if (!pedido) return erro(res, 404, 'Pedido não encontrado.');
    res.json(pedido);
  });
  api.get('/pedidos/campo/:numero/correcoes', async (req, res) => {
    const vendedor = await autorizar(req, res, 'app', ['vendedor']);
    if (!vendedor) return;
    const numero = v.safeParse(validarId, req.params.numero);
    if (!numero.success) return erro(res, 400, 'Confira o número do pedido.');
    const r = await consultarCorrecoes(db, numero.output, vendedor.id);
    if (!r) return erro(res, 404, 'Pedido não encontrado.');
    res.json({ ...r, correcoes: r.correcoes.map(({ autorizadaPor: _, solicitadaPor: __, ...correcao }) => correcao) });
  });
  api.post('/pedidos/campo/:numero/correcoes', async (req, res) => {
    const vendedor = await autorizar(req, res, 'app', ['vendedor']);
    if (!vendedor) return;
    const numero = v.safeParse(validarId, req.params.numero);
    const dados = v.safeParse(solicitarCorrecaoSchema, req.body);
    if (!numero.success || !dados.success) return erro(res, 400, 'Confira o pedido, as alterações e o motivo.');
    responderCorrecao(res, await solicitarCorrecao(db, vendedor, numero.output, dados.output, agora));
  });
  for (const origem of ['balcao', 'campo'] as const) {
    api.post('/pedidos/' + origem, async (req, res) => {
      const usuario = origem === 'campo'
        ? await autorizar(req, res, 'app', ['vendedor'])
        : await autorizar(req, res, 'web', balcaoPerfis);
      if (!usuario) return;
      const dados = origem === 'campo'
        ? v.safeParse(vendaCampoSchema, req.body)
        : v.safeParse(vendaBalcaoSchema, req.body);
      if (!dados.success) return erro(res, 400, 'Confira o cliente, a data, os itens e os preços do pedido.');
      const venda = dados.output;
      const retiradaImediata = 'retiradaImediata' in venda && venda.retiradaImediata === true;
      const resultado = await registrarPedido(db, usuario, venda, origem, retiradaImediata);
      if (!resultado.success) {
        if (resultado.error === 'conflito') return erro(res, 409, 'A identificação já pertence a uma venda com outros dados.');
        if (resultado.error === 'quantidade') return erro(res, 422, 'Pacotes e caixas exigem quantidade inteira.');
        if (resultado.error === 'precoMudou') return erro(res, 422, 'O preço foi atualizado. Confira o valor antes de registrar.');
        return erro(res, 422, 'Cliente ou apresentação não encontrado.');
      }
      res.status(resultado.criado ? 201 : 200).json(resultado.data);
    });
  }

  api.get('/pedidos/:numero/saidas', async (req, res) => {
    if (!await autorizar(req, res, 'web', perfisEstoque)) return;
    const numero = v.safeParse(validarId, req.params.numero);
    if (!numero.success) return erro(res, 400, 'Confira o número do pedido.');
    const expedicao = await consultarExpedicao(db, numero.output, agora());
    if (!expedicao) return erro(res, 404, 'Pedido não encontrado.');
    res.json(expedicao);
  });
  api.post('/pedidos/:numero/saidas', async (req, res) => {
    const usuario = await autorizar(req, res, 'web', perfisEstoque);
    if (!usuario) return;
    const numero = v.safeParse(validarId, req.params.numero);
    const dados = v.safeParse(saidaEstoqueSchema, req.body);
    if (!numero.success || !dados.success) return erro(res, 400, 'Confira modalidade, lotes e quantidades da saída.');
    const resultado = await registrarSaida(db, usuario, numero.output, dados.output, agora);
    if (resultado.success) {
      res.status(resultado.criado ? 201 : 200).json(resultado.data);
      return;
    }
    switch (resultado.error) {
      case 'pedido': return erro(res, 404, 'Pedido não encontrado.');
      case 'modalidade': return erro(res, 422, 'A saída deste pedido é por retirada no balcão.');
      case 'lote': return erro(res, 422, 'Confirme apenas lotes das apresentações pedidas.');
      case 'quantidade': return erro(res, 422, 'Pacotes e caixas exigem quantidade inteira.');
      case 'pendente': return erro(res, 409, 'A quantidade excede o que ainda falta despachar. Atualize o pedido e confira a saída.');
      case 'saldo': return erro(res, 409, 'Um lote venceu ou não tem saldo suficiente. Atualize o pedido e confira a saída.');
      case 'conflito': return erro(res, 409, 'O identificador já pertence a outra saída.');
      case 'concorrencia': return erro(res, 409, 'Houve outra movimentação ao mesmo tempo. Atualize o pedido e confira a saída.');
    }
  });

  api.get('/pedidos/:numero/entregas', async (req, res) => {
    if (!await autorizar(req, res, 'web', filaPerfis)) return;
    const numero = v.safeParse(validarId, req.params.numero);
    if (!numero.success) return erro(res, 400, 'Confira o número do pedido.');
    const entregas = await consultarEntregas(db, numero.output);
    if (!entregas) return erro(res, 404, 'Pedido não encontrado.');
    res.json(entregas);
  });
  api.get('/pedidos/:numero/correcoes', async (req, res) => {
    if (!await autorizar(req, res, 'web', perfisCorrecao)) return;
    const numero = v.safeParse(validarId, req.params.numero);
    if (!numero.success) return erro(res, 400, 'Confira o número do pedido.');
    const r = await consultarCorrecoes(db, numero.output);
    if (!r) return erro(res, 404, 'Pedido não encontrado.');
    res.json(r);
  });
  api.post('/pedidos/:numero/correcoes/:correcao/aprovacao', async (req, res) => {
    const usuario = await autorizar(req, res, 'web', perfisCorrecao);
    if (!usuario) return;
    const numero = v.safeParse(validarId, req.params.numero);
    const correcao = v.safeParse(validarId, req.params.correcao);
    if (!numero.success || !correcao.success) return erro(res, 400, 'Confira o pedido e a correção.');
    responderCorrecao(res, await aprovarCorrecao(db, usuario, numero.output, correcao.output, agora));
  });
  api.post('/pedidos/:numero/cancelamentos', async (req, res) => {
    const usuario = await autorizar(req, res, 'web', perfisCancelamento);
    if (!usuario) return;
    const numero = v.safeParse(validarId, req.params.numero);
    const dados = v.safeParse(cancelarSaldoSchema, req.body);
    if (!numero.success || !dados.success) return erro(res, 400, 'Confira o pedido, as quantidades e o motivo do cancelamento.');
    const r = await registrarCancelamento(db, usuario, numero.output, dados.output, agora);
    if (r.success) {
      res.status(r.criado ? 201 : 200).json(r.data);
      return;
    }
    switch (r.error) {
      case 'pedido': return erro(res, 404, 'Pedido não encontrado.');
      case 'quantidade': return erro(res, 422, 'Use as apresentações do pedido. Pacotes e caixas exigem quantidades inteiras.');
      case 'pendente': return erro(res, 409, 'O cancelamento excede o saldo a despachar. Atualize as entregas para conferir.');
      case 'conflito': return erro(res, 409, 'Atualize as entregas e confira o histórico de cancelamentos.');
    }
  });
  api.post('/pedidos/:numero/saidas/:saida/recebimento', async (req, res) => {
    const usuario = await autorizar(req, res, 'web', filaPerfis);
    if (!usuario) return;
    const numero = v.safeParse(validarId, req.params.numero);
    const saida = v.safeParse(validarId, req.params.saida);
    const dados = v.safeParse(recebimentoSchema, req.body);
    if (!numero.success || !saida.success || !dados.success) return erro(res, 400, 'Confira a remessa e os dados do recebimento.');
    const resultado = await registrarRecebimento(db, usuario, numero.output, saida.output, dados.output, agora);
    if (resultado.success) {
      res.status(resultado.criado ? 201 : 200).json(resultado.data);
      return;
    }
    switch (resultado.error) {
      case 'remessa': return erro(res, 404, 'Remessa não encontrada neste pedido.');
      case 'perfil': return erro(res, 403, 'O balcão só confirma recebimentos de retiradas.');
      case 'itens': return erro(res, 422, 'Para cada item, informe o total recebido e o recusado, que devem somar o despachado. Informe o motivo de cada recusa.');
      case 'conferencia': return erro(res, 422, 'Confira o comprovante e esclareça qualquer ressalva antes de confirmar a transportadora.');
      case 'conflito': return erro(res, 409, 'Não foi possível confirmar. Atualize e confira se o recebimento já está no histórico.');
    }
  });

  api.get('/pedidos/:numero/saidas/:saida/devolucoes', async (req, res) => {
    if (!await autorizar(req, res, 'web', perfisEstoque)) return;
    const numero = v.safeParse(validarId, req.params.numero);
    const saida = v.safeParse(validarId, req.params.saida);
    if (!numero.success || !saida.success) return erro(res, 400, 'Confira o pedido e a remessa.');
    const resultado = await consultarDevolucoes(db, numero.output, saida.output, agora());
    if (!resultado) return erro(res, 404, 'Remessa não encontrada neste pedido.');
    res.json(resultado);
  });
  api.post('/pedidos/:numero/saidas/:saida/devolucoes', async (req, res) => {
    const usuario = await autorizar(req, res, 'web', perfisEstoque);
    if (!usuario) return;
    const numero = v.safeParse(validarId, req.params.numero);
    const saida = v.safeParse(validarId, req.params.saida);
    const dados = v.safeParse(devolucaoSchema, req.body);
    if (!numero.success || !saida.success || !dados.success) return erro(res, 400, 'Confira a remessa e os dados da devolução.');
    const resultado = await registrarDevolucao(db, usuario, numero.output, saida.output, dados.output, agora);
    if (resultado.success) {
      res.status(resultado.criado ? 201 : 200).json(resultado.data);
      return;
    }
    switch (resultado.error) {
      case 'remessa': return erro(res, 404, 'Remessa não encontrada neste pedido.');
      case 'recebimento': return erro(res, 409, 'Confirme o recebimento da remessa primeiro.');
      case 'quantidade': return erro(res, 422, 'Confira os lotes da remessa, as quantidades e o motivo de cada descarte.');
      case 'vencido': return erro(res, 422, 'Lote vencido não pode voltar para venda.');
      case 'limite': return erro(res, 409, 'A devolução excede o saldo devolvível do lote ou da origem selecionada.');
      case 'conflito': return erro(res, 409, 'Atualize a remessa e confira se a devolução já está no histórico.');
    }
  });

  api.get('/estoque/apresentacoes', async (req, res) => {
    if (await autorizar(req, res, 'web', perfisEstoque)) res.json(await listarApresentacoesEstoque(db));
  });
  api.get('/estoque/saldos/:apresentacaoId', async (req, res) => {
    if (!await autorizar(req, res, 'web', perfisEstoque)) return;
    const id = v.safeParse(validarId, req.params.apresentacaoId);
    if (!id.success) return erro(res, 400, 'Confira a apresentação.');
    const saldos = await consultarSaldos(db, id.output, agora());
    if (!saldos) return erro(res, 404, 'Apresentação não encontrada.');
    res.json(saldos);
  });
  api.get('/estoque/entradas/:numero', async (req, res) => {
    if (!await autorizar(req, res, 'web', perfisEstoque)) return;
    const numero = v.safeParse(validarId, req.params.numero);
    if (!numero.success) return erro(res, 400, 'Confira o número da entrada.');
    const entrada = await consultarEntrada(db, numero.output);
    if (!entrada) return erro(res, 404, 'Entrada não encontrada.');
    res.json(entrada);
  });
  api.post('/estoque/entradas', async (req, res) => {
    const usuario = await autorizar(req, res, 'web', perfisEstoque);
    if (!usuario) return;
    const dados = v.safeParse(entradaEstoqueSchema, req.body);
    if (!dados.success) return erro(res, 400, 'Confira apresentação, códigos, validades e quantidades. Não repita lote e validade.');
    const resultado = await registrarEntrada(db, usuario, dados.output, agora());
    if (!resultado.success) {
      if (resultado.error === 'conflito') return erro(res, 409, 'O identificador já pertence a outra entrada.');
      if (resultado.error === 'quantidade') return erro(res, 422, 'Pacotes e caixas exigem quantidade inteira.');
      return erro(res, 422, 'Apresentação não encontrada.');
    }
    res.status(resultado.criado ? 201 : 200).json(resultado.data);
  });

  api.get('/usuarios', async (req, res) => {
    if (await autorizar(req, res, 'web', ['administrador'])) res.json({ usuarios: await listarUsuarios(db) });
  });
  api.post('/usuarios', async (req, res) => {
    const administrador = await autorizar(req, res, 'web', ['administrador']);
    if (!administrador) return;
    const dados = v.safeParse(novoUsuarioSchema, req.body);
    if (!dados.success) return erro(res, 400, 'Confira nome, login, perfil e senha de pelo menos 12 caracteres.');
    const usuario = await criarUsuario(db, administrador.id, dados.output);
    if (!usuario) return erro(res, 403, 'Seu perfil não tem acesso a esta operação.');
    res.status(201).json(usuario);
  });
  api.patch('/usuarios/:id', async (req, res) => {
    const administrador = await autorizar(req, res, 'web', ['administrador']);
    if (!administrador) return;
    const id = v.safeParse(validarId, req.params.id);
    const dados = v.safeParse(alterarUsuarioSchema, req.body);
    if (!id.success || !dados.success) return erro(res, 400, 'Confira os dados do usuário.');
    const resultado = await alterarUsuario(db, administrador, id.output, dados.output);
    if (resultado.success) {
      res.json(resultado.data);
    } else if (resultado.error === 'perfilProprio') {
      erro(res, 409, 'O administrador precisa manter o próprio perfil.');
    } else if (resultado.error === 'permissao') {
      erro(res, 403, 'Seu perfil não tem acesso a esta operação.');
    } else {
      erro(res, 404, 'Usuário não encontrado.');
    }
  });

  api.use((_req, res) => erro(res, 404, 'Operação não encontrada.'));
  const processarErro: ErrorRequestHandler = (error: unknown, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (isDuplicate(error)) return erro(res, 409, 'Este login já está em uso.');
    if (error instanceof Error && 'status' in error) {
      if (error.status === 400) return erro(res, 400, 'JSON inválido.');
      if (error.status === 413) return erro(res, 413, 'O pedido excede o tamanho permitido.');
    }
    console.error('Falha ao processar a solicitação.', error instanceof Error ? error.name : typeof error);
    erro(res, 500, 'Não foi possível concluir a operação. Tente novamente.');
  };
  app.use(processarErro);
  app.use(express.static(fileURLToPath(new URL('../web/', import.meta.url))));
  return app;
}
