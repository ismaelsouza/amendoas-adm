import { pathToFileURL } from 'node:url';
import type { Pool } from 'mariadb';
import { openDb } from './config.js';

const tables = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    login VARCHAR(60) NOT NULL UNIQUE,
    perfil ENUM('administrador', 'gerente', 'estoque', 'balcao', 'vendedor') NOT NULL,
    senha_hash VARCHAR(192) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sessoes (
    token_hash BINARY(32) PRIMARY KEY,
    usuario_id INT UNSIGNED NOT NULL REFERENCES usuarios(id),
    canal ENUM('app', 'web') NOT NULL,
    expira_em BIGINT UNSIGNED NOT NULL,
    INDEX (expira_em)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS clientes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(120) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS apresentacoes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    apresentacao VARCHAR(120) NOT NULL,
    unidade ENUM('pacote', 'caixa', 'kg') NOT NULL,
    preco_padrao_centavos INT UNSIGNED NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS cnpjs_clientes (
    cliente_id INT UNSIGNED PRIMARY KEY REFERENCES clientes(id),
    cnpj CHAR(14) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS cadastros_clientes_campo (
    cliente_id INT UNSIGNED PRIMARY KEY REFERENCES cnpjs_clientes(cliente_id),
    vendedor_id INT UNSIGNED NOT NULL REFERENCES usuarios(id),
    vendedor VARCHAR(120) NOT NULL,
    cadastrado_em VARCHAR(35) NOT NULL,
    telefone VARCHAR(11) CHARACTER SET ascii NOT NULL,
    cep CHAR(8) CHARACTER SET ascii NOT NULL,
    logradouro VARCHAR(120) NOT NULL,
    numero VARCHAR(20) NULL,
    bairro VARCHAR(120) NOT NULL,
    municipio VARCHAR(120) NOT NULL,
    uf CHAR(2) CHARACTER SET ascii NOT NULL,
    complemento VARCHAR(120) NULL,
    conferido_em VARCHAR(35) NULL,
    conferido_por INT UNSIGNED NULL REFERENCES usuarios(id),
    KEY cadastros_pendentes (conferido_em, cliente_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS precos_clientes (
    cliente_id INT UNSIGNED NOT NULL REFERENCES clientes(id),
    apresentacao_id INT UNSIGNED NOT NULL REFERENCES apresentacoes(id),
    preco_centavos INT UNSIGNED NOT NULL CHECK (preco_centavos <= 999999999),
    PRIMARY KEY (cliente_id, apresentacao_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS pedidos (
    numero INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    venda_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    usuario_id INT UNSIGNED NOT NULL REFERENCES usuarios(id),
    responsavel VARCHAR(120) NOT NULL,
    cliente_id INT UNSIGNED NOT NULL REFERENCES clientes(id),
    cliente VARCHAR(120) NOT NULL,
    fechado_em VARCHAR(35) NOT NULL,
    origem ENUM('campo', 'balcao') NOT NULL,
    retirada_imediata BOOLEAN NOT NULL,
    conteudo_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    UNIQUE KEY venda_por_usuario (usuario_id, venda_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS itens_pedido (
    pedido_numero INT UNSIGNED NOT NULL REFERENCES pedidos(numero),
    apresentacao_id INT UNSIGNED NOT NULL REFERENCES apresentacoes(id),
    apresentacao VARCHAR(120) NOT NULL,
    unidade ENUM('pacote', 'caixa', 'kg') NOT NULL,
    quantidade DECIMAL(9,3) NOT NULL CHECK (quantidade > 0),
    preco_unitario_centavos INT UNSIGNED NOT NULL,
    PRIMARY KEY (pedido_numero, apresentacao_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS entradas_estoque (
    numero INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    entrada_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    usuario_id INT UNSIGNED NOT NULL REFERENCES usuarios(id),
    responsavel VARCHAR(120) NOT NULL,
    apresentacao_id INT UNSIGNED NOT NULL REFERENCES apresentacoes(id),
    apresentacao VARCHAR(120) NOT NULL,
    unidade ENUM('pacote', 'caixa', 'kg') NOT NULL,
    recebido_em VARCHAR(35) NOT NULL,
    conteudo_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    UNIQUE KEY entrada_por_usuario (usuario_id, entrada_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS lotes_estoque (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    apresentacao_id INT UNSIGNED NOT NULL REFERENCES apresentacoes(id),
    validade DATE NOT NULL,
    codigo VARCHAR(80) COLLATE utf8mb4_bin NOT NULL,
    saldo DECIMAL(15,3) NOT NULL CHECK (saldo >= 0),
    UNIQUE KEY lote_por_apresentacao (apresentacao_id, validade, codigo)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS itens_entrada_estoque (
    entrada_numero INT UNSIGNED NOT NULL REFERENCES entradas_estoque(numero),
    lote_id INT UNSIGNED NOT NULL REFERENCES lotes_estoque(id),
    quantidade DECIMAL(9,3) NOT NULL CHECK (quantidade > 0),
    PRIMARY KEY (entrada_numero, lote_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS saidas_estoque (
    numero INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    saida_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    pedido_numero INT UNSIGNED NOT NULL REFERENCES pedidos(numero),
    usuario_id INT UNSIGNED NOT NULL REFERENCES usuarios(id),
    responsavel VARCHAR(120) NOT NULL,
    modalidade ENUM('frota_propria', 'transportadora', 'retirada') NOT NULL,
    confirmada_em VARCHAR(35) NOT NULL,
    conteudo_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    UNIQUE KEY saida_por_usuario (usuario_id, saida_id),
    KEY saidas_por_pedido (pedido_numero, numero)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS itens_saida_estoque (
    saida_numero INT UNSIGNED NOT NULL REFERENCES saidas_estoque(numero),
    lote_id INT UNSIGNED NOT NULL REFERENCES lotes_estoque(id),
    quantidade DECIMAL(9,3) NOT NULL CHECK (quantidade > 0),
    PRIMARY KEY (saida_numero, lote_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS recebimentos_remessa (
    numero INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    recebimento_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    saida_numero INT UNSIGNED NOT NULL UNIQUE REFERENCES saidas_estoque(numero),
    usuario_id INT UNSIGNED NOT NULL REFERENCES usuarios(id),
    responsavel VARCHAR(120) NOT NULL,
    confirmado_em VARCHAR(35) NOT NULL,
    conferencia ENUM('sem_ressalvas', 'divergencia_esclarecida') NULL,
    conteudo_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    UNIQUE KEY recebimento_por_usuario (usuario_id, recebimento_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS itens_recebimento_remessa (
    recebimento_numero INT UNSIGNED NOT NULL REFERENCES recebimentos_remessa(numero),
    apresentacao_id INT UNSIGNED NOT NULL REFERENCES apresentacoes(id),
    recebida DECIMAL(9,3) NOT NULL CHECK (recebida >= 0),
    recusada DECIMAL(9,3) NOT NULL CHECK (recusada >= 0),
    motivo VARCHAR(240) NULL,
    repor BOOLEAN NOT NULL,
    subtotal_centavos BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (recebimento_numero, apresentacao_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS devolucoes_remessa (
    numero INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    devolucao_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    recebimento_numero INT UNSIGNED NOT NULL REFERENCES recebimentos_remessa(numero),
    usuario_id INT UNSIGNED NOT NULL REFERENCES usuarios(id),
    responsavel VARCHAR(120) NOT NULL,
    registrada_em VARCHAR(35) NOT NULL,
    origem ENUM('recusa', 'apos_recebimento') NOT NULL,
    conteudo_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    UNIQUE KEY devolucao_por_usuario (usuario_id, devolucao_id),
    KEY devolucoes_por_recebimento (recebimento_numero, numero)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS itens_devolucao_remessa (
    devolucao_numero INT UNSIGNED NOT NULL REFERENCES devolucoes_remessa(numero),
    lote_id INT UNSIGNED NOT NULL REFERENCES lotes_estoque(id),
    apta DECIMAL(9,3) NOT NULL CHECK (apta >= 0),
    descartada DECIMAL(9,3) NOT NULL CHECK (descartada >= 0),
    motivo VARCHAR(240) NULL,
    CHECK (apta + descartada > 0),
    PRIMARY KEY (devolucao_numero, lote_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS cancelamentos_pedido (
    numero INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cancelamento_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    pedido_numero INT UNSIGNED NOT NULL REFERENCES pedidos(numero),
    usuario_id INT UNSIGNED NOT NULL REFERENCES usuarios(id),
    responsavel VARCHAR(120) NOT NULL,
    autorizado_em VARCHAR(35) NOT NULL,
    motivo VARCHAR(240) NOT NULL,
    conteudo_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    UNIQUE KEY cancelamento_por_usuario (usuario_id, cancelamento_id),
    KEY cancelamentos_por_pedido (pedido_numero, numero)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS itens_cancelamento_pedido (
    cancelamento_numero INT UNSIGNED NOT NULL REFERENCES cancelamentos_pedido(numero),
    apresentacao_id INT UNSIGNED NOT NULL REFERENCES apresentacoes(id),
    quantidade DECIMAL(9,3) NOT NULL CHECK (quantidade > 0),
    PRIMARY KEY (cancelamento_numero, apresentacao_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS correcoes_pedido (
    numero INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pedido_numero INT UNSIGNED NOT NULL REFERENCES pedidos(numero),
    correcao_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    conteudo_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    motivo VARCHAR(240) NOT NULL,
    solicitada_em VARCHAR(35) NOT NULL,
    solicitada_por VARCHAR(120) NOT NULL,
    autorizada_em VARCHAR(35) NULL,
    autorizada_por VARCHAR(120) NULL,
    autorizador_id INT UNSIGNED NULL REFERENCES usuarios(id),
    UNIQUE KEY pedido_correcao_id (pedido_numero, correcao_id),
    KEY pedido_correcoes (pedido_numero, numero)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS itens_correcao_pedido (
    correcao_numero INT UNSIGNED NOT NULL REFERENCES correcoes_pedido(numero),
    apresentacao_id INT UNSIGNED NOT NULL REFERENCES apresentacoes(id),
    quantidade_anterior DECIMAL(9,3) NOT NULL CHECK (quantidade_anterior > 0),
    quantidade_proposta DECIMAL(9,3) NOT NULL CHECK (quantidade_proposta > 0),
    preco_anterior INT UNSIGNED NOT NULL CHECK (preco_anterior <= 999999999),
    preco_proposto INT UNSIGNED NOT NULL CHECK (preco_proposto <= 999999999),
    PRIMARY KEY (correcao_numero, apresentacao_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export async function initDb(db: Pool): Promise<void> {
  for (const table of tables) await db.query(table);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  try {
    await initDb(db);
  } finally {
    await db.end();
  }
}
