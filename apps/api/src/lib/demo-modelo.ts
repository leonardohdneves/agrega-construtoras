// Concreteira Modelo: empresa fictícia do ambiente de teste, usada em demonstrações para clientes.
// Seis betoneiras e duas bombas, com seis meses de histórico coerente entre frota, notas e financeiro.
// Tudo é gerado a partir da data de hoje com um sorteio de semente fixa: o mesmo dia gera os mesmos dados.
import type pg from 'pg';
import { somarDias, somarMeses } from './financeiro.ts';
import { normalizar } from './sugestoes.ts';
import { registrarEntradasNota, saldosEm } from './estoque.ts';
import { gerarContasAPagar } from '../rotas/contratos.ts';
import { criarNotaLida } from '../rotas/notas.ts';
import { gerarDanfeExemplo } from './pdf-exemplo.ts';
import { lerPdf } from './pdf.ts';
import { interpretarNotaPdf } from './nota-pdf.ts';

type C = pg.PoolClient;

/** Mude este valor para o ambiente de teste apagar e recriar a demonstração na próxima inicialização. */
export const VERSAO_DEMO = 'modelo-2026-10-v12';

// ---------------------------------------------------------------- datas e números
const diaSemana = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
/** Próximo dia útil (segunda a sexta) a partir de `d`, inclusive. */
export const util = (d: string) => {
  let x = d;
  while (diaSemana(x) === 0 || diaSemana(x) === 6) x = somarDias(x, 1);
  return x;
};
const inicioMes = (d: string) => `${d.slice(0, 7)}-01`;
const fimMes = (d: string) => somarDias(somarMeses(inicioMes(d), 1), -1);
/** Último dia útil do mês de `d`. */
const ultimoUtil = (d: string) => {
  let x = fimMes(d);
  while (diaSemana(x) === 0 || diaSemana(x) === 6) x = somarDias(x, -1);
  return x;
};
const diaDoMes = (mes: string, dia: number) => `${mes.slice(0, 7)}-${String(dia).padStart(2, '0')}`;

function sorteio(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** CNPJ com dígitos verificadores corretos a partir da raiz de 8 dígitos (filial 0001). */
export function cnpjDe(raiz: string): string {
  const base = `${raiz.padStart(8, '0').slice(0, 8)}0001`;
  const dv = (s: string, pesos: number[]) => {
    const r = s.split('').reduce((t, d, i) => t + Number(d) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}

/** Chave de acesso de NF-e (44 dígitos) com dígito verificador. */
export function chaveNfe(emissao: string, cnpjEmitente: string, numero: number, codigo: number): string {
  const base = `17${emissao.slice(2, 4)}${emissao.slice(5, 7)}${cnpjEmitente}55001${String(numero).padStart(9, '0')}1${String(codigo).padStart(8, '0')}`;
  let peso = 2;
  let soma = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return `${base}${r < 2 ? 0 : 11 - r}`;
}

/** Divide `total` (centavos) proporcionalmente aos pesos, sem perder centavos. */
function dividir(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((a, b) => a + b, 0) || 1;
  const partes = pesos.map((p) => Math.floor((total * p) / soma));
  let resto = total - partes.reduce((a, b) => a + b, 0);
  for (let i = 0; resto > 0; i = (i + 1) % partes.length, resto--) partes[i]++;
  return partes;
}

// ---------------------------------------------------------------- dados fixos
export const RAIZ_POSTO = '27416593';
export const NOME_POSTO = 'Posto Rodoviário Capital Ltda';

const FROTA = [
  { codigo: 'BET-01', tipo: 'betoneira', placa: 'QKD1A23', modelo: 'Caminhão 6x4 · balão 8 m³', ano: 2019, kml: 2.22, km: 118400 },
  { codigo: 'BET-02', tipo: 'betoneira', placa: 'QKD2B34', modelo: 'Caminhão 6x4 · balão 8 m³', ano: 2018, kml: 2.15, km: 146900 },
  { codigo: 'BET-03', tipo: 'betoneira', placa: 'QKD3C45', modelo: 'Caminhão 6x4 · balão 8 m³', ano: 2020, kml: 2.2, km: 97200 },
  { codigo: 'BET-04', tipo: 'betoneira', placa: 'QKD4D56', modelo: 'Caminhão 6x4 · balão 8 m³', ano: 2016, kml: 2.05, km: 211300 },
  { codigo: 'BET-05', tipo: 'betoneira', placa: 'QKE5E67', modelo: 'Caminhão 8x4 · balão 10 m³', ano: 2023, kml: 2.3, km: 41200 },
  { codigo: 'BET-06', tipo: 'betoneira', placa: 'QKE6F78', modelo: 'Caminhão 8x4 · balão 10 m³', ano: 2023, kml: 2.28, km: 38900 },
  { codigo: 'BOM-01', tipo: 'bomba_lanca', placa: 'QKF7G89', modelo: 'Caminhão com bomba lança 36 m', ano: 2021, kml: 0, km: 52400, horas: 3100, lanca: 36 },
  { codigo: 'BOM-02', tipo: 'bomba_lanca', placa: 'QKF8H90', modelo: 'Caminhão com bomba lança 42 m', ano: 2019, kml: 0, km: 71800, horas: 4650, lanca: 42 },
] as const;

const EQUIPE: [nome: string, funcao: string, veiculo: string | null, cnh: string, diasCnh: number][] = [
  ['Carlos Pereira', 'motorista', 'BET-01', 'E', 410],
  ['João Batista Lima', 'motorista', 'BET-02', 'E', 190],
  ['Marcos Antônio Souza', 'motorista', 'BET-03', 'E', 12],
  ['Rafael Gomes', 'motorista', 'BET-04', 'E', 620],
  ['Edson Rodrigues', 'motorista', 'BET-05', 'E', 280],
  ['Luiz Fernando Alves', 'motorista', 'BET-06', 'E', 95],
  ['Wellington Costa', 'motorista_operador', 'BOM-01', 'E', 330],
  ['Diego Martins', 'motorista_operador', 'BOM-02', 'E', 48],
  ['Valdir Santos', 'motorista', null, 'E', 700],
];

const COLABORADORES: [nome: string, funcao: string, cargo: string][] = [
  ['Sérgio Nunes', 'operador_usina', 'Operador da central dosadora'],
  ['Fábio Ramos', 'laboratorista', 'Laboratorista'],
  ['Paulo Henrique Dias', 'mecanico', 'Mecânico'],
  ['Rita de Cássia Moura', 'administrativo', 'Assistente financeiro'],
  ['André Luiz Barros', 'vendedor', 'Vendedor externo'],
  ['Antônio Batista', 'gestor_patio', 'Gestor de pátio'],
];

// chave, categoria, razão social, nome fantasia, ramo, raiz do CNPJ, conta padrão
const FORNECEDORES: [string, 'fornecedor' | 'credor', string, string, string, string, string | null][] = [
  ['cimento', 'fornecedor', 'Cimentos do Cerrado S.A.', 'Cimentos do Cerrado', 'Cimento', '31845207', '3.1'],
  ['brita', 'fornecedor', 'Mineração Pedra Azul Ltda', 'Pedreira Pedra Azul', 'Brita', '18530462', '3.3'],
  ['areia', 'fornecedor', 'Areial Rio Tocantins Ltda', 'Areial Rio Tocantins', 'Areia', '22975318', '3.2'],
  ['aditivo', 'fornecedor', 'Construquímica Aditivos Ltda', 'Construquímica', 'Aditivos para concreto', '40618273', '3.4'],
  ['posto', 'fornecedor', NOME_POSTO, 'Posto Capital', 'Combustível', RAIZ_POSTO, '4.1'],
  ['oficina', 'fornecedor', 'Diesel Center Oficina Mecânica Ltda', 'Diesel Center', 'Oficina mecânica', '35702984', '4.2'],
  ['pneus', 'fornecedor', 'Pneus Norte Comércio Ltda', 'Pneus Norte', 'Pneus', '29163847', '4.3'],
  ['pecas', 'fornecedor', 'Lubrificantes Tocantins Ltda', 'Lubri Tocantins', 'Óleo e graxa', '13579246', '4.4'],
  ['laboratorio', 'fornecedor', 'Laboratório Ensaios Tecnológicos Ltda', 'LabEnsaios', 'Ensaios de concreto', '24680135', '3.7'],
  ['energia', 'credor', 'Distribuidora de Energia do Tocantins (fictícia)', 'Energia', 'Energia elétrica', '36925814', null],
  ['banco', 'credor', 'Banco Modelo S.A.', 'Banco Modelo · financiamento', 'Financiamento de veículos', '00360305', null],
  ['imobiliaria', 'credor', 'Imobiliária Terra Firme Ltda', 'Terra Firme', 'Aluguel do terreno da usina', '41237659', '6.1'],
  ['contabil', 'credor', 'Exatus Contabilidade Ltda', 'Exatus Contabilidade', 'Contabilidade', '19283746', '6.3'],
  ['seguradora', 'credor', 'Proteção Total Seguros S.A.', 'Proteção Total Seguros', 'Seguro da frota', '28374651', '4.6'],
  ['software', 'credor', 'Nuvem Sistemas Ltda', 'Nuvem Sistemas', 'Sistemas e software', '37465128', '6.4'],
];

// Clientes PJ: participação no volume, preço por m³, concreto, fração bombeada e comportamento de pagamento (dias de atraso).
const CLIENTES_PJ = [
  { nome: 'Construtora Alvorada Ltda', fantasia: 'Construtora Alvorada', raiz: '15926348', parte: 0.24, preco: 465, fck: 'fck 30', bomba: 0.6, atraso: [0, 1] },
  { nome: 'Incorporadora Vale Verde Ltda', fantasia: 'Vale Verde Incorporadora', raiz: '26037159', parte: 0.2, preco: 458, fck: 'fck 25', bomba: 0.5, atraso: [0, 1] },
  { nome: 'Engenharia Pilar Forte Ltda', fantasia: 'Pilar Forte Engenharia', raiz: '37148260', parte: 0.14, preco: 472, fck: 'fck 35', bomba: 0.7, atraso: [12, 19] },
  { nome: 'Residencial Jardim das Palmeiras SPE Ltda', fantasia: 'Jardim das Palmeiras', raiz: '48259371', parte: 0.13, preco: 455, fck: 'fck 25', bomba: 0.3, atraso: [0, 2] },
  { nome: 'Pavimentadora Rota Norte Ltda', fantasia: 'Rota Norte Pavimentação', raiz: '59360482', parte: 0.1, preco: 440, fck: 'fck 20', bomba: 0, atraso: [0, 1] },
  { nome: 'Construtora Novo Lar Ltda', fantasia: 'Construtora Novo Lar', raiz: '60471593', parte: 0.09, preco: 460, fck: 'fck 25', bomba: 0.4, atraso: [2, 6] },
] as const;
const CLIENTES_PF = ['José Carlos Moreira', 'Ana Paula Ribeiro', 'Francisco das Chagas Silva', 'Maria do Socorro Lima'];

type ServicoOs = { tipo: 'preventiva' | 'corretiva'; desc: string; itens: [string, string, number, number][]; plano?: string };
const SERV_BET: ServicoOs[] = [
  { tipo: 'preventiva', desc: 'Troca de óleo do motor e filtros', plano: 'Troca de óleo do motor e filtro de óleo',
    itens: [['peca', 'Óleo de motor 15W40 (L)', 32, 29.9], ['peca', 'Filtro de óleo', 2, 98], ['peca', 'Filtro de combustível', 2, 135], ['mao_de_obra', 'Troca de óleo e filtros', 1, 280]] },
  { tipo: 'preventiva', desc: 'Revisão de freios', plano: 'Revisão de freios',
    itens: [['peca', 'Lona de freio (jogo)', 4, 290], ['peca', 'Tambor de freio', 1, 780], ['mao_de_obra', 'Revisão de freios', 1, 650]] },
  { tipo: 'corretiva', desc: 'Vazamento no redutor do balão',
    itens: [['peca', 'Retentor do redutor', 2, 390], ['peca', 'Óleo do redutor (L)', 20, 38], ['mao_de_obra', 'Desmontagem e montagem do redutor', 1, 850]] },
  { tipo: 'corretiva', desc: 'Troca do kit de embreagem', itens: [['peca', 'Kit de embreagem', 1, 4300], ['mao_de_obra', 'Troca da embreagem', 1, 1200]] },
  { tipo: 'corretiva', desc: 'Alternador sem carga', itens: [['peca', 'Alternador recondicionado', 1, 1850], ['mao_de_obra', 'Diagnóstico e troca do alternador', 1, 350]] },
  { tipo: 'corretiva', desc: 'Vazamento na mangueira hidráulica do balão', itens: [['peca', 'Mangueira hidráulica', 2, 265], ['mao_de_obra', 'Substituição das mangueiras', 1, 240]] },
];
const SERV_BOM: ServicoOs[] = [
  { tipo: 'preventiva', desc: 'Troca de óleo hidráulico e filtros da bomba', plano: 'Óleo hidráulico e filtros da bomba',
    itens: [['peca', 'Óleo hidráulico (L)', 180, 24.5], ['peca', 'Filtro hidráulico', 2, 310], ['mao_de_obra', 'Troca do óleo hidráulico', 1, 600]] },
  { tipo: 'corretiva', desc: 'Troca de mangote de 4"', itens: [['peca', 'Mangote 4" × 3 m', 1, 1480], ['mao_de_obra', 'Substituição do mangote', 1, 220]] },
  { tipo: 'corretiva', desc: 'Troca de pistões e camisas de concreto', plano: 'Pistões e camisas de concreto',
    itens: [['peca', 'Jogo de pistões de concreto', 1, 3900], ['peca', 'Camisa de concreto', 2, 2450], ['mao_de_obra', 'Montagem de pistões e camisas', 1, 1500]] },
  { tipo: 'preventiva', desc: 'Troca de óleo do motor e filtros', plano: 'Troca de óleo do motor e filtro de óleo',
    itens: [['peca', 'Óleo de motor 15W40 (L)', 28, 29.9], ['peca', 'Filtro de óleo', 2, 98], ['mao_de_obra', 'Troca de óleo e filtros', 1, 260]] },
];

// ---------------------------------------------------------------- limpeza

/** Apaga todos os dados de uma empresa, mantendo a empresa e os usuários. */
export async function limparEmpresa(c: C, empresaId: string): Promise<void> {
  await c.query('UPDATE usuarios SET motorista_id = NULL WHERE empresa_id = $1', [empresaId]);
  await c.query('UPDATE notas_fiscais SET lancamento_id = NULL, pedido_id = NULL WHERE empresa_id = $1', [empresaId]);
  await c.query('UPDATE lancamentos SET nota_id = NULL, recorrencia_pai_id = NULL WHERE empresa_id = $1', [empresaId]);
  await c.query('UPDATE notas_itens SET catalogo_id = NULL WHERE empresa_id = $1', [empresaId]);
  for (const t of [
    'catalogo_produtos', 'autorizacoes_pagamento', 'medicoes_itens', 'medicoes', 'contratos_itens', 'contratos', 'pedidos_itens', 'pedidos_compra', 'cotacoes_precos', 'cotacoes_itens', 'cotacoes_fornecedores', 'cotacoes', 'solicitacoes_itens', 'solicitacoes_compra', 'catalogo_itens',
    'extrato_linhas', 'extratos_ofx', 'escalas', 'corpos_prova', 'amostras', 'ensaios_insumos', 'equipamentos', 'qualidade_config', 'estoque_movimentos', 'inventarios_itens', 'inventarios', 'cargas_consumo', 'cargas', 'propostas', 'vendas_adicionais', 'vendas', 'regras_producao', 'avisos', 'insumos_produtos',
    'tracos_itens', 'tracos', 'valores_producao', 'anexos', 'abastecimentos', 'os_itens', 'apropriacoes', 'revisoes_veiculo', 'ordens_servico', 'parcelas',
    'transferencias', 'notas_duplicatas', 'notas_itens', 'insumos', 'regras_apropriacao', 'notas_fiscais', 'lancamentos', 'documentos_veiculo',
    'planos_manutencao', 'contas_financeiras', 'clientes', 'fornecedores', 'plano_contas', 'centros_custo', 'motoristas', 'veiculos', 'auditoria',
  ]) {
    await c.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresaId]);
  }
}

// ---------------------------------------------------------------- criação

export async function popularDemo(c: C, e: string, hoje: string): Promise<void> {
  const r = sorteio(20261002);
  const entre = (a: number, b: number) => a + (b - a) * r();
  const cents = (reais: number) => Math.round(reais * 100);
  const inicio = somarMeses(inicioMes(hoje), -6);
  const ontem = somarDias(hoje, -1);
  const q = (sql: string, p: unknown[] = []) => c.query(sql, p);
  const um = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows[0];

  // ----- empresa e usuários
  await q(
    `UPDATE empresas SET razao_social = 'Concreteira Modelo Ltda', nome_fantasia = 'Concreteira Modelo', regime_tributario = 'presumido',
            aliquotas_dre = $2, telefone = '(63) 3214-5500', email = 'contato@concreteiramodelo.test', cidade = 'Palmas', uf = 'TO',
            plano = 'demonstracao', atualizado_em = now() WHERE id = $1`,
    [e, JSON.stringify({ pis: 0.65, cofins: 3, iss: 3, irpj: 1.2, csll: 1.08 })],
  );
  const usuarios = (await q('SELECT id, email FROM usuarios WHERE empresa_id = $1', [e])).rows as { id: string; email: string }[];
  const usuario = (p: string) => usuarios.find((u) => u.email.startsWith(p))?.id ?? null;
  const gestor = usuario('gestor@') ?? usuario('dono@');
  for (const [p, nome] of [['dono@', 'Roberto Almeida'], ['gestor@', 'Juliana Freitas'], ['motorista@', 'Carlos Pereira'], ['operador@', 'Sérgio Nunes'], ['laboratorio@', 'Fábio Ramos'],
    ['financeiro@', 'Rita de Cássia Moura'], ['administrativo@', 'Paulo Henrique Souza'], ['vendedor@', 'André Luiz Barros']]) {
    await q('UPDATE usuarios SET nome = $3 WHERE empresa_id = $1 AND email LIKE $2', [e, `${p}%`, nome]);
  }
  // Acessos de exemplo: a gestora é administradora; o dono é sempre administrador.
  await q(`UPDATE usuarios SET administrador = (perfil = 'dono' OR email LIKE 'gestor@%'), modulos = NULL WHERE empresa_id = $1`, [e]);

  // ----- plano de contas e centros de custo
  const { aplicarPlanoPadrao } = await import('../rotas/financeiro.ts');
  await aplicarPlanoPadrao(c, e);
  const mapa = async (sql: string) => Object.fromEntries((await q(sql, [e])).rows.map((x) => [x.k, x.id])) as Record<string, string>;
  const plano = await mapa('SELECT codigo AS k, id FROM plano_contas WHERE empresa_id = $1');
  const centro = await mapa('SELECT nome AS k, id FROM centros_custo WHERE empresa_id = $1');

  // ----- veículos
  const veic: Record<string, string> = {};
  for (const v of FROTA) {
    const x = await um(
      `INSERT INTO veiculos (empresa_id, codigo, tipo, placa, marca_modelo, ano, capacidade_m3, alcance_lanca_m, km_atual, horimetro_atual, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'disponivel') RETURNING id`,
      [e, v.codigo, v.tipo, v.placa, v.modelo, v.ano, v.tipo === 'betoneira' ? (v.codigo >= 'BET-05' ? 10 : 8) : null, 'lanca' in v ? v.lanca : null, v.km, 'horas' in v ? v.horas : Math.round(v.km / 26)],
    );
    veic[v.codigo] = x.id;
  }
  const codigos = FROTA.map((v) => v.codigo);

  // ----- documentos dos veículos
  for (const [i, v] of FROTA.entries()) {
    await q(`INSERT INTO documentos_veiculo (empresa_id, veiculo_id, tipo, numero, vencimento, valor_centavos) VALUES ($1,$2,'licenciamento',$3,$4,$5)`, [
      e, veic[v.codigo], `2026${v.placa}`, v.codigo === 'BET-04' ? somarDias(hoje, -4) : somarDias(hoje, 40 + i * 31), 19866,
    ]);
    await q(`INSERT INTO documentos_veiculo (empresa_id, veiculo_id, tipo, descricao, numero, vencimento, valor_centavos) VALUES ($1,$2,'seguro','Apólice da frota','PT-77.410.226',$3,$4)`, [
      e, veic[v.codigo], somarDias(hoje, 143), 660000,
    ]);
    await q(`INSERT INTO documentos_veiculo (empresa_id, veiculo_id, tipo, descricao, vencimento, valor_centavos) VALUES ($1,$2,'tacografo','Aferição do tacógrafo',$3,$4)`, [
      e, veic[v.codigo], v.codigo === 'BET-02' ? somarDias(hoje, 9) : somarDias(hoje, 180 + i * 23), 28000,
    ]);
  }

  // ----- equipe
  const motoristaDo: Record<string, string> = {};
  const motoristas: string[] = [];
  for (const [nome, funcao, v, cat, dias] of EQUIPE) {
    const m = await um(
      `INSERT INTO motoristas (empresa_id, nome, funcao, cargo, cnh_categoria, cnh_vencimento, data_admissao) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [e, nome, funcao, funcao === 'motorista' ? 'Motorista de betoneira' : 'Motorista operador de bomba', cat, somarDias(hoje, dias), somarDias(hoje, -Math.round(entre(300, 2400)))],
    );
    motoristas.push(m.id);
    if (v) motoristaDo[v] = m.id;
    if (nome === 'Carlos Pereira') await q(`UPDATE usuarios SET motorista_id = $1 WHERE empresa_id = $2 AND email LIKE 'motorista@%'`, [m.id, e]);
  }
  for (const [nome, funcao, cargo] of COLABORADORES) {
    await q(`INSERT INTO motoristas (empresa_id, nome, funcao, cargo, data_admissao) VALUES ($1,$2,$3,$4,$5)`, [e, nome, funcao, cargo, somarDias(hoje, -Math.round(entre(200, 1800)))]);
  }
  const usuarioMotorista = usuario('motorista@');

  // ----- fornecedores e clientes
  const forn: Record<string, string> = {};
  const cnpjForn: Record<string, string> = {};
  for (const [k, cat, razao, fantasia, ramo, raiz, conta] of FORNECEDORES) {
    cnpjForn[k] = cnpjDe(raiz);
    const x = await um(
      `INSERT INTO fornecedores (empresa_id, categoria, tipo_pessoa, cnpj_cpf, razao_social, nome_fantasia, ramo, cidade, uf, categoria_padrao_id)
       VALUES ($1,$2,'PJ',$3,$4,$5,$6,'Palmas','TO',$7) RETURNING id`,
      [e, cat, cnpjForn[k], razao, fantasia, ramo, conta ? plano[conta] : null],
    );
    forn[k] = x.id;
  }
  const cli: Record<string, string> = {};
  for (const x of CLIENTES_PJ) {
    cli[x.nome] = (
      await um(
        `INSERT INTO clientes (empresa_id, tipo_pessoa, cnpj_cpf, razao_social, nome_fantasia, ramo, cidade, uf) VALUES ($1,'PJ',$2,$3,$4,$5,'Palmas','TO') RETURNING id`,
        [e, cnpjDe(x.raiz), x.nome, x.fantasia, x.nome.includes('Pavimenta') ? 'Pavimentação' : 'Construção civil'],
      )
    ).id;
  }
  for (const nome of CLIENTES_PF) {
    cli[nome] = (await um(`INSERT INTO clientes (empresa_id, tipo_pessoa, razao_social, ramo, cidade, uf) VALUES ($1,'PF',$2,'Obra residencial','Palmas','TO') RETURNING id`, [e, nome])).id;
  }

  // ----- contas financeiras
  const dataSaldo = somarDias(inicio, -1);
  const conta = async (nome: string, tipo: string, banco: string | null, ag: string | null, cc: string | null, saldo: number) =>
    (
      await um(
        `INSERT INTO contas_financeiras (empresa_id, nome, tipo, banco, agencia, conta, saldo_inicial_centavos, data_saldo_inicial) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [e, nome, tipo, banco, ag, cc, cents(saldo), dataSaldo],
      )
    ).id as string;
  const banco = await conta('Banco Modelo · conta corrente', 'banco', 'Banco Modelo', '0001', '12345-6', 0);
  const aplicacao = await conta('Banco Modelo · aplicação', 'aplicacao', 'Banco Modelo', '0001', '12345-6', 280000);
  const caixa = await conta('Caixa da usina', 'caixa', null, null, null, 2500);

  // ----- ajudantes de lançamento
  type Ap = { codigo: string; valor: number; centro?: string; veiculo?: string | null; notaItemId?: string; descricao?: string };
  type Pago = { data: string; conta: string; forma: string; juros?: number };
  type Pa = { venc: string; valor: number; pago?: Pago | null };
  const lanc = async (
    tipo: 'receita' | 'despesa',
    competencia: string,
    descricao: string,
    o: { documento?: string; cliente?: string; fornecedor?: string; origem?: string; notaId?: string; recorrencia?: string; paiId?: string; ordem?: number },
    aps: Ap[],
    pas: Pa[],
  ) => {
    const total = aps.reduce((s, a) => s + a.valor, 0);
    const somaParcelas = pas.reduce((s, p) => s + p.valor, 0);
    if (somaParcelas !== total) pas[pas.length - 1].valor += total - somaParcelas;
    const l = await um(
      `INSERT INTO lancamentos (empresa_id, tipo, competencia, descricao, documento, valor_total_centavos, cliente_id, fornecedor_id, nota_id, origem, status,
                                recorrencia, recorrencia_pai_id, recorrencia_ordem, criado_por_id, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmado',$11,$12,$13,$14, $3::date + time '09:00')
       RETURNING id`,
      [e, tipo, competencia, descricao.slice(0, 200), o.documento ?? null, total, o.cliente ? cli[o.cliente] : null, o.fornecedor ? forn[o.fornecedor] : null,
        o.notaId ?? null, o.origem ?? 'manual', o.recorrencia ?? 'nenhuma', o.paiId ?? null, o.ordem ?? null, gestor],
    );
    if (o.recorrencia && !o.paiId) await q('UPDATE lancamentos SET recorrencia_pai_id = id WHERE id = $1', [l.id]);
    for (const a of aps) {
      if (a.valor <= 0) continue;
      await q(
        `INSERT INTO apropriacoes (empresa_id, lancamento_id, plano_conta_id, centro_custo_id, veiculo_id, descricao, valor_centavos, nota_item_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [e, l.id, plano[a.codigo], a.centro ? centro[a.centro] : null, a.veiculo ? veic[a.veiculo] : null, a.descricao ?? null, a.valor, a.notaItemId ?? null],
      );
    }
    for (const [i, p] of pas.entries()) {
      const pg_ = p.pago && p.pago.data <= hoje ? p.pago : null;
      const juros = pg_?.juros ?? 0;
      await q(
        `INSERT INTO parcelas (empresa_id, lancamento_id, numero, vencimento, valor_centavos, status, data_pagamento, juros_centavos, valor_pago_centavos,
                               conta_financeira_id, forma_pagamento, baixado_por_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [e, l.id, i + 1, p.venc, p.valor, pg_ ? 'paga' : 'aberta', pg_?.data ?? null, juros, pg_ ? p.valor + juros : null, pg_?.conta ?? null, pg_?.forma ?? null, pg_ ? gestor : null],
      );
    }
    return l.id as string;
  };
  /** Despesa paga no vencimento se ele já passou (até ontem). */
  const pagarDesp = (venc: string, forma = 'boleto', contaId = banco): Pago | null => (venc <= ontem ? { data: venc, conta: contaId, forma } : null);

  // ----- notas de compra (confirmadas, com lançamento ligado)
  type ItemNota = { desc: string; ncm: string; cfop: string; un: string; qtd: number; valor: number; codigo: string; centro: string; veiculo?: string | null;
    abastecimentos?: { id: string; veiculo: string; valor: number }[]; osItens?: string[]; insumoId?: string; fator?: number };
  const numeros: Record<string, number> = { cimento: 48120, brita: 9310, areia: 2205, aditivo: 731, posto: 18230, oficina: 4410, pneus: 15520, pecas: 3380 };
  let codigoNota = 31000017;
  const notaCompra = async (k: string, emissao: string, itens: ItemNota[], dups: { venc: string; valor: number }[], forma = 'boleto', status = 'confirmada') => {
    numeros[k]++;
    const total = itens.reduce((s, i) => s + i.valor, 0);
    const soma = dups.reduce((s, d) => s + d.valor, 0);
    if (soma !== total) dups[dups.length - 1].valor += total - soma;
    const fornecedor = FORNECEDORES.find((f) => f[0] === k)!;
    const n = await um(
      `INSERT INTO notas_fiscais (empresa_id, direcao, modelo, chave_acesso, numero, serie, data_emissao, competencia, fornecedor_id, emitente_nome, emitente_documento,
                                  natureza_operacao, valor_produtos_centavos, total_centavos, forma_pagamento, avisos, origem, status, criado_por_id, conferido_por_id, conferido_em, criado_em)
       VALUES ($1,'entrada','nfe',$2,$3,'1',$4,$4,$5,$6,$7,'VENDA DE MERCADORIA',$8,$8,$9,'[]','manual',$10,$11,$12,$13,$4::date + time '10:00') RETURNING id`,
      [e, chaveNfe(emissao, cnpjForn[k], numeros[k], codigoNota++), String(numeros[k]), emissao, forn[k], fornecedor[2].toUpperCase(), cnpjForn[k], total, forma, status, gestor,
        status === 'confirmada' ? gestor : null, status === 'confirmada' ? `${emissao} 11:00` : null],
    );
    const itemIds: string[] = [];
    for (const [j, i] of itens.entries()) {
      const it = await um(
        `INSERT INTO notas_itens (empresa_id, nota_id, numero_item, codigo_produto, descricao, ncm, cfop, unidade, quantidade, valor_produto_centavos, valor_custo_centavos,
                                  plano_conta_id, centro_custo_id, veiculo_id, sugestao, insumo_id, fator_estoque)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,'regra',$14,$15) RETURNING id`,
        [e, n.id, j + 1, String(100 + j), i.desc, i.ncm, i.cfop, i.un, i.qtd, i.valor, plano[i.codigo], centro[i.centro], i.veiculo ? veic[i.veiculo] : null,
          i.insumoId ?? null, i.insumoId ? i.fator ?? 1 : null],
      );
      itemIds.push(it.id);
      if (i.abastecimentos?.length) await q('UPDATE abastecimentos SET nota_item_id = $1 WHERE id = ANY($2::uuid[])', [it.id, i.abastecimentos.map((a) => a.id)]);
      if (i.osItens?.length) await q('UPDATE os_itens SET nota_item_id = $1 WHERE id = ANY($2::uuid[])', [it.id, i.osItens]);
    }
    for (const [j, d] of dups.entries()) {
      await q('INSERT INTO notas_duplicatas (empresa_id, nota_id, numero, vencimento, valor_centavos) VALUES ($1,$2,$3,$4,$5)', [e, n.id, String(j + 1).padStart(3, '0'), d.venc, d.valor]);
    }
    if (status !== 'confirmada') return n.id as string;
    const aps: Ap[] = [];
    for (const [j, i] of itens.entries()) {
      if (i.abastecimentos?.length) {
        const porVeiculo = new Map<string, number>();
        for (const a of i.abastecimentos) porVeiculo.set(a.veiculo, (porVeiculo.get(a.veiculo) ?? 0) + a.valor);
        const vs = [...porVeiculo.keys()].sort();
        const partes = dividir(i.valor, vs.map((v) => porVeiculo.get(v)!));
        vs.forEach((v, x) => aps.push({ codigo: i.codigo, valor: partes[x], centro: i.centro, veiculo: v, notaItemId: itemIds[j], descricao: `${i.desc} (rateado pelos abastecimentos)` }));
      } else aps.push({ codigo: i.codigo, valor: i.valor, centro: i.centro, veiculo: i.veiculo ?? null, notaItemId: itemIds[j], descricao: i.desc });
    }
    const principal = [...itens].sort((a, b) => b.valor - a.valor)[0];
    const l = await lanc('despesa', emissao, `${fornecedor[3]} · ${principal.desc}${itens.length > 1 ? ` e mais ${itens.length - 1}` : ''}`,
      { documento: `NF-e ${numeros[k]}/1`, fornecedor: k, origem: 'manual', notaId: n.id }, aps,
      dups.map((d) => ({ venc: d.venc, valor: d.valor, pago: pagarDesp(d.venc, forma) })));
    await q('UPDATE notas_fiscais SET lancamento_id = $2 WHERE id = $1', [n.id, l]);
    if (itens.some((i) => i.insumoId)) await registrarEntradasNota(c, e, n.id, gestor);
    return n.id as string;
  };

  // ----- simulação da frota: quilometragem diária e abastecimentos
  const kmNoDia: Record<string, Record<string, { km: number; hor: number }>> = {};
  const ultimo: Record<string, { km: number; hor: number }> = {};
  type Abast = { id?: string; veiculo: string; data: string; hora: string; litros: number; valor: number; km: number; hor: number; motorista: string | null };
  const abastecimentos: Abast[] = [];
  const dias: string[] = [];
  for (let d = inicio; d <= hoje; d = somarDias(d, 1)) dias.push(d);
  const totalDias = dias.length;
  const precoDiesel = (d: string) => Math.round((6.04 + (0.24 * dias.indexOf(d)) / totalDias + entre(-0.02, 0.02)) * 100) / 100;
  for (const v of FROTA) {
    const bomba = v.tipo !== 'betoneira';
    let km = v.km - (bomba ? 6000 : 26000);
    let hor = ('horas' in v ? v.horas : Math.round(v.km / 26)) - (bomba ? 820 : 1000);
    let acKm = 0;
    let acH = 0;
    kmNoDia[v.codigo] = {};
    for (const d of dias) {
      const w = diaSemana(d);
      const naOficina = v.codigo === 'BET-04' && d >= somarDias(hoje, -2);
      if (w !== 0 && !naOficina && !(d === hoje)) {
        if (bomba) {
          if (w !== 6 && r() > 0.22) {
            const k = entre(18, 55);
            const h = entre(5, 9);
            km += k; hor += h; acKm += k; acH += h;
          }
        } else if (r() > 0.05) {
          const k = w === 6 ? entre(45, 80) : entre(88, 128);
          km += k; hor += k / entre(24, 28); acKm += k; acH += k / 26;
        }
      }
      kmNoDia[v.codigo][d] = { km: Math.round(km), hor: Math.round(hor * 10) / 10 };
      const limite = bomba ? acH >= 21 * entre(0.9, 1.15) : acKm >= 380 * entre(0.9, 1.15);
      if (limite && d < hoje) {
        const ruim = v.codigo === 'BET-03' && d >= somarDias(hoje, -7);
        const litros = Math.round((bomba ? acH * entre(6.3, 6.9) : acKm / (ruim ? 1.78 : v.kml * entre(0.96, 1.04))) * 10) / 10;
        const preco = precoDiesel(d);
        const motorista = r() < 0.08 ? motoristas[8] : motoristaDo[v.codigo] ?? null;
        const hh = 17 + Math.floor(r() * 2);
        const mm = String(Math.floor(r() * 60)).padStart(2, '0');
        abastecimentos.push({ veiculo: v.codigo, data: d, hora: `${hh}:${mm}`, litros, valor: cents(litros * preco), km: Math.round(km), hor: Math.round(hor * 10) / 10, motorista });
        acKm = 0;
        acH = 0;
      }
    }
    ultimo[v.codigo] = { km: Math.round(km), hor: Math.round(hor * 10) / 10 };
  }
  abastecimentos.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  for (const a of abastecimentos) {
    const x = await um(
      `INSERT INTO abastecimentos (empresa_id, veiculo_id, motorista_id, registrado_por_id, data_hora, litros, valor_total_centavos, km, horimetro, origem, posto, tanque_cheio, fornecedor_id, criado_em)
       VALUES ($1,$2,$3,$4,($5::text || ' ' || $6::text || ':00-03')::timestamptz,$7,$8,$9,$10,'posto','Posto Capital',true,$11,($5::text || ' ' || $6::text || ':00-03')::timestamptz) RETURNING id`,
      [e, veic[a.veiculo], a.motorista, a.veiculo === 'BET-01' ? usuarioMotorista : null, a.data, a.hora, a.litros, a.valor, a.km, a.hor, forn.posto],
    );
    a.id = x.id;
  }
  for (const v of FROTA) {
    await q('UPDATE veiculos SET km_atual = $2, horimetro_atual = $3 WHERE id = $1', [veic[v.codigo], ultimo[v.codigo].km, ultimo[v.codigo].hor]);
  }
  await q(`UPDATE veiculos SET status = 'manutencao' WHERE id = $1`, [veic['BET-04']]);

  // Notas do posto por quinzena; a da última quinzena fechada ainda não chegou (é a do arquivo de demonstração).
  const quinzenas: [string, string][] = [];
  for (let m = inicio; m <= hoje; m = somarMeses(m, 1)) {
    quinzenas.push([m, diaDoMes(m, 15)], [diaDoMes(m, 16), fimMes(m)]);
  }
  for (const [de, ate] of quinzenas) {
    const emissao = ate;
    if (somarDias(ate, 1) > somarDias(hoje, -3)) continue;
    const doPeriodo = abastecimentos.filter((a) => a.data >= de && a.data <= ate);
    if (!doPeriodo.length) continue;
    const litros = Math.round(doPeriodo.reduce((s, a) => s + a.litros, 0) * 10) / 10;
    const valor = doPeriodo.reduce((s, a) => s + a.valor, 0);
    const arla = Math.round(litros * 0.045);
    await notaCompra('posto', emissao, [
      { desc: 'OLEO DIESEL B S10', ncm: '27101921', cfop: '5656', un: 'L', qtd: litros, valor, codigo: '4.1', centro: 'Frota',
        abastecimentos: doPeriodo.map((a) => ({ id: a.id!, veiculo: a.veiculo, valor: a.valor })) },
      { desc: 'ARLA 32 GRANEL', ncm: '31021010', cfop: '5102', un: 'L', qtd: arla, valor: cents(arla * 3.85), codigo: '4.4', centro: 'Frota' },
    ], [{ venc: util(somarDias(emissao, 15)), valor: 0 }]);
  }

  // ----- vendas: medições semanais dos clientes PJ e vendas de balcão
  const sazonal = [0.94, 1, 1.06, 1.1, 1.04, 0.98, 1];
  let nfs = 2400;
  const volumeSemana: { sexta: string; m3: number }[] = [];
  const receitaMes: Record<string, { total: number; pj: number }> = {};
  const somaReceita = (comp: string, v: number, pj: boolean) => {
    const k = comp.slice(0, 7);
    receitaMes[k] ??= { total: 0, pj: 0 };
    receitaMes[k].total += v;
    if (pj) receitaMes[k].pj += v;
  };
  let sexta = inicio;
  while (diaSemana(sexta) !== 5) sexta = somarDias(sexta, 1);
  let bomba = 0;
  // Cargas produzidas na usina: o volume vendido é dividido em viagens das betoneiras ao longo da semana.
  // Sorteio separado, para as cargas não mudarem os números do financeiro.
  const rc = sorteio(4242);
  type CargaDemo = { dataHora: string; traco: string; m3: number; cliente: string; obra: string; betoneira: string; bomba: string | null; bombeado: number | null; devolvido: number };
  const cargasDemo: CargaDemo[] = [];
  const agoraHora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date()));
  const tracoDoFck = (fck: string) => ({ 'fck 20': 'C20-S100-B1', 'fck 25': 'C25-S100-B1', 'fck 30': 'C30-S120-B1', 'fck 35': 'C35-S120-B1' })[fck] ?? 'C25-S100-B1';
  const distribuir = (dias: string[], cliente: string, fck: string, m3: number, bombaCodigo: string | null, m3Bomba: number, obra: string) => {
    const validos = dias.filter((d) => d >= inicio && d <= hoje && diaSemana(d) !== 0 && !(d === hoje && agoraHora < 9));
    if (!validos.length) return;
    let resta = m3;
    let bombaResta = m3Bomba;
    const doDia = bombaCodigo ? validos[Math.floor(rc() * validos.length)] : null;
    while (resta > 0.01) {
      const dia = bombaCodigo && bombaResta > 0 ? doDia! : validos[Math.floor(rc() * validos.length)];
      const livres = codigos.filter((c) => c.startsWith('BET') && !(c === 'BET-04' && dia >= somarDias(hoje, -2)));
      const bet = livres[Math.floor(rc() * livres.length)];
      const vol = Math.round(Math.min(bet >= 'BET-05' ? 10 : 8, resta) * 2) / 2 || resta;
      const ultimaHora = dia === hoje ? Math.max(7, agoraHora - 1) : 16;
      const hh = String(7 + Math.floor(rc() * (ultimaHora - 6))).padStart(2, '0');
      const mm = String(Math.floor(rc() * 60)).padStart(2, '0');
      const bombeado = bombaCodigo && bombaResta > 0 ? Math.min(vol, bombaResta) : null;
      if (bombeado) bombaResta -= bombeado;
      cargasDemo.push({ dataHora: `${dia}T${hh}:${mm}:00-03:00`, traco: tracoDoFck(fck), m3: vol, cliente, obra, betoneira: bet,
        bomba: bombeado ? bombaCodigo : null, bombeado, devolvido: rc() < 0.04 ? Math.min(vol, Math.round((0.3 + rc() * 0.9) * 10) / 10) : 0 });
      resta = Math.round((resta - vol) * 100) / 100;
    }
  };
  const OBRAS: Record<string, string[]> = {
    'Construtora Alvorada Ltda': ['Ed. Alvorada Prime · Torre A', 'Ed. Alvorada Prime · Torre B'],
    'Incorporadora Vale Verde Ltda': ['Condomínio Vale Verde · Quadra 3'],
    'Engenharia Pilar Forte Ltda': ['Galpão logístico · BR-153', 'Hospital regional · ampliação'],
    'Residencial Jardim das Palmeiras SPE Ltda': ['Jardim das Palmeiras · casas 40 a 80'],
    'Pavimentadora Rota Norte Ltda': ['Calçadas e meio-fio · Av. Teotônio Segurado'],
    'Construtora Novo Lar Ltda': ['Residencial Novo Lar · bloco 2'],
  };
  const obraDe = (cliente: string) => {
    const l = OBRAS[cliente] ?? ['Obra'];
    return l[Math.floor(rc() * l.length)];
  };
  for (; sexta <= ontem; sexta = somarDias(sexta, 7)) {
    const idx = Math.min(6, (Number(sexta.slice(0, 4)) - Number(inicio.slice(0, 4))) * 12 + Number(sexta.slice(5, 7)) - Number(inicio.slice(5, 7)));
    let sextas = 0;
    for (let d = inicioMes(sexta); d <= fimMes(sexta); d = somarDias(d, 1)) if (diaSemana(d) === 5) sextas++;
    const base = (1350 * sazonal[idx]) / sextas;
    let m3Semana = 0;
    for (const x of CLIENTES_PJ) {
      if (r() < 0.04) continue;
      const m3 = Math.max(8, Math.round(base * x.parte * entre(0.88, 1.12)));
      m3Semana += m3;
      const concreto = cents(m3 * x.preco);
      const m3Bomba = Math.round(m3 * x.bomba * entre(0.8, 1.2));
      const bombeamento = m3Bomba ? cents(Math.max(900, m3Bomba * 32)) : 0;
      const qualBomba = codigos[6 + (bomba++ % 2)];
      const venc = util(somarDias(sexta, 28));
      const atraso = Math.round(entre(x.atraso[0], x.atraso[1]));
      const dataPg = util(somarDias(venc, atraso));
      // Pilar Forte vem atrasando: as duas últimas medições já vencidas seguem em aberto.
      const segurado = x.atraso[0] > 5 && venc >= somarDias(hoje, -22);
      const pago = dataPg <= somarDias(hoje, -8) && !segurado
        ? { data: dataPg, conta: banco, forma: r() < 0.6 ? 'boleto' : 'pix', juros: atraso > 3 ? Math.round((concreto + bombeamento) * (0.02 + 0.00033 * atraso)) : 0 }
        : null;
      const segunda = somarDias(sexta, -4);
      await lanc('receita', sexta, `Concreto ${x.fck} · ${m3} m³${bombeamento ? ' + bombeamento' : ''} · semana de ${segunda.slice(8, 10)}/${segunda.slice(5, 7)}`,
        { documento: `NFS-e ${++nfs}`, cliente: x.nome },
        [{ codigo: '1.1', valor: concreto, centro: 'Usina' }, ...(bombeamento ? [{ codigo: '1.2', valor: bombeamento, centro: 'Bombas', veiculo: qualBomba }] : [])],
        [{ venc, valor: 0, pago }]);
      somaReceita(sexta, concreto + bombeamento, true);
      distribuir([0, 1, 2, 3, 4].map((n) => somarDias(segunda, n)), x.nome, x.fck, m3, m3Bomba ? qualBomba : null, m3Bomba, obraDe(x.nome));
    }
    // Balcão: pessoa física, paga na entrega.
    for (let k = 0; k < 2 + Math.floor(r() * 2); k++) {
      const dia = somarDias(sexta, -Math.floor(r() * 5));
      if (dia > ontem || dia < inicio) continue;
      const m3 = Math.round(entre(3, 8));
      m3Semana += m3;
      const valor = cents(m3 * 490);
      const nome = CLIENTES_PF[Math.floor(r() * CLIENTES_PF.length)];
      await lanc('receita', dia, `Concreto fck 25 · ${m3} m³ · obra residencial`, { documento: `NFS-e ${++nfs}`, cliente: nome },
        [{ codigo: '1.1', valor, centro: 'Usina' }], [{ venc: dia, valor: 0, pago: { data: dia, conta: banco, forma: 'pix' } }]);
      somaReceita(dia, valor, false);
      distribuir([dia], nome, 'fck 25', m3, null, 0, 'Residência particular');
    }
    volumeSemana.push({ sexta, m3: m3Semana });
  }
  // Semana em andamento: cargas já entregues, que serão medidas na sexta.
  for (let d = somarDias(sexta, -4); d <= hoje; d = somarDias(d, 1)) {
    for (const x of CLIENTES_PJ) {
      if (rc() < 0.25) continue;
      const m3 = Math.max(4, Math.round((1350 / 21.5) * x.parte * (0.7 + rc() * 0.6)));
      const m3Bomba = Math.round(m3 * x.bomba);
      distribuir([d], x.nome, x.fck, m3, m3Bomba ? codigos[6 + (bomba++ % 2)] : null, m3Bomba, obraDe(x.nome));
    }
  }

  // ----- insumos, traços e cargas
  const INSUMOS: [string, string, string, number][] = [
    ['Cimento CP II-F 40', 'cimento', 'kg', 0.575],
    ['Areia média lavada', 'areia', 'kg', 0.0307],
    ['Brita 1', 'brita', 'kg', 0.04],
    ['Brita 0', 'brita', 'kg', 0.042],
    ['Água', 'agua', 'L', 0.005],
    ['Aditivo plastificante polifuncional', 'aditivo', 'L', 5.2],
  ];
  const insumo: Record<string, string> = {};
  for (const [nome, tipo, unidade, custo] of INSUMOS) {
    insumo[nome] = (await um(`INSERT INTO insumos (empresa_id, nome, tipo, unidade, custo_unitario_centavos, estoque_minimo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [e, nome, tipo, unidade, custo * 100, tipo === 'cimento' ? 60000 : tipo === 'aditivo' ? 800 : tipo === 'agua' ? null : 150000])).id;
  }
  const TRACOS: [string, string, number, string, string, number[]][] = [
    ['C20-S100-B1', 'Concreto convencional fck 20', 20, '10 ± 2', 'Brita 1', [240, 820, 1000, 0, 190, 1.8]],
    ['C25-S100-B1', 'Concreto convencional fck 25', 25, '10 ± 2', 'Brita 1', [262, 800, 1010, 0, 185, 2.1]],
    ['C30-S120-B1', 'Concreto bombeável fck 30', 30, '12 ± 2', 'Brita 1', [295, 770, 1020, 0, 180, 2.5]],
    ['C35-S120-B1', 'Concreto bombeável fck 35', 35, '12 ± 2', 'Brita 1', [330, 740, 1030, 0, 178, 2.9]],
    ['C25-S160-B0', 'Concreto bombeável fck 25 com brita 0', 25, '16 ± 2', 'Brita 0', [285, 880, 0, 900, 195, 2.6]],
  ];
  const traco: Record<string, string> = {};
  for (const [codigo, descricao, fck, slump, brita, qtds] of TRACOS) {
    traco[codigo] = (await um(`INSERT INTO tracos (empresa_id, codigo, descricao, fck, slump, brita) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [e, codigo, descricao, fck, slump, brita])).id;
    for (const [j, qtd] of qtds.entries()) {
      if (qtd > 0) await q('INSERT INTO tracos_itens (empresa_id, traco_id, insumo_id, quantidade) VALUES ($1,$2,$3,$4)', [e, traco[codigo], insumo[INSUMOS[j][0]], qtd]);
    }
  }
  cargasDemo.sort((a, b) => a.dataHora.localeCompare(b.dataHora));
  // Qualidade: toda carga é amostrada (slump e 2 CPs aos 7 e aos 28 dias). Sorteio separado.
  const rq = sorteio(777);
  const gauss = () => Math.sqrt(-2 * Math.log(rq() || 1e-9)) * Math.cos(2 * Math.PI * rq());
  await q(
    `INSERT INTO qualidade_config (empresa_id, idades, cps_por_idade, idade_controle, diametro_mm, responsavel_nome, responsavel_registro)
     VALUES ($1, '{7,28}', 2, 28, 100, 'Eng.ª Patrícia Lemos', 'CREA-TO 000000/D (exemplo)')`,
    [e],
  );
  const lab = usuario('laboratorio@') ?? gestor;
  let baixoForcado = false;
  for (const [i, x] of cargasDemo.entries()) {
    const motorista = rc() < 0.08 ? motoristas[8] : motoristaDo[x.betoneira] ?? null;
    const carga = await um(
      `INSERT INTO cargas (empresa_id, numero, data_hora, traco_id, volume_m3, cliente_id, obra, betoneira_id, motorista_id, bomba_id, operador_bomba_id,
                           volume_bombeado_m3, devolvido_m3, registrado_por_id, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$3) RETURNING id`,
      [e, 10001 + i, x.dataHora, traco[x.traco], x.m3, cli[x.cliente], x.obra, veic[x.betoneira], motorista, x.bomba ? veic[x.bomba] : null,
        x.bomba ? motoristaDo[x.bomba] : null, x.bombeado, x.devolvido, usuario('operador@') ?? gestor],
    );
    const t = TRACOS.find((y) => y[0] === x.traco)!;
    const centro = Number(t[3].split('±')[0]);
    const slump = Math.round((centro + gauss() * 1.0 + (rq() < 0.04 ? (rq() < 0.5 ? -3.5 : 3.5) : 0)) * 2) / 2;
    const am = await um(`INSERT INTO amostras (empresa_id, carga_id, data_moldagem, slump_cm, temperatura_c, moldado_por) VALUES ($1,$2,$3,$4,$5,'Fábio Ramos') RETURNING id`, [
      e, carga.id, x.dataHora, Math.max(2, slump), Math.round((26 + gauss() * 2.5) * 10) / 10,
    ]);
    const fck = t[2];
    // Um resultado abaixo do fck recente, para o alerta aparecer; os demais raros.
    const recente = !baixoForcado && somarDias(x.dataHora.slice(0, 10), 28) >= somarDias(hoje, -12) && somarDias(x.dataHora.slice(0, 10), 28) < somarDias(hoje, -3);
    if (recente) baixoForcado = true;
    const fc28 = recente || rq() < 0.012 ? fck * (0.9 + rq() * 0.08) : fck * (1.24 + gauss() * 0.07);
    const fc7 = fc28 * (0.66 + rq() * 0.1);
    const dia = x.dataHora.slice(0, 10);
    const linhas: string[] = [];
    const vals: unknown[] = [];
    for (const [idade, base] of [[7, fc7], [28, fc28]] as const) {
      const prevista = somarDias(dia, idade);
      const atrasado = prevista < hoje && prevista >= somarDias(hoje, -2) && rq() < 0.12;
      const rompido = prevista < hoje && !atrasado;
      for (const n of [1, 2]) {
        const valor = Math.round(base * (n === 1 ? 1 : 0.94 + rq() * 0.05) * 10) / 10;
        vals.push(e, am.id, idade, n, prevista, rompido ? prevista : null, rompido ? valor : null, rompido ? 'rompido' : 'aguardando', rompido ? lab : null);
        const k = vals.length - 9;
        linhas.push(`($${k + 1},$${k + 2},$${k + 3},$${k + 4},$${k + 5},$${k + 6},$${k + 7},$${k + 8},$${k + 9})`);
      }
    }
    await q(`INSERT INTO corpos_prova (empresa_id, amostra_id, idade_dias, numero, data_prevista, data_ruptura, resistencia_mpa, situacao, rompido_por_id) VALUES ${linhas.join(',')}`, vals);
  }
  // Equipamentos do laboratório e da usina: um vencendo e um vencido, para mostrar os alertas.
  for (const [nome, tipo, ident, calibrou, validade, cert, labor] of [
    ['Balança de cimento da central', 'balanca', 'BAL-01 · 0 a 2.000 kg', -160, 180, 'CAL-2026-0412', 'Metrologia Norte (exemplo)'],
    ['Balança de agregados da central', 'balanca', 'BAL-02 · 0 a 10.000 kg', -95, 180, 'CAL-2026-0563', 'Metrologia Norte (exemplo)'],
    ['Dosador de água e aditivo', 'balanca', 'DOS-01', -40, 180, 'CAL-2026-0741', 'Metrologia Norte (exemplo)'],
    ['Prensa hidráulica 100 t', 'prensa', 'PRE-01 · classe 1', -120, 365, 'CAL-2026-0388', 'Laboratório de Calibração (exemplo)'],
    ['Cone de Abrams (slump)', 'cone_slump', 'CON-01 e CON-02', -200, 365, null, null],
    ['Termômetro digital', 'termometro', 'TER-01', -372, 365, 'CAL-2025-1102', 'Metrologia Norte (exemplo)'],
    ['Moldes cilíndricos 10 × 20 cm', 'molde', '60 unidades', -60, 365, null, null],
  ] as const) {
    await q(`INSERT INTO equipamentos (empresa_id, nome, tipo, identificacao, ultima_calibracao, validade_dias, certificado, laboratorio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
      e, nome, tipo, ident, somarDias(hoje, calibrou), validade, cert, labor,
    ]);
  }
  // Ensaios: umidade da areia todo dia útil e granulometria mensal.
  for (let d = somarDias(hoje, -60); d <= hoje; d = somarDias(d, 1)) {
    if (diaSemana(d) === 0 || diaSemana(d) === 6) continue;
    await q(`INSERT INTO ensaios_insumos (empresa_id, insumo_id, data, tipo, umidade_pct, registrado_por_id, criado_em) VALUES ($1,$2,$3,'umidade',$4,$5,$3::date + time '06:40')`, [
      e, insumo['Areia média lavada'], d, Math.round((5 + gauss() * 1.0) * 10) / 10, lab,
    ]);
  }
  for (const m of [somarMeses(inicioMes(hoje), -2), somarMeses(inicioMes(hoje), -1), inicioMes(hoje)]) {
    const d = util(diaDoMes(m, 2));
    if (d > hoje) continue;
    await q(`INSERT INTO ensaios_insumos (empresa_id, insumo_id, data, tipo, modulo_finura, dimensao_maxima_mm, pulverulento_pct, registrado_por_id) VALUES ($1,$2,$3,'granulometria',$4,4.8,$5,$6)`, [
      e, insumo['Areia média lavada'], d, Math.round((2.55 + gauss() * 0.08) * 100) / 100, Math.round((2.6 + gauss() * 0.4) * 10) / 10, lab,
    ]);
    await q(`INSERT INTO ensaios_insumos (empresa_id, insumo_id, data, tipo, modulo_finura, dimensao_maxima_mm, pulverulento_pct, registrado_por_id) VALUES ($1,$2,$3,'granulometria',$4,19,$5,$6)`, [
      e, insumo['Brita 1'], d, Math.round((6.9 + gauss() * 0.1) * 100) / 100, Math.round((0.7 + gauss() * 0.15) * 10) / 10, lab,
    ]);
  }

  // ----- valores da produção dos motoristas (com um reajuste no meio do período) e escala
  for (const [funcao, valor, vigencia] of [['motorista', 250, inicio], ['motorista', 280, somarMeses(inicio, 3)], ['operador_bomba', 180, inicio]] as const) {
    await q('INSERT INTO valores_producao (empresa_id, funcao, valor_m3_centavos, vigencia, criado_por_id) VALUES ($1,$2,$3,$4,$5)', [e, funcao, valor, vigencia, gestor]);
  }
  const pessoasEscala = [...Object.entries(motoristaDo).map(([v, id]) => ({ id, bomba: v.startsWith('BOM') })), { id: motoristas[8], bomba: false }];
  for (let d = somarDias(hoje, -14); d <= somarDias(hoje, 6); d = somarDias(d, 1)) {
    const w = diaSemana(d);
    if (w === 0) continue;
    const folga = Math.floor(rc() * pessoasEscala.length);
    for (const [k, p] of pessoasEscala.entries()) {
      const deFolga = w === 6 ? k % 3 === 0 : k === folga && rc() < 0.5;
      await q('INSERT INTO escalas (empresa_id, data, motorista_id, entrada, folga, atualizado_por_id) VALUES ($1,$2,$3,$4,$5,$6)', [
        e, d, p.id, deFolga ? null : p.bomba ? '07:30' : k % 2 ? '07:00' : '06:30', deFolga, gestor,
      ]);
    }
  }

  // ----- insumos da usina: compras acompanham o consumo das cargas (pelo traço) mais a perda normal da usina
  const consumoDe = (k: number, de: string, ate: string) =>
    cargasDemo.filter((x) => x.dataHora.slice(0, 10) >= de && x.dataHora.slice(0, 10) <= ate)
      .reduce((a, x) => a + x.m3 * (TRACOS.find((t) => t[0] === x.traco)?.[5][k] ?? 0), 0);
  for (const s of volumeSemana) {
    const t = Math.round((consumoDe(0, somarDias(s.sexta, -6), s.sexta) * 1.011) / 100) / 10;
    if (!t) continue;
    await notaCompra('cimento', s.sexta, [{ desc: 'CIMENTO CP II-F 40 GRANEL', ncm: '25232910', cfop: '5101', un: 'T', qtd: t, valor: cents(t * 575), codigo: '3.1', centro: 'Usina', insumoId: insumo['Cimento CP II-F 40'], fator: 1000 }],
      [{ venc: util(somarDias(s.sexta, 28)), valor: 0 }]);
  }
  for (const [de, ate] of quinzenas) {
    if (ate > ontem) continue;
    const brita = Math.round((consumoDe(2, de, ate) * 1.021) / 1300);
    const areia = Math.round((consumoDe(1, de, ate) * 1.03) / 1300);
    if (!brita || !areia) continue;
    await notaCompra('brita', ate, [{ desc: 'BRITA 1', ncm: '25171000', cfop: '5101', un: 'M3', qtd: brita, valor: cents(brita * 58), codigo: '3.3', centro: 'Usina', insumoId: insumo['Brita 1'], fator: 1300 }],
      [{ venc: util(somarDias(ate, 21)), valor: 0 }]);
    await notaCompra('areia', ate, [{ desc: 'AREIA MEDIA LAVADA', ncm: '25059000', cfop: '5102', un: 'M3', qtd: areia, valor: cents(areia * 46), codigo: '3.2', centro: 'Usina', insumoId: insumo['Areia média lavada'], fator: 1300 }],
      [{ venc: util(somarDias(ate, 21)), valor: 0 }]);
  }
  const meses: string[] = [];
  for (let m = inicio; m <= hoje; m = somarMeses(m, 1)) meses.push(m);
  const fechados = meses.filter((m) => fimMes(m) < hoje);
  const volumeMes = (m: string) => volumeSemana.filter((s) => s.sexta.slice(0, 7) === m.slice(0, 7)).reduce((a, s) => a + s.m3, 0);
  for (const m of fechados) {
    const litros = Math.round(consumoDe(5, m, fimMes(m)) * 1.009);
    await notaCompra('aditivo', fimMes(m), [{ desc: 'ADITIVO PLASTIFICANTE POLIFUNCIONAL', ncm: '38244000', cfop: '5101', un: 'L', qtd: litros, valor: cents(litros * 5.2), codigo: '3.4', centro: 'Usina', insumoId: insumo['Aditivo plastificante polifuncional'], fator: 1 }],
      [{ venc: util(somarDias(fimMes(m), 28)), valor: 0 }]);
    await notaCompra('pecas', diaDoMes(m, 18), [{ desc: 'OLEO LUBRIFICANTE E GRAXA PARA CHASSI', ncm: '27101932', cfop: '5102', un: 'UN', qtd: 1, valor: cents(entre(1450, 1950)), codigo: '4.4', centro: 'Frota' }],
      [{ venc: util(somarDias(diaDoMes(m, 18), 28)), valor: 0 }]);
  }

  // ----- pneus
  for (const [i, v] of ['BET-02', 'BOM-01', 'BET-04', 'BET-01'].entries()) {
    const emissao = util(somarDias(inicio, 20 + i * 42));
    if (emissao > somarDias(hoje, -5)) continue;
    await notaCompra('pneus', emissao, [{ desc: 'PNEU 295/80 R22.5 BORRACHUDO', ncm: '40112090', cfop: '5405', un: 'UN', qtd: 4, valor: cents(4 * 2380), codigo: '4.3', centro: 'Frota', veiculo: v }],
      [{ venc: util(somarDias(emissao, 30)), valor: cents(2 * 2380) }, { venc: util(somarDias(emissao, 60)), valor: 0 }]);
  }
  // Uma nota chegou ontem e espera conferência.
  await notaCompra('pneus', ontem, [{ desc: 'PNEU 295/80 R22.5 LISO', ncm: '40112090', cfop: '5405', un: 'UN', qtd: 2, valor: cents(2 * 2290), codigo: '4.3', centro: 'Frota', veiculo: 'BOM-02' }],
    [{ venc: util(somarDias(hoje, 29)), valor: 0 }], 'boleto', 'rascunho');

  // ----- manutenção: plano, ordens de serviço e notas da oficina
  const { PLANO_PADRAO } = await import('./manutencao.ts');
  const planos: Record<string, { id: string; tipo: string | null; km?: number; horas?: number; dias?: number }> = {};
  for (const p of PLANO_PADRAO) {
    const x = await um(`INSERT INTO planos_manutencao (empresa_id, tipo_veiculo, item, intervalo_km, intervalo_horas, intervalo_dias) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [e, p.tipo, p.item, p.km ?? null, p.horas ?? null, p.dias ?? null]);
    planos[p.item] = { id: x.id, tipo: p.tipo, km: p.km, horas: p.horas, dias: p.dias };
  }
  let k = 0;
  for (const v of FROTA) {
    for (const p of Object.values(planos)) {
      if (p.tipo && p.tipo !== v.tipo) continue;
      k++;
      const fracao = k % 13 === 0 ? 1.06 : k % 9 === 0 ? 0.93 : 0.25 + ((k * 37) % 55) / 100;
      const u = ultimo[v.codigo];
      await q(`INSERT INTO revisoes_veiculo (empresa_id, veiculo_id, plano_id, ultima_km, ultima_horas, ultima_data) VALUES ($1,$2,$3,$4,$5,$6)`, [
        e, veic[v.codigo], p.id, p.km ? Math.round(u.km - p.km * fracao) : null, p.horas ? Math.round(u.hor - p.horas * fracao) : null,
        somarDias(hoje, -Math.round((p.dias ?? 120) * fracao)),
      ]);
    }
  }

  let numeroOs = 0;
  const abrirOs = async (codigo: string, s: ServicoOs, abertura: string, conclusao: string | null) => {
    const leitura = kmNoDia[codigo][abertura] ?? ultimo[codigo];
    const o = await um(
      `INSERT INTO ordens_servico (empresa_id, numero, veiculo_id, tipo, descricao, abertura, conclusao, km, horimetro, oficina, fornecedor_id, status, status_veiculo_anterior, aberta_por_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'externa',$10,$11,'disponivel',$12) RETURNING id`,
      [e, ++numeroOs, veic[codigo], s.tipo, s.desc, abertura, conclusao, leitura.km, leitura.hor, forn.oficina, conclusao ? 'concluida' : 'aberta', gestor],
    );
    const ids: string[] = [];
    let total = 0;
    for (const [tipo, desc, qtd, valor] of s.itens) {
      const x = await um(`INSERT INTO os_itens (empresa_id, os_id, tipo, descricao, quantidade, valor_unitario_centavos, plano_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [e, o.id, tipo, desc, qtd, cents(valor), tipo === 'mao_de_obra' && s.plano ? planos[s.plano]?.id ?? null : null]);
      ids.push(x.id);
      total += Math.round(qtd * cents(valor));
    }
    if (s.plano && planos[s.plano] && conclusao) {
      await q('UPDATE revisoes_veiculo SET ultima_km = $3, ultima_horas = $4, ultima_data = $5, os_id = $6 WHERE veiculo_id = $1 AND plano_id = $2', [
        veic[codigo], planos[s.plano].id, leitura.km, leitura.hor, conclusao, o.id,
      ]);
    }
    return { id: o.id as string, ids, total, numero: numeroOs };
  };
  let alvo = 0;
  for (let d = somarDias(inicio, 4); d <= somarDias(hoje, -12); d = somarDias(d, 6 + Math.floor(r() * 4))) {
    const abertura = util(d);
    const codigo = codigos[alvo++ % codigos.length];
    const lista = codigo.startsWith('BOM') ? SERV_BOM : SERV_BET;
    const s = lista[Math.floor(r() * lista.length)];
    const conclusao = util(somarDias(abertura, Math.floor(r() * 3)));
    const os = await abrirOs(codigo, s, abertura, conclusao);
    if (conclusao <= somarDias(hoje, -8)) {
      await notaCompra('oficina', conclusao, [{ desc: `Serviços e peças conforme OS nº ${os.numero} (${codigo})`, ncm: '87089990', cfop: '5933', un: 'UN', qtd: 1, valor: os.total,
        codigo: '4.2', centro: codigo.startsWith('BOM') ? 'Bombas' : 'Frota', veiculo: codigo, osItens: os.ids }], [{ venc: util(somarDias(conclusao, 21)), valor: 0 }]);
    }
  }
  // Recentes: concluídas sem nota e uma aberta (BET-04 na oficina).
  await abrirOs('BET-02', { tipo: 'corretiva', desc: 'Pneu traseiro furado', itens: [['servico', 'Conserto de pneu', 1, 140]] }, somarDias(hoje, -6), somarDias(hoje, -6));
  await abrirOs('BOM-02', SERV_BOM[1], somarDias(hoje, -4), somarDias(hoje, -4));
  await abrirOs('BET-04', { tipo: 'corretiva', desc: 'Ruído e perda de pressão na bomba hidráulica do balão',
    itens: [['peca', 'Bomba hidráulica recondicionada', 1, 6800], ['mao_de_obra', 'Remoção e instalação da bomba', 1, 1100]] }, somarDias(hoje, -2), null);

  // ----- despesas fixas e de pessoal
  const ultimoMes = meses[meses.length - 1];
  const mesesFuturos = [1, 2, 3].map((n) => somarMeses(ultimoMes, n));
  const todos = [...meses, ...mesesFuturos];
  const recorrente = async (desc: string, codigo: string, ctr: string, valor: number, dia: number, ate: string[], o: { fornecedor?: string; forma?: string } = {}) => {
    let pai: string | undefined;
    for (const [i, m] of ate.entries()) {
      const venc = util(diaDoMes(m, dia));
      const id = await lanc('despesa', m, desc, { fornecedor: o.fornecedor, recorrencia: 'mensal', paiId: pai, ordem: i + 1 },
        [{ codigo, valor: cents(valor), centro: ctr }], [{ venc, valor: 0, pago: pagarDesp(venc, o.forma ?? 'boleto') }]);
      pai ??= id;
    }
  };
  await recorrente('Aluguel do terreno da usina', '6.1', 'Usina', 7000, 10, todos, { fornecedor: 'imobiliaria' });
  await recorrente('Honorários contábeis', '6.3', 'Administrativo', 3400, 10, todos.slice(0, -2), { fornecedor: 'contabil' });
  await recorrente('Sistema de folha e ponto', '6.4', 'Administrativo', 690, 5, todos.slice(0, -2), { fornecedor: 'software', forma: 'cartao' });

  for (const [i, m] of meses.entries()) {
    const prox = somarMeses(m, 1);
    const fechado = fechados.includes(m);
    // Seguro da frota (apólice em 10 parcelas), rateado pelos veículos.
    const vencSeguro = util(diaDoMes(m, 20));
    await lanc('despesa', m, `Seguro da frota · parcela ${i + 4}/10`, { fornecedor: 'seguradora', documento: 'Apólice PT-77.410.226' },
      codigos.map((v) => ({ codigo: '4.6', valor: cents(660), centro: v.startsWith('BOM') ? 'Bombas' : 'Frota', veiculo: v })),
      [{ venc: vencSeguro, valor: 0, pago: pagarDesp(vencSeguro, 'debito_automatico') }]);
    // Financiamento dos dois caminhões novos.
    for (const [j, v] of ['BET-05', 'BET-06'].entries()) {
      const venc = util(diaDoMes(m, 15));
      await lanc('despesa', m, `Financiamento ${v} · parcela ${14 + i}/48`, { fornecedor: 'banco', documento: `Contrato FIN-20${25 + j}-0${j + 3}88` },
        [{ codigo: '11.3', valor: cents(7450 + i * 32), centro: 'Frota', veiculo: v }, { codigo: '8.3', valor: cents(2480 - i * 32), centro: 'Frota', veiculo: v }],
        [{ venc, valor: 0, pago: pagarDesp(venc, 'debito_automatico') }]);
    }
    if (!fechado) continue;
    const vol = volumeMes(m);
    const vencEnergia = util(diaDoMes(prox, 12));
    await lanc('despesa', m, 'Energia elétrica e água da usina', { fornecedor: 'energia' }, [{ codigo: '3.5', valor: cents(vol * 4.6 + 900), centro: 'Usina' }],
      [{ venc: vencEnergia, valor: 0, pago: pagarDesp(vencEnergia) }]);
    await lanc('despesa', m, 'Energia, internet e telefone do escritório', { fornecedor: 'energia' }, [{ codigo: '6.2', valor: cents(1380), centro: 'Administrativo' }],
      [{ venc: vencEnergia, valor: 0, pago: pagarDesp(vencEnergia) }]);
    const vencLab = util(diaDoMes(prox, 10));
    await lanc('despesa', m, 'Ensaios de compressão dos corpos de prova', { fornecedor: 'laboratorio' }, [{ codigo: '3.7', valor: cents(2150), centro: 'Usina' }],
      [{ venc: vencLab, valor: 0, pago: pagarDesp(vencLab) }]);
    const vencTarifa = util(diaDoMes(prox, 1));
    if (vencTarifa < inicioMes(hoje)) {
      await lanc('despesa', m, 'Tarifas bancárias · pacote de serviços', {}, [{ codigo: '8.2', valor: cents(189.9), centro: 'Administrativo' }],
        [{ venc: vencTarifa, valor: 0, pago: pagarDesp(vencTarifa, 'debito_automatico') }]);
    }
    // Folha: salários no 5º dia útil, encargos no dia 20.
    const vencFolha = util(diaDoMes(prox, 5));
    const vencEncargos = util(diaDoMes(prox, 20));
    const salarios: Ap[] = [
      ...codigos.map((v) => ({ codigo: '5.1', valor: cents(3350), centro: v.startsWith('BOM') ? 'Bombas' : 'Frota', veiculo: v, descricao: `Motorista do ${v}` })),
      { codigo: '5.1', valor: cents(3100), centro: 'Frota', descricao: 'Motorista folguista' },
      { codigo: '5.1', valor: cents(3600), centro: 'Usina', descricao: 'Operador da central' },
      { codigo: '5.1', valor: cents(3200), centro: 'Usina', descricao: 'Laboratorista' },
      { codigo: '5.1', valor: cents(3900), centro: 'Frota', descricao: 'Mecânico' },
      { codigo: '5.3', valor: cents(11600), centro: 'Administrativo', descricao: 'Gestora e assistente financeiro' },
      { codigo: '5.3', valor: cents(2800), centro: 'Comercial', descricao: 'Vendedor (fixo)' },
    ];
    await lanc('despesa', m, 'Folha de pagamento', { documento: `Folha ${m.slice(5, 7)}/${m.slice(0, 4)}` }, salarios,
      [{ venc: vencFolha, valor: 0, pago: pagarDesp(vencFolha, 'transferencia') }]);
    await lanc('despesa', m, 'INSS, FGTS e benefícios', { documento: `Guias ${m.slice(5, 7)}/${m.slice(0, 4)}` },
      [{ codigo: '5.2', valor: cents(40650 * 0.42), centro: 'Frota' }, { codigo: '5.4', valor: cents(14400 * 0.42), centro: 'Administrativo' }],
      [{ venc: vencEncargos, valor: 0, pago: pagarDesp(vencEncargos) }]);
    await lanc('despesa', m, 'Pró-labore dos sócios', {}, [{ codigo: '5.5', valor: cents(15000), centro: 'Administrativo' }],
      [{ venc: vencFolha, valor: 0, pago: pagarDesp(vencFolha, 'transferencia') }]);
    // Comissões e tributos sobre o faturamento do mês.
    const rec = receitaMes[m.slice(0, 7)] ?? { total: 0, pj: 0 };
    const vencComissao = util(diaDoMes(prox, 10));
    await lanc('despesa', m, 'Comissão do vendedor', {}, [{ codigo: '7.1', valor: Math.round(rec.pj * 0.015), centro: 'Comercial' }],
      [{ venc: vencComissao, valor: 0, pago: pagarDesp(vencComissao, 'pix') }]);
    const vencTributos = util(diaDoMes(prox, 20));
    await lanc('despesa', m, 'PIS, COFINS e ISS', { documento: `Apuração ${m.slice(5, 7)}/${m.slice(0, 4)}` },
      [{ codigo: '2.1', valor: Math.round(rec.total * 0.0665), centro: 'Administrativo' }], [{ venc: vencTributos, valor: 0, pago: pagarDesp(vencTributos) }]);
    const fimTrimestre = somarMeses(m, (3 - (Number(m.slice(5, 7)) % 3)) % 3);
    const vencIr = ultimoUtil(somarMeses(fimTrimestre, 1));
    await lanc('despesa', m, 'IRPJ e CSLL (lucro presumido)', { documento: `Trimestre até ${fimTrimestre.slice(5, 7)}/${fimTrimestre.slice(0, 4)}` },
      [{ codigo: '9.1', valor: Math.round(rec.total * 0.0228), centro: 'Administrativo' }], [{ venc: vencIr, valor: 0, pago: pagarDesp(vencIr) }]);
    // Rendimento da aplicação.
    await lanc('receita', fimMes(m), 'Rendimento da aplicação automática', {}, [{ codigo: '8.4', valor: cents(entre(2250, 2550)), centro: 'Administrativo' }],
      [{ venc: fimMes(m), valor: 0, pago: { data: fimMes(m), conta: aplicacao, forma: 'transferencia' } }]);
    // Licenciamento de um veículo por mês.
    const v = codigos[i];
    const vencLic = util(diaDoMes(m, 22));
    await lanc('despesa', m, `Licenciamento anual ${v}`, {}, [{ codigo: '4.5', valor: cents(198.66), centro: v.startsWith('BOM') ? 'Bombas' : 'Frota', veiculo: v }],
      [{ venc: vencLic, valor: 0, pago: pagarDesp(vencLic, 'pix') }]);
    if (i === 1 || i === 4) {
      const venc = util(diaDoMes(m, 25));
      await lanc('despesa', m, i === 1 ? 'Troca da correia do transportador' : 'Manutenção da central dosadora', {},
        [{ codigo: '3.6', valor: cents(i === 1 ? 3850 : 2600), centro: 'Usina' }], [{ venc, valor: 0, pago: pagarDesp(venc, 'pix') }]);
    }
    if (i === 2 || i === 5) {
      const venc = util(diaDoMes(m, 14));
      await lanc('despesa', m, 'Brindes e material de divulgação', {}, [{ codigo: '7.2', valor: cents(1250), centro: 'Comercial' }], [{ venc, valor: 0, pago: pagarDesp(venc, 'pix') }]);
    }
    if (i === 3) {
      const venc = util(diaDoMes(prox, 3));
      await lanc('despesa', m, 'Multa de trânsito · excesso de velocidade', {}, [{ codigo: '6.7', valor: cents(195.23), centro: 'Frota', veiculo: 'BET-02' }],
        [{ venc, valor: 0, pago: pagarDesp(venc, 'pix') }]);
    }
  }

  // ----- caixa da usina: reforço semanal e despesas miúdas
  let segunda = inicio;
  while (diaSemana(segunda) !== 1) segunda = somarDias(segunda, 1);
  for (; segunda <= ontem; segunda = somarDias(segunda, 7)) {
    await q(`INSERT INTO transferencias (empresa_id, conta_origem_id, conta_destino_id, data, valor_centavos, descricao, criado_por_id) VALUES ($1,$2,$3,$4,$5,'Reforço do caixa da usina',$6)`,
      [e, banco, caixa, segunda, cents(1000), gestor]);
    const sext = somarDias(segunda, 4);
    if (sext > ontem) continue;
    await lanc('despesa', sext, 'Despesas miúdas da usina (lanche, gás, ferramentas)', {}, [{ codigo: '6.8', valor: cents(entre(650, 1050)), centro: 'Usina' }],
      [{ venc: sext, valor: 0, pago: { data: sext, conta: caixa, forma: 'dinheiro' } }]);
  }

  // ----- regras de apropriação aprendidas
  const regras: [string, string | null, string, string, string | null, number][] = [
    ['posto', 'OLEO DIESEL B S10', '4.1', 'Frota', null, 11],
    ['posto', 'ARLA 32 GRANEL', '4.4', 'Frota', null, 11],
    ['cimento', null, '3.1', 'Usina', null, 26],
    ['brita', null, '3.3', 'Usina', null, 12],
    ['areia', null, '3.2', 'Usina', null, 12],
    ['aditivo', null, '3.4', 'Usina', null, 6],
    ['oficina', null, '4.2', 'Frota', null, 18],
    ['pecas', null, '4.4', 'Frota', null, 6],
  ];
  for (const [f, texto, codigo, ctr, v, vezes] of regras) {
    await q(`INSERT INTO regras_apropriacao (empresa_id, fornecedor_id, texto_contem, plano_conta_id, centro_custo_id, veiculo_id, origem, vezes_aplicada) VALUES ($1,$2,$3,$4,$5,$6,'aprendida',$7)`,
      [e, forn[f], texto ? normalizar(texto) : null, plano[codigo], centro[ctr], v, vezes]);
  }

  // ----- estoque: consumo das cargas pelo custo das notas, inventário inicial e inventários de fim de mês
  await q('DELETE FROM cargas_consumo WHERE empresa_id = $1', [e]);
  await q(
    `INSERT INTO cargas_consumo (empresa_id, carga_id, insumo_id, quantidade, custo_unitario_centavos)
     SELECT c.empresa_id, c.id, ti.insumo_id, round(ti.quantidade * c.volume_m3, 3), i.custo_unitario_centavos
       FROM cargas c JOIN tracos_itens ti ON ti.traco_id = c.traco_id JOIN insumos i ON i.id = ti.insumo_id
      WHERE c.empresa_id = $1 AND c.status = 'produzida'`,
    [e],
  );
  await q("UPDATE insumos SET controla_estoque = false WHERE empresa_id = $1 AND tipo = 'agua'", [e]);
  const comEstoque = (await q("SELECT id, nome, custo_unitario_centavos FROM insumos WHERE empresa_id = $1 AND controla_estoque", [e])).rows as { id: string; nome: string; custo_unitario_centavos: string }[];
  const INICIAL: Record<string, number> = { 'Cimento CP II-F 40': 95000, 'Areia média lavada': 280000, 'Brita 1': 340000, 'Brita 0': 40000, 'Aditivo plastificante polifuncional': 2600 };
  // Perda típica (fração do consumo) apurada a cada inventário.
  const PERDA: Record<string, [number, number]> = { 'Cimento CP II-F 40': [0.006, 0.016], 'Areia média lavada': [0.02, 0.04], 'Brita 1': [0.012, 0.03], 'Brita 0': [0, 0], 'Aditivo plastificante polifuncional': [0.004, 0.014] };
  const inventario = async (data: string, contagem: (id: string, nome: string, teorico: number, consumo: number) => number, anterior: string | null, obs: string) => {
    const saldos = await saldosEm(c, e, data);
    const v = await um('INSERT INTO inventarios (empresa_id, data, observacao, criado_por_id, criado_em) VALUES ($1,$2,$3,$4,$2::date + time \'17:30\') RETURNING id', [e, data, obs, gestor]);
    for (const x of comEstoque) {
      const teorico = Math.round((saldos.get(x.id) ?? 0) * 1000) / 1000;
      const consumo = anterior
        ? Number((await um(
            `SELECT coalesce(sum(cc.quantidade), 0) AS q FROM cargas_consumo cc JOIN cargas c ON c.id = cc.carga_id
              WHERE cc.insumo_id = $1 AND c.status = 'produzida' AND (c.data_hora AT TIME ZONE 'America/Sao_Paulo')::date > $2 AND (c.data_hora AT TIME ZONE 'America/Sao_Paulo')::date <= $3`,
            [x.id, anterior, data])).q)
        : 0;
      const contado = Math.max(0, Math.round(contagem(x.id, x.nome, teorico, consumo)));
      const diferenca = Math.round((contado - teorico) * 1000) / 1000;
      await q(`INSERT INTO inventarios_itens (empresa_id, inventario_id, insumo_id, saldo_teorico, contado, diferenca, consumo_periodo, custo_unitario_centavos) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [e, v.id, x.id, teorico, contado, diferenca, anterior ? consumo : null, x.custo_unitario_centavos]);
      if (diferenca !== 0) {
        await q(`INSERT INTO estoque_movimentos (empresa_id, insumo_id, data, tipo, quantidade, custo_unitario_centavos, inventario_id, observacao, criado_por_id) VALUES ($1,$2,$3,'ajuste',$4,$5,$6,'Acerto do inventário',$7)`,
          [e, x.id, data, diferenca, x.custo_unitario_centavos, v.id, gestor]);
      }
    }
  };
  let ultimoInv = somarDias(inicio, -1);
  await inventario(ultimoInv, (_id, nome) => INICIAL[nome] ?? 0, null, 'Contagem inicial dos silos e baias');
  for (const m of fechados) {
    const fim = fimMes(m);
    await inventario(fim, (_id, nome, teorico, consumo) => teorico - consumo * (PERDA[nome][0] + rc() * (PERDA[nome][1] - PERDA[nome][0])), ultimoInv, 'Medição de fim de mês');
    ultimoInv = fim;
  }
  // Estoque mínimo: o aditivo fica abaixo do mínimo para mostrar o alerta.
  const saldosHoje = await saldosEm(c, e, hoje);
  for (const x of comEstoque) {
    const saldo = saldosHoje.get(x.id) ?? 0;
    const minimo = x.nome.startsWith('Aditivo') ? Math.ceil((Math.max(saldo, 0) * 1.25) / 100) * 100 : x.nome === 'Brita 0' ? null : Math.round((Math.max(saldo, 0) * 0.45) / 1000) * 1000;
    await q('UPDATE insumos SET estoque_minimo = $2 WHERE id = $1', [x.id, minimo]);
  }

  // ----- suprimentos: pedidos das compras de insumos recentes (recebidos pela nota), uma cotação concluída, pendências de aprovação e solicitações
  await popularSuprimentos(c, e, hoje, { dono: usuario('dono@') ?? gestor, gestor, forn, insumo, cnpjDe, centro });
  await popularContratos(c, e, hoje, { dono: usuario('dono@') ?? gestor, gestor, cnpjDe, centro, banco });
  await popularCatalogo(c, e);
  await popularComercial(c, e, hoje, { vendedor: usuario('vendedor@') ?? gestor, gestor, dono: usuario('dono@') ?? gestor });
  await popularCampo(c, e, hoje, { lab: usuario('laboratorio@') ?? gestor, operador: usuario('operador@') ?? gestor, dono: usuario('dono@') ?? gestor, gestor });
  await popularNotaPdf(c, e, hoje, usuario('financeiro@') ?? usuario('dono@') ?? gestor);
  await q("UPDATE contratos SET enviado_aprovacao_em = criado_em, aprovado_por_id = $2, aprovado_em = criado_em + interval '3 hours' WHERE empresa_id = $1 AND status = 'vigente'", [e, usuario('dono@') ?? gestor]);

  // ----- saldo inicial do banco: o menor saldo diário do período fica acima de R$ 60 mil
  const mov = (
    await q(
      `SELECT d::date AS dia,
              coalesce((SELECT sum(CASE WHEN l.tipo = 'receita' THEN p.valor_pago_centavos ELSE -p.valor_pago_centavos END) FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
                         WHERE p.conta_financeira_id = $1 AND p.status = 'paga' AND p.data_pagamento = d::date), 0)
            + coalesce((SELECT sum(CASE WHEN t.conta_destino_id = $1 THEN t.valor_centavos ELSE -t.valor_centavos END) FROM transferencias t
                         WHERE (t.conta_origem_id = $1 OR t.conta_destino_id = $1) AND t.data = d::date), 0) AS v
         FROM generate_series($2::date, $3::date, interval '1 day') d ORDER BY 1`,
      [banco, inicio, hoje],
    )
  ).rows;
  let acumulado = 0;
  let menor = 0;
  for (const x of mov) {
    acumulado += Number(x.v);
    menor = Math.min(menor, acumulado);
  }
  // ...e o saldo de hoje fica perto de R$ 185 mil.
  await q('UPDATE contas_financeiras SET saldo_inicial_centavos = $2 WHERE id = $1', [banco, Math.max(cents(60000) - menor, cents(185000) - acumulado)]);
}

// ---------------------------------------------------------------- comercial e produção da equipe

const PRECO_M3: Record<string, number> = { 'C20-S100-B1': 430, 'C25-S100-B1': 460, 'C30-S120-B1': 500, 'C35-S120-B1': 545, 'C25-S160-B0': 485 };

async function popularComercial(c: C, e: string, hoje: string, u: { vendedor: string | null; gestor: string | null; dono: string | null }): Promise<void> {
  const q = (sql: string, p: unknown[] = []) => c.query(sql, p);
  const vendedor = u.vendedor!;
  const aprovador = u.dono ?? u.gestor;
  const tracos = Object.fromEntries((await q('SELECT codigo, id FROM tracos WHERE empresa_id = $1', [e])).rows.map((t) => [t.codigo, t.id])) as Record<string, string>;
  const codigoDe = Object.fromEntries(Object.entries(tracos).map(([k, v]) => [v, k]));
  let numero = 0;
  const condicoes = ['28 dias no boleto', 'À vista no PIX', '30/60 dias', '21 dias no boleto'];

  // Vendas já entregues: as cargas dos últimos 75 dias, agrupadas por cliente, obra, traço e dia.
  const grupos = (
    await q(
      `SELECT c.cliente_id, c.obra, c.traco_id, (c.data_hora AT TIME ZONE 'America/Sao_Paulo')::date AS dia, min((c.data_hora AT TIME ZONE 'America/Sao_Paulo')::time) AS hora,
              sum(c.volume_m3) AS m3, bool_or(c.bomba_id IS NOT NULL) AS bomba, array_agg(c.id) AS ids
         FROM cargas c WHERE c.empresa_id = $1 AND c.status = 'produzida' AND c.cliente_id IS NOT NULL
          AND (c.data_hora AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2::date - 75 AND $2::date - 1
        GROUP BY 1, 2, 3, 4 ORDER BY 4, 5`,
      [e, hoje],
    )
  ).rows;
  for (const [i, g] of grupos.entries()) {
    numero++;
    const dia = g.dia instanceof Date ? g.dia.toISOString().slice(0, 10) : String(g.dia).slice(0, 10);
    // Dois terços das vendas são do vendedor; o resto, da gestora.
    const quem = i % 3 === 2 ? (u.gestor ?? vendedor) : vendedor;
    const preco = (PRECO_M3[codigoDe[g.traco_id]] ?? 470) + ((i * 7) % 4) * 5;
    const v = (
      await q(
        `INSERT INTO vendas (empresa_id, numero, vendedor_id, cliente_id, obra, traco_id, volume_m3, data_entrega, hora_entrega, bombeamento, preco_m3_centavos, taxa_bomba_centavos,
                             condicao_pagamento, status, enviado_aprovacao_em, aprovado_por_id, aprovado_em, criado_por_id, criado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'concluida',$8::date - 2 + time '10:00',$14,$8::date - 2 + time '15:30',$3,$8::date - 2 + time '09:20') RETURNING id`,
        [e, numero, quem, g.cliente_id, g.obra, g.traco_id, g.m3, dia, String(g.hora).slice(0, 5), g.bomba, preco * 100, g.bomba ? 65000 : null, condicoes[i % 4], aprovador],
      )
    ).rows[0];
    await q('UPDATE cargas SET venda_id = $1 WHERE id = ANY($2::uuid[])', [v.id, g.ids]);
  }

  // Próximas entregas e pendências.
  const clientes = (await q('SELECT id, razao_social FROM clientes WHERE empresa_id = $1 AND excluido_em IS NULL ORDER BY razao_social', [e])).rows as { id: string }[];
  const cl = (i: number) => clientes[i % clientes.length].id;
  const futuras: [dias: number, hora: string, cliente: number, obra: string, traco: string, m3: number, bomba: boolean, status: string, quem: 'v' | 'g', motivo?: string][] = [
    [0, '07:30', 0, 'Laje do 3º pavimento · Torre B', 'C30-S120-B1', 32, true, 'aprovada', 'v'],
    [0, '13:00', 2, 'Calçada e rampa de acesso', 'C20-S100-B1', 8, false, 'aprovada', 'g'],
    [1, '07:00', 1, 'Fundação · blocos e baldrames', 'C25-S100-B1', 24, false, 'aprovada', 'v'],
    [1, '14:00', 3, 'Piso do galpão 2', 'C30-S120-B1', 40, true, 'aprovada', 'v'],
    [3, '08:00', 4, 'Pilares do térreo', 'C35-S120-B1', 16, true, 'aprovada', 'g'],
    [2, '09:00', 5, 'Contrapiso das casas 12 a 18', 'C20-S100-B1', 18, false, 'aguardando_aprovacao', 'v'],
    [4, '07:30', 0, 'Laje do 4º pavimento · Torre B', 'C30-S120-B1', 34, true, 'aguardando_aprovacao', 'v'],
    [6, '08:00', 6, 'Muro de arrimo', 'C25-S160-B0', 12, true, 'rascunho', 'v'],
    [2, '10:00', 7, 'Reservatório elevado', 'C35-S120-B1', 10, true, 'reprovada', 'v', 'Preço abaixo da tabela para fck 35. Revise para R$ 545,00/m³.'],
  ];
  for (const [i, f] of futuras.entries()) {
    numero++;
    const quem = f[8] === 'g' ? (u.gestor ?? vendedor) : vendedor;
    const enviado = f[7] !== 'rascunho';
    const aprovado = f[7] === 'aprovada';
    const preco = f[9] ? 495 : PRECO_M3[f[4]] + (i % 2) * 10;
    await q(
      `INSERT INTO vendas (empresa_id, numero, vendedor_id, cliente_id, obra, endereco, contato, traco_id, volume_m3, data_entrega, hora_entrega, bombeamento, preco_m3_centavos,
                           taxa_bomba_centavos, condicao_pagamento, status, motivo, enviado_aprovacao_em, aprovado_por_id, aprovado_em, criado_por_id, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
               CASE WHEN $18 THEN now() - interval '1 day' + ($2 % 5) * interval '1 hour' END, $19, CASE WHEN $20 THEN now() - interval '20 hours' END, $3, now() - interval '30 hours')`,
      [e, numero, quem, cl(f[2]), f[3], `Quadra ${100 + i * 4}, lote ${3 + i} · Palmas/TO`, `Mestre de obras · (63) 9${8100 + i * 37}-${4400 + i * 91}`, tracos[f[4]], f[5],
        somarDias(hoje, f[0]), f[1], f[6], preco * 100, f[6] ? 65000 : null, condicoes[i % 4], f[7], f[9] ?? null, enviado, aprovado ? aprovador : null, aprovado],
    );
  }

  // Regras de produção da equipe (vigentes desde o início da demonstração).
  const desde = somarMeses(inicioMes(hoje), -6);
  const regras: [string, string, string, { ate: number | null; valorM3: number }[]][] = [
    ['operador_usina', 'usina', 'progressiva', [{ ate: 1000, valorM3: 200 }, { ate: null, valorM3: 150 }]],
    ['gestor_patio', 'usina', 'faixa', [{ ate: 1200, valorM3: 120 }, { ate: 1800, valorM3: 140 }, { ate: null, valorM3: 160 }]],
    ['vendedor', 'vendas', 'progressiva', [{ ate: 500, valorM3: 300 }, { ate: null, valorM3: 200 }]],
  ];
  for (const [funcao, base, modo, faixas] of regras) {
    await q('INSERT INTO regras_producao (empresa_id, funcao, base, modo, faixas, vigencia, criado_por_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      e, funcao, base, modo, JSON.stringify(faixas), desde, aprovador,
    ]);
  }
}

// ---------------------------------------------------------------- operação de campo e mural

async function popularCampo(c: C, e: string, hoje: string, u: { lab: string | null; operador: string | null; dono: string | null; gestor: string | null }): Promise<void> {
  const q = (sql: string, p: unknown[] = []) => c.query(sql, p);
  // Etapas do motorista e slump na obra nas cargas que já foram entregues (até 2 h atrás).
  await q(
    `UPDATE cargas c SET saida_em = c.data_hora + interval '6 minutes', chegada_em = c.data_hora + interval '38 minutes', descarga_em = c.data_hora + interval '74 minutes',
            slump_entrega_cm = greatest(2, coalesce(a.slump_cm, 10) - (1 + (c.numero % 3)) * 0.5)
       FROM amostras a WHERE a.carga_id = c.id AND c.empresa_id = $1 AND c.status = 'produzida' AND c.data_hora < now() - interval '2 hours'`,
    [e],
  );
  await q(`UPDATE cargas SET saida_em = data_hora + interval '6 minutes' WHERE empresa_id = $1 AND status = 'produzida' AND saida_em IS NULL AND data_hora < now() - interval '30 minutes'`, [e]);
  // Qualidade: CPs moldados na obra pelo motorista e recebidos no laboratório no dia seguinte.
  await q(
    `UPDATE amostras a SET moldada_em = c.data_hora + interval '74 minutes', data_moldagem = c.data_hora + interval '74 minutes', moldada_por_id = c.motorista_id,
            moldado_por = coalesce(m.nome, a.moldado_por), cps_moldados = (SELECT count(*) FROM corpos_prova cp WHERE cp.amostra_id = a.id),
            recebida_em = date_trunc('day', c.data_hora) + interval '1 day 11 hours', recebida_por_id = $2,
            confirmada_em = date_trunc('day', c.data_hora) + interval '1 day 11 hours', confirmada_por_id = $2
       FROM cargas c LEFT JOIN motoristas m ON m.id = c.motorista_id
      WHERE a.carga_id = c.id AND a.empresa_id = $1 AND a.status = 'ativa'`,
    [e, u.lab],
  );
  await q(`UPDATE cargas SET romaneio_impresso_em = data_hora - interval '4 minutes', etiquetas_impressas_em = data_hora - interval '3 minutes' WHERE empresa_id = $1 AND status = 'produzida'`, [e]);
  // Hoje: descarregadas → moldadas, aguardando o laboratório; ainda na obra → pendentes. Os CPs já existem (etiquetas impressas com o romaneio).
  await q(
    `UPDATE amostras a SET status = CASE WHEN c.descarga_em IS NOT NULL THEN 'moldada' ELSE 'pendente' END,
            recebida_em = NULL, recebida_por_id = NULL, confirmada_em = NULL, confirmada_por_id = NULL, temperatura_c = NULL,
            moldada_em = CASE WHEN c.descarga_em IS NOT NULL THEN c.descarga_em END, moldada_por_id = CASE WHEN c.descarga_em IS NOT NULL THEN c.motorista_id END,
            cps_moldados = CASE WHEN c.descarga_em IS NOT NULL THEN cps_moldados END
       FROM cargas c WHERE a.carga_id = c.id AND a.empresa_id = $1 AND (c.data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $2`,
    [e, hoje],
  );
  const ontem = (
    await q(
      `SELECT a.id FROM amostras a JOIN cargas c ON c.id = a.carga_id WHERE a.empresa_id = $1 AND (c.data_hora AT TIME ZONE 'America/Sao_Paulo')::date = $2::date - 1 ORDER BY c.data_hora DESC LIMIT 1`,
      [e, hoje],
    )
  ).rows[0];
  if (ontem) {
    await q(`UPDATE corpos_prova SET situacao = 'descartado', observacao = 'Não moldado na obra', resistencia_mpa = NULL, data_ruptura = NULL WHERE amostra_id = $1`, [ontem.id]);
    await q(`UPDATE amostras SET status = 'nao_amostrada', recebida_em = NULL, recebida_por_id = NULL, cps_moldados = 0, observacao = 'Concreto magro para regularização, sem moldagem (combinado com o cliente).' WHERE id = $1`, [ontem.id]);
  }

  // Vendas: condição de pagamento estruturada; as entregues ficam finalizadas, menos a última de ontem, que espera o vendedor.
  await q(
    `UPDATE vendas SET forma_pagamento = CASE WHEN condicao_pagamento ILIKE '%pix%' THEN 'pix' ELSE 'boleto' END,
            prazos_dias = CASE WHEN condicao_pagamento ILIKE '%vista%' THEN '{0}'::int[] WHEN condicao_pagamento LIKE '30/60%' THEN '{30,60}'::int[]
                               WHEN condicao_pagamento LIKE '21%' THEN '{21}'::int[] ELSE '{28}'::int[] END
      WHERE empresa_id = $1`,
    [e],
  );
  const aFaturar = (
    await q(`SELECT id FROM vendas WHERE empresa_id = $1 AND status = 'concluida' AND data_entrega = $2::date - 1 ORDER BY volume_m3 DESC LIMIT 1`, [e, hoje])
  ).rows[0];
  await q(`UPDATE vendas SET entrega_finalizada_em = data_entrega + time '18:00', entrega_finalizada_por_id = vendedor_id WHERE empresa_id = $1 AND status = 'concluida' AND id IS DISTINCT FROM $2`, [e, aFaturar?.id ?? null]);
  if (aFaturar) {
    await q(`UPDATE cargas SET carga_final = true WHERE id = (SELECT id FROM cargas WHERE venda_id = $1 AND status = 'produzida' ORDER BY data_hora DESC LIMIT 1)`, [aFaturar.id]);
    await q(`INSERT INTO vendas_adicionais (empresa_id, venda_id, tipo, descricao, valor_centavos, criado_por_id) SELECT $1, $2, 'hora_excedente', '1 h de espera da bomba além da franquia', 18000, vendedor_id FROM vendas WHERE id = $2`, [e, aFaturar.id]);
  }

  // Uma carga de agora para o motorista de exemplo, ligada à primeira entrega de hoje (ainda na central).
  const mot = (await q(`SELECT motorista_id FROM usuarios WHERE empresa_id = $1 AND email LIKE 'motorista@%'`, [e])).rows[0]?.motorista_id;
  const venda = (await q(`SELECT * FROM vendas WHERE empresa_id = $1 AND status = 'aprovada' AND data_entrega = $2 ORDER BY hora_entrega LIMIT 1`, [e, hoje])).rows[0];
  if (mot && venda) {
    const bet = (await q(`SELECT betoneira_id FROM cargas WHERE motorista_id = $1 ORDER BY data_hora DESC LIMIT 1`, [mot])).rows[0]?.betoneira_id
      ?? (await q(`SELECT id AS betoneira_id FROM veiculos WHERE empresa_id = $1 AND tipo = 'betoneira' ORDER BY codigo LIMIT 1`, [e])).rows[0].betoneira_id;
    const numero = Number((await q('SELECT coalesce(max(numero), 0) + 1 AS n FROM cargas WHERE empresa_id = $1', [e])).rows[0].n);
    const { gravarConsumoCarga } = await import('./estoque.ts');
    const { criarAmostraCarga } = await import('./qualidade.ts');
    for (const [k, minutos] of [[0, 95], [1, 12]] as const) {
      const quando = new Date(Date.now() - minutos * 60_000).toISOString();
      const x = (
        await q(
          `INSERT INTO cargas (empresa_id, numero, data_hora, traco_id, volume_m3, cliente_id, obra, betoneira_id, motorista_id, registrado_por_id, venda_id, criado_em,
                               saida_em, chegada_em, descarga_em, slump_entrega_cm)
           VALUES ($1,$2,$3,$4,8,$5,$6,$7,$8,$9,$10,$3,$11,$12,$13,$14) RETURNING id`,
          [e, numero + k, quando, venda.traco_id, venda.cliente_id, venda.obra, bet, mot, u.operador, venda.id,
            k === 0 ? new Date(Date.now() - 88 * 60_000).toISOString() : null, k === 0 ? new Date(Date.now() - 55 * 60_000).toISOString() : null,
            k === 0 ? new Date(Date.now() - 25 * 60_000).toISOString() : null, k === 0 ? 11.5 : null],
        )
      ).rows[0];
      await gravarConsumoCarga(c, x.id);
      await criarAmostraCarga(c, e, x.id, quando, 12);
      await q(`UPDATE cargas SET romaneio_impresso_em = $2, etiquetas_impressas_em = $2 WHERE id = $1`, [x.id, quando]);
      if (k === 0) {
        const { registrarMoldagemObra } = await import('./qualidade.ts');
        const nome = (await q('SELECT nome FROM motoristas WHERE id = $1', [mot])).rows[0]?.nome ?? 'Motorista';
        await registrarMoldagemObra(c, { cargaId: x.id, motoristaId: mot, motoristaNome: nome, cps: 4, motivo: null, quando: new Date(Date.now() - 25 * 60_000).toISOString() });
      }
    }
  }

  // Aniversariantes: datas de nascimento dos colaboradores; três fazem aniversário neste mês (um hoje).
  const pessoas = (await q('SELECT id FROM motoristas WHERE empresa_id = $1 ORDER BY nome', [e])).rows.map((x) => x.id as string);
  const mes = Number(hoje.slice(5, 7));
  for (const [i, id] of pessoas.entries()) {
    const ano = 1972 + ((i * 7) % 28);
    const noMes = i % 5 === 1;
    const m = noMes ? mes : ((mes + 1 + i) % 12) + 1;
    const dia = noMes && i === 1 ? Number(hoje.slice(8, 10)) : 1 + ((i * 11) % 27);
    await q('UPDATE motoristas SET data_nascimento = $2 WHERE id = $1', [id, `${ano}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`]);
  }

  // Mural.
  await q(`UPDATE empresas SET mural = $2 WHERE id = $1`, [e, JSON.stringify({ aniversariantes: true, ranking: true, rankings: ['motoristas_m3', 'bomba_m3', 'vendedores_m3'], posicoes: 5 })]);
  const avisos: [number, string, string, string[] | null, boolean, number | null][] = [
    [0, 'Uso obrigatório de EPI na usina', 'Capacete, botina e protetor auricular são obrigatórios na área da central dosadora e no pátio. A partir de segunda-feira, quem estiver sem EPI não carrega.', null, true, null],
    [1, 'Manutenção da central no sábado', 'A central para no sábado das 7h às 12h para troca das palhetas do misturador. Não programem entregas para esse horário.', ['vendedor', 'operador_usina', 'gestor'], false, 5],
    [3, 'Slump na obra pelo aplicativo', 'Motoristas: ao terminar a descarga, registrem no app o slump medido na obra e o concreto que voltou. Isso entra na rastreabilidade de cada carga.', ['motorista'], false, null],
    [6, 'Meta do mês: 1.500 m³', 'Estamos a caminho! Confiram o ranking de produção no mural. Obrigado pelo empenho de todos.', null, false, null],
  ];
  for (const [dias, titulo, texto, perfis, fixado, validade] of avisos) {
    await q(
      `INSERT INTO avisos (empresa_id, titulo, texto, perfis, fixado, ate, criado_por_id, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7, now() - $8::int * interval '1 day')`,
      [e, titulo, texto, perfis, fixado, validade === null ? null : somarDias(hoje, validade), dias % 2 ? u.gestor : u.dono, dias],
    );
  }
}

// ---------------------------------------------------------------- suprimentos

async function popularSuprimentos(
  c: C,
  e: string,
  hoje: string,
  x: { dono: string; gestor: string; forn: Record<string, string>; insumo: Record<string, string>; cnpjDe: (raiz: string) => string; centro: Record<string, string> },
): Promise<void> {
  const q = (sql: string, p: unknown[] = []) => c.query(sql, p);
  const um = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows[0];
  const usina = x.centro['Usina'] ?? null;
  let nPedido = 0;
  const novoPedido = async (d: { data: string; forn: string; status: string; previsao: string | null; cond: string; aprovado?: boolean; cotacao?: string | null; solicitacao?: string | null; frete?: number; enviadoAprovacao?: string | null; enviado?: boolean; obs?: string | null }) =>
    (await um(
      `INSERT INTO pedidos_compra (empresa_id, numero, data, fornecedor_id, cotacao_id, solicitacao_id, previsao_entrega, condicao_pagamento, local_entrega, frete_centavos, centro_custo_id,
                                   observacao, status, enviado_aprovacao_em, aprovado_por_id, aprovado_em, enviado_fornecedor_em, criado_por_id, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Usina · Palmas',$9,$10,$11,$12,$13,$14,$15,$16,$17,$3::date + time '08:30') RETURNING id`,
      [e, ++nPedido, d.data, d.forn, d.cotacao ?? null, d.solicitacao ?? null, d.previsao, d.cond, d.frete ?? 0, usina, d.obs ?? null, d.status,
        d.enviadoAprovacao ?? `${d.data} 08:40`, d.aprovado === false ? null : x.dono, d.aprovado === false ? null : `${d.data} 09:15`,
        d.enviado ? `${d.data} 09:30` : null, x.gestor],
    )).id as string;
  const itemPedido = async (pedido: string, insumoId: string | null, desc: string, un: string, qtd: number, precoCentavos: number) =>
    (await um(
      `INSERT INTO pedidos_itens (empresa_id, pedido_id, insumo_id, descricao, unidade, quantidade, preco_unitario_centavos) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [e, pedido, insumoId, desc, un, qtd, precoCentavos],
    )).id as string;
  const fecharTotal = (pedido: string) =>
    q(`UPDATE pedidos_compra p SET total_centavos = p.frete_centavos + coalesce((SELECT round(sum(round(pi.quantidade * pi.preco_unitario_centavos))) FROM pedidos_itens pi WHERE pi.pedido_id = p.id), 0) WHERE p.id = $1`, [pedido]);

  // Pedidos das notas de cimento, brita e areia dos últimos 2 meses: emitidos 3 a 5 dias antes da nota, aprovados pelo dono e recebidos.
  const notas = (await q(
    `SELECT n.id, n.data_emissao::text AS data, n.fornecedor_id, ni.id AS item_id, ni.insumo_id, ni.quantidade, ni.fator_estoque, ni.valor_produto_centavos, i.nome, i.unidade
       FROM notas_fiscais n JOIN notas_itens ni ON ni.nota_id = n.id JOIN insumos i ON i.id = ni.insumo_id
      WHERE n.empresa_id = $1 AND n.fornecedor_id = ANY($2::uuid[]) AND n.data_emissao >= $3::date AND n.status = 'confirmada'
      ORDER BY n.data_emissao, n.numero`,
    [e, [x.forn.cimento, x.forn.brita, x.forn.areia], somarMeses(hoje, -2)],
  )).rows;
  let divergente = false;
  for (const n of notas) {
    const qtd = Math.round(Number(n.quantidade) * Number(n.fator_estoque ?? 1));
    const precoNota = Number(n.valor_produto_centavos) / qtd;
    // Uma entrega de brita veio 3% mais cara que o pedido, para aparecer nas divergências.
    const marcarDivergencia = !divergente && n.fornecedor_id === x.forn.brita && n.data > somarDias(hoje, -30);
    if (marcarDivergencia) divergente = true;
    const preco = Math.round((marcarDivergencia ? precoNota / 1.03 : precoNota) * 10000) / 10000;
    const pedidoData = somarDias(n.data, n.fornecedor_id === x.forn.cimento ? -3 : -5);
    const p = await novoPedido({ data: pedidoData, forn: n.fornecedor_id, status: 'recebido', previsao: n.data, cond: n.fornecedor_id === x.forn.cimento ? '28 dias boleto' : '21 dias boleto', enviado: true });
    const pi = await itemPedido(p, n.insumo_id, n.nome, n.unidade, qtd, preco);
    await fecharTotal(p);
    await q('UPDATE notas_fiscais SET pedido_id = $2 WHERE id = $1', [n.id, p]);
    await q('UPDATE notas_itens SET pedido_item_id = $2, quantidade_pedido = $3 WHERE id = $1', [n.item_id, pi, qtd]);
  }

  // Dois fornecedores a mais para a cotação (fictícios).
  const forte = (await um(
    `INSERT INTO fornecedores (empresa_id, categoria, tipo_pessoa, cnpj_cpf, razao_social, nome_fantasia, ramo, cidade, uf)
     VALUES ($1,'fornecedor','PJ',$2,'Cimento Forte Distribuidora Ltda','Cimento Forte','Cimento e aditivos','Paraíso do Tocantins','TO') RETURNING id`,
    [e, x.cnpjDe('50617283')],
  )).id as string;
  const lajeado = (await um(
    `INSERT INTO fornecedores (empresa_id, categoria, tipo_pessoa, cnpj_cpf, razao_social, nome_fantasia, ramo, cidade, uf)
     VALUES ($1,'fornecedor','PJ',$2,'Mineração Serra do Lajeado Ltda','Pedreira Lajeado','Brita','Palmas','TO') RETURNING id`,
    [e, x.cnpjDe('61728394')],
  )).id as string;

  // Solicitação do estoque mínimo → cotação concluída → pedidos.
  const cim = x.insumo['Cimento CP II-F 40'];
  const adi = x.insumo['Aditivo plastificante polifuncional'];
  const dSol = somarDias(hoje, -9);
  const sol1 = (await um(
    `INSERT INTO solicitacoes_compra (empresa_id, numero, data, necessidade, origem, centro_custo_id, observacao, status, solicitante_id, criado_em)
     VALUES ($1,1,$2,$3,'estoque_minimo',$4,'Reposição dos silos e do tanque de aditivo.','atendida',$5,$2::date + time '07:50') RETURNING id`,
    [e, dSol, somarDias(dSol, 7), usina, x.gestor],
  )).id as string;
  const siCim = (await um(`INSERT INTO solicitacoes_itens (empresa_id, solicitacao_id, insumo_id, descricao, unidade, quantidade) VALUES ($1,$2,$3,'Cimento CP II-F 40','kg',70000) RETURNING id`, [e, sol1, cim])).id;
  const siAdi = (await um(`INSERT INTO solicitacoes_itens (empresa_id, solicitacao_id, insumo_id, descricao, unidade, quantidade) VALUES ($1,$2,$3,'Aditivo plastificante polifuncional','L',3000) RETURNING id`, [e, sol1, adi])).id;
  const dCot = somarDias(dSol, 1);
  const cot = (await um(
    `INSERT INTO cotacoes (empresa_id, numero, data, prazo_resposta, solicitacao_id, observacao, justificativa, status, criado_por_id, concluida_em, criado_em)
     VALUES ($1,1,$2,$3,$4,'Entrega na usina, descarga por conta do fornecedor.','Cimento pelo menor preço. Aditivo mantido com o fornecedor atual.','concluida',$5,$3::date + time '16:00',$2::date + time '08:10') RETURNING id`,
    [e, dCot, somarDias(dCot, 2), sol1, x.gestor],
  )).id as string;
  const ciCim = (await um(`INSERT INTO cotacoes_itens (empresa_id, cotacao_id, solicitacao_item_id, insumo_id, descricao, unidade, quantidade) VALUES ($1,$2,$3,$4,'Cimento CP II-F 40','kg',70000) RETURNING id`, [e, cot, siCim, cim])).id;
  const ciAdi = (await um(`INSERT INTO cotacoes_itens (empresa_id, cotacao_id, solicitacao_item_id, insumo_id, descricao, unidade, quantidade) VALUES ($1,$2,$3,$4,'Aditivo plastificante polifuncional','L',3000) RETURNING id`, [e, cot, siAdi, adi])).id;
  const cf = async (forn: string, prazo: number, cond: string, frete: number) =>
    (await um(`INSERT INTO cotacoes_fornecedores (empresa_id, cotacao_id, fornecedor_id, prazo_entrega_dias, condicao_pagamento, frete_centavos, validade) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [e, cot, forn, prazo, cond, frete, somarDias(dCot, 10)])).id as string;
  const cfCerrado = await cf(x.forn.cimento, 3, '28 dias boleto', 0);
  const cfForte = await cf(forte, 5, '21 dias boleto', 85000);
  const cfQuim = await cf(x.forn.aditivo, 4, '28 dias boleto', 0);
  const preco = (cfId: string, item: string, centavos: number) =>
    q('INSERT INTO cotacoes_precos (empresa_id, cotacao_fornecedor_id, cotacao_item_id, preco_unitario_centavos) VALUES ($1,$2,$3,$4)', [e, cfId, item, centavos]);
  await preco(cfCerrado, ciCim, 57.5);
  await preco(cfForte, ciCim, 58.9);
  await preco(cfForte, ciAdi, 505);
  await preco(cfQuim, ciAdi, 520);
  await q('UPDATE cotacoes_itens SET vencedor_id = $2 WHERE id = $1', [ciCim, cfCerrado]);
  await q("UPDATE cotacoes_itens SET vencedor_id = $2, justificativa = 'Aditivo homologado pelo laboratório; trocar exige novo ensaio de dosagem.' WHERE id = $1", [ciAdi, cfQuim]);
  const dPed = somarDias(dCot, 2);
  // Cimento: aprovado e enviado, entrega prevista há 2 dias (atrasado).
  const pCim = await novoPedido({ data: dPed, forn: x.forn.cimento, status: 'enviado', previsao: somarDias(hoje, -2), cond: '28 dias boleto', cotacao: cot, solicitacao: sol1, enviado: true });
  await itemPedido(pCim, cim, 'Cimento CP II-F 40', 'kg', 70000, 57.5);
  await fecharTotal(pCim);
  // Aditivo: aguardando a aprovação do dono (aparece no painel).
  const pAdi = await novoPedido({ data: dPed, forn: x.forn.aditivo, status: 'aguardando_aprovacao', previsao: somarDias(hoje, 3), cond: '28 dias boleto', cotacao: cot, solicitacao: sol1, aprovado: false, enviadoAprovacao: `${somarDias(hoje, -1)} 14:20` });
  await itemPedido(pAdi, adi, 'Aditivo plastificante polifuncional', 'L', 3000, 520);
  await fecharTotal(pAdi);
  await q("UPDATE pedidos_itens SET cotacao_item_id = $2 WHERE pedido_id = $1", [pCim, ciCim]);
  await q("UPDATE pedidos_itens SET cotacao_item_id = $2 WHERE pedido_id = $1", [pAdi, ciAdi]);

  // Peças de manutenção: pedido direto aguardando aprovação.
  const pPecas = await novoPedido({ data: somarDias(hoje, -1), forn: x.forn.pecas, status: 'aguardando_aprovacao', previsao: somarDias(hoje, 4), cond: '30 dias boleto', aprovado: false, enviadoAprovacao: `${hoje} 08:05`, obs: 'Para a revisão das betoneiras BT-03 e BT-05.' });
  await itemPedido(pPecas, null, 'Óleo lubrificante 15W40 (balde 20 L)', 'un', 6, 41500);
  await itemPedido(pPecas, null, 'Graxa de chassi (balde 20 kg)', 'un', 2, 38900);
  await fecharTotal(pPecas);

  // Solicitação aberta (manual) e uma cotação aberta de brita com uma resposta.
  const sol2 = (await um(
    `INSERT INTO solicitacoes_compra (empresa_id, numero, data, necessidade, origem, centro_custo_id, observacao, status, solicitante_id, criado_em)
     VALUES ($1,2,$2,$3,'manual',$4,'Material de consumo da usina.','aberta',$5,$2::date + time '10:15') RETURNING id`,
    [e, somarDias(hoje, -2), somarDias(hoje, 5), usina, x.gestor],
  )).id as string;
  await q(`INSERT INTO solicitacoes_itens (empresa_id, solicitacao_id, descricao, unidade, quantidade, observacao) VALUES ($1,$2,'Lona plástica preta 4×50 m','un',2,'Cobrir as baias de areia'), ($1,$2,'Desmoldante para formas (bombona 50 L)','un',4,NULL)`, [e, sol2]);
  const sol3 = (await um(
    `INSERT INTO solicitacoes_compra (empresa_id, numero, data, necessidade, origem, centro_custo_id, status, solicitante_id, criado_em)
     VALUES ($1,3,$2,$3,'manual',$4,'em_cotacao',$5,$2::date + time '09:00') RETURNING id`,
    [e, somarDias(hoje, -1), somarDias(hoje, 10), usina, x.gestor],
  )).id as string;
  const siBrita = (await um(`INSERT INTO solicitacoes_itens (empresa_id, solicitacao_id, insumo_id, descricao, unidade, quantidade) VALUES ($1,$2,$3,'Brita 1','kg',120000) RETURNING id`, [e, sol3, x.insumo['Brita 1']])).id;
  const cot2 = (await um(
    `INSERT INTO cotacoes (empresa_id, numero, data, prazo_resposta, solicitacao_id, status, criado_por_id, criado_em) VALUES ($1,2,$2,$3,$4,'aberta',$5,$2::date + time '11:00') RETURNING id`,
    [e, somarDias(hoje, -1), somarDias(hoje, 1), sol3, x.gestor],
  )).id as string;
  const ciBrita = (await um(`INSERT INTO cotacoes_itens (empresa_id, cotacao_id, solicitacao_item_id, insumo_id, descricao, unidade, quantidade) VALUES ($1,$2,$3,$4,'Brita 1','kg',120000) RETURNING id`, [e, cot2, siBrita, x.insumo['Brita 1']])).id;
  const cfAzul = (await um(`INSERT INTO cotacoes_fornecedores (empresa_id, cotacao_id, fornecedor_id, prazo_entrega_dias, condicao_pagamento) VALUES ($1,$2,$3,2,'21 dias boleto') RETURNING id`, [e, cot2, x.forn.brita])).id;
  await q('INSERT INTO cotacoes_fornecedores (empresa_id, cotacao_id, fornecedor_id) VALUES ($1,$2,$3)', [e, cot2, lajeado]);
  await q('INSERT INTO cotacoes_precos (empresa_id, cotacao_fornecedor_id, cotacao_item_id, preco_unitario_centavos) VALUES ($1,$2,$3,4.46)', [e, cfAzul, ciBrita]);
}

// ---------------------------------------------------------------- contratos

async function popularContratos(
  c: C,
  e: string,
  hoje: string,
  x: { dono: string; gestor: string; cnpjDe: (raiz: string) => string; centro: Record<string, string>; banco: string },
): Promise<void> {
  const q = (sql: string, p: unknown[] = []) => c.query(sql, p);
  const um = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows[0];
  const plano = async (codigo: string) => (await um('SELECT id FROM plano_contas WHERE empresa_id = $1 AND codigo = $2', [e, codigo])).id as string;
  const forn = async (raiz: string, razao: string, fantasia: string, ramo: string, pix: string) =>
    (await um(
      `INSERT INTO fornecedores (empresa_id, categoria, tipo_pessoa, cnpj_cpf, razao_social, nome_fantasia, ramo, cidade, uf, chave_pix)
       VALUES ($1,'fornecedor','PJ',$2,$3,$4,$5,'Palmas','TO',$6) RETURNING id`,
      [e, x.cnpjDe(raiz), razao, fantasia, ramo, pix],
    )).id as string;
  const eletromec = await forn('72839405', 'Eletromec Manutenção Industrial Ltda', 'Eletromec', 'Manutenção industrial', 'financeiro@eletromec.test');
  const guardiao = await forn('83940516', 'Guardião Serviços de Portaria Ltda', 'Guardião Portaria', 'Portaria e vigilância', '83.940.516/0001-00');
  const inicio = `${somarMeses(hoje, -3).slice(0, 7)}-01`;
  const fimMes = (d: string) => somarDias(somarMeses(`${d.slice(0, 7)}-01`, 1), -1);
  let nMed = 0;
  let nAut = 0;

  // Contrato por itens, com caução e impostos retidos.
  const k1 = (await um(
    `INSERT INTO contratos (empresa_id, numero, fornecedor_id, objeto, tipo, data_assinatura, inicio, fim, plano_conta_id, centro_custo_id, prazo_pagamento_dias, forma_pagamento,
                            caucao_pct, iss_pct, inss_pct, status, observacao, criado_por_id, criado_em)
     VALUES ($1,1,$2,'Manutenção preventiva e corretiva da central dosadora','itens',$3,$3,$4,$5,$6,15,'pix',5,3,11,'vigente',
             'Atendimento em até 4 h para parada da central. Peças por conta da contratante.',$7,$3::date + time '09:00') RETURNING *`,
    [e, eletromec, inicio, somarDias(somarMeses(inicio, 12), -1), await plano('3.6'), x.centro['Usina'] ?? null, x.gestor],
  ));
  const itens: { id: string; preco: number; mensal: number[] }[] = [];
  for (const [ordem, desc, un, quantidade, preco, mensal] of [
    [1, 'Visita preventiva mensal (checklist da central)', 'un', 12, 1850, [1, 1, 1]],
    [2, 'Hora técnica corretiva (mecânico/eletricista)', 'h', 120, 145, [6, 14, 9]],
    [3, 'Recuperação de palhetas do misturador', 'vb', 2, 6800, [0, 1, 0]],
  ] as [number, string, string, number, number, number[]][]) {
    const it = await um('INSERT INTO contratos_itens (empresa_id, contrato_id, ordem, descricao, unidade, quantidade, preco_unitario_centavos) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [e, k1.id, ordem, desc, un, quantidade, preco * 100]);
    itens.push({ id: it.id, preco: preco * 100, mensal });
  }
  for (let m = 0; m < 3; m++) {
    const ini = `${somarMeses(inicio, m).slice(0, 7)}-01`;
    const fim = fimMes(ini);
    if (fim >= hoje) break;
    const aprovada = m < 2;
    const med = await um(
      `INSERT INTO medicoes (empresa_id, numero, contrato_id, sequencia, periodo_inicio, periodo_fim, data, status, enviado_aprovacao_em, aprovado_por_id, aprovado_em, criado_por_id, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7::date + time '10:00',$9,$10,$11,$7::date + time '09:30') RETURNING id`,
      [e, ++nMed, k1.id, m + 1, ini, fim, somarDias(fim, 2), aprovada ? 'aprovada' : 'aguardando_aprovacao', aprovada ? x.dono : null, aprovada ? `${somarDias(fim, 3)} 08:40` : null, x.gestor],
    );
    let total = 0;
    for (const it of itens) {
      const qq = it.mensal[m];
      if (!qq) continue;
      const v = Math.round(qq * it.preco);
      total += v;
      await q('INSERT INTO medicoes_itens (empresa_id, medicao_id, contrato_item_id, quantidade, valor_centavos) VALUES ($1,$2,$3,$4,$5)', [e, med.id, it.id, qq, v]);
    }
    await q('UPDATE medicoes SET valor_centavos = $2 WHERE id = $1', [med.id, total]);
    if (!aprovada) continue;
    const r = (p: number) => Math.round((total * p) / 100);
    const ret = { caucao: r(5), iss: r(3), inss: r(11) };
    const liquido = total - ret.caucao - ret.iss - ret.inss;
    const dAut = somarDias(fim, 4);
    const aut = await um(
      `INSERT INTO autorizacoes_pagamento (empresa_id, numero, tipo, contrato_id, medicao_id, data, vencimento, bruto_centavos, caucao_centavos, iss_centavos, inss_centavos, liquido_centavos,
                                           documento, forma_pagamento, status, enviado_aprovacao_em, aprovado_por_id, aprovado_em, criado_por_id, criado_em)
       VALUES ($1,$2,'medicao',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pix','aprovada',$5::date + time '09:00',$13,$5::date + time '11:20',$14,$5::date + time '09:00') RETURNING id`,
      [e, ++nAut, k1.id, med.id, dAut, somarDias(dAut, 15), total, ret.caucao, ret.iss, ret.inss, liquido, `NFS-e ${2210 + m}`, x.dono, x.gestor],
    );
    await gerarContasAPagar(c, e, aut.id, x.dono);
    // O que já venceu foi pago (prestador e impostos).
    {
      await q(
        `UPDATE parcelas p SET status = 'paga', data_pagamento = a.vencimento, valor_pago_centavos = p.valor_centavos, conta_financeira_id = $2, forma_pagamento = 'pix', baixado_por_id = $3
           FROM autorizacoes_pagamento a WHERE a.id = $1 AND p.lancamento_id IN (a.lancamento_id, a.lancamento_impostos_id) AND p.vencimento < $4`,
        [aut.id, x.banco, x.gestor, hoje],
      );
    }
  }

  // Contrato global (portaria): uma medição aprovada com a autorização aguardando o dono.
  const k2 = (await um(
    `INSERT INTO contratos (empresa_id, numero, fornecedor_id, objeto, tipo, data_assinatura, inicio, fim, valor_global_centavos, plano_conta_id, centro_custo_id, prazo_pagamento_dias,
                            forma_pagamento, iss_pct, status, criado_por_id, criado_em)
     VALUES ($1,2,$2,'Portaria e vigilância noturna da usina (12 meses)','global',$3,$3,$4,$5,$6,$7,10,'boleto',5,'vigente',$8,$3::date + time '09:00') RETURNING *`,
    [e, guardiao, `${somarMeses(hoje, -1).slice(0, 7)}-01`, somarDias(somarMeses(`${somarMeses(hoje, -1).slice(0, 7)}-01`, 12), -1), 9_840_000, await plano('6.8'), x.centro['Administrativo'] ?? null, x.gestor],
  ));
  const iniG = k2.inicio as string;
  const fimG = fimMes(iniG);
  if (fimG < hoje) {
    const med = await um(
      `INSERT INTO medicoes (empresa_id, numero, contrato_id, sequencia, periodo_inicio, periodo_fim, data, valor_centavos, status, enviado_aprovacao_em, aprovado_por_id, aprovado_em, criado_por_id)
       VALUES ($1,$2,$3,1,$4,$5,$6,820000,'aprovada',$6::date + time '10:00',$7,$6::date + time '15:00',$8) RETURNING id`,
      [e, ++nMed, k2.id, iniG, fimG, somarDias(fimG, 1), x.dono, x.gestor],
    );
    await q('INSERT INTO medicoes_itens (empresa_id, medicao_id, contrato_item_id, quantidade, valor_centavos) VALUES ($1,$2,NULL,0,820000)', [e, med.id]);
    await q(
      `INSERT INTO autorizacoes_pagamento (empresa_id, numero, tipo, contrato_id, medicao_id, data, vencimento, bruto_centavos, iss_centavos, liquido_centavos, documento, forma_pagamento,
                                           status, enviado_aprovacao_em, criado_por_id)
       VALUES ($1,$2,'medicao',$3,$4,$5,$6,820000,41000,779000,'NFS-e 587','boleto','aguardando_aprovacao',$7,$8)`,
      [e, ++nAut, k2.id, med.id, somarDias(hoje, -1), somarDias(hoje, 9), `${somarDias(hoje, -1)} 16:10`, x.gestor],
    );
  }
}

// ---------------------------------------------------------------- catálogo de materiais e serviços

async function popularCatalogo(c: C, e: string): Promise<void> {
  const q = (sql: string, p: unknown[] = []) => c.query(sql, p);
  const plano = async (codigo: string) => (await q('SELECT id FROM plano_contas WHERE empresa_id = $1 AND codigo = $2', [e, codigo])).rows[0]?.id ?? null;
  const ITENS: ['material' | 'servico', string, string, string, string][] = [
    ['material', 'M-0001', 'Óleo lubrificante 15W40 (balde 20 L)', 'un', '4.4'],
    ['material', 'M-0002', 'Graxa de chassi (balde 20 kg)', 'un', '4.4'],
    ['material', 'M-0003', 'Lona plástica preta 4×50 m', 'un', '3.6'],
    ['material', 'M-0004', 'Desmoldante para formas (bombona 50 L)', 'un', '3.6'],
    ['material', 'M-0005', 'Filtro de ar do motor (betoneira)', 'un', '4.2'],
    ['material', 'M-0006', 'Mangueira de bomba 4" (3 m)', 'un', '4.2'],
    ['material', 'M-0007', 'Molde cilíndrico para corpo de prova 10×20 cm', 'un', '3.7'],
    ['servico', 'S-0001', 'Visita preventiva mensal (checklist da central)', 'un', '3.6'],
    ['servico', 'S-0002', 'Hora técnica corretiva (mecânico/eletricista)', 'h', '3.6'],
    ['servico', 'S-0003', 'Recuperação de palhetas do misturador', 'vb', '3.6'],
    ['servico', 'S-0004', 'Portaria e vigilância (mês)', 'mês', '6.8'],
    ['servico', 'S-0005', 'Hora de pá carregadeira com operador', 'h', '4.8'],
  ];
  for (const [tipo, codigo, descricao, unidade, pc] of ITENS)
    await q('INSERT INTO catalogo_itens (empresa_id, tipo, codigo, descricao, unidade, plano_conta_id) VALUES ($1,$2,$3,$4,$5,$6)', [e, tipo, codigo, descricao, unidade, await plano(pc)]);
  // Liga o que já foi solicitado, cotado, pedido e contratado aos itens do catálogo, pela descrição.
  for (const t of ['solicitacoes_itens', 'cotacoes_itens', 'pedidos_itens', 'contratos_itens'])
    await q(`UPDATE ${t} x SET catalogo_id = ct.id FROM catalogo_itens ct WHERE x.empresa_id = $1 AND ct.empresa_id = $1 AND lower(ct.descricao) = lower(x.descricao)${t === 'contratos_itens' ? '' : ' AND x.insumo_id IS NULL'}`, [e]);
  await q(
    `UPDATE catalogo_itens ct SET ultimo_preco_centavos = u.preco, ultimo_preco_em = u.data, ultimo_fornecedor_id = u.fornecedor
       FROM (SELECT * FROM (SELECT DISTINCT ON (pi.catalogo_id) pi.catalogo_id, pi.preco_unitario_centavos AS preco, p.data, p.fornecedor_id AS fornecedor
                              FROM pedidos_itens pi JOIN pedidos_compra p ON p.id = pi.pedido_id
                             WHERE p.empresa_id = $1 AND pi.catalogo_id IS NOT NULL AND p.status IN ('aprovado', 'enviado', 'parcial', 'recebido', 'encerrado')
                             ORDER BY pi.catalogo_id, p.data DESC) a
             UNION ALL
             SELECT * FROM (SELECT DISTINCT ON (ci.catalogo_id) ci.catalogo_id, ci.preco_unitario_centavos, coalesce(k.data_assinatura, k.inicio) AS data, k.fornecedor_id
                              FROM contratos_itens ci JOIN contratos k ON k.id = ci.contrato_id
                             WHERE k.empresa_id = $1 AND ci.catalogo_id IS NOT NULL AND k.status = 'vigente'
                             ORDER BY ci.catalogo_id, 3 DESC) b) u
      WHERE ct.id = u.catalogo_id`,
    [e],
  );
}

// ---------------------------------------------------------------- nota lida do PDF

/** Uma NF-e de areia "importada do PDF" pelo leitor do Agrega, esperando conferência. */
async function popularNotaPdf(c: C, e: string, hoje: string, usuarioId: string | null): Promise<void> {
  if (!usuarioId) return;
  const empresa = (await c.query('SELECT cnpj, razao_social FROM empresas WHERE id = $1', [e])).rows[0];
  const cnpjEmpresa = String(empresa?.cnpj ?? '').replace(/\D/g, '');
  const forn = cnpjDe('22975318');
  const emissao = somarDias(hoje, -1);
  const numero = 20417;
  const chave = chaveNfe(emissao, forn, numero, 4417);
  const pdf = gerarDanfeExemplo({
    chave, numero, serie: 1, emissao,
    emitente: { nome: 'AREIAL RIO TOCANTINS LTDA', cnpj: forn, endereco: 'ROD. TO-010, KM 8 - ZONA RURAL - PALMAS - TO' },
    destinatario: { nome: String(empresa?.razao_social ?? 'CONCRETEIRA MODELO LTDA').toUpperCase(), cnpj: cnpjEmpresa || '11222333000181' },
    natureza: 'VENDA DE PRODUÇÃO DO ESTABELECIMENTO',
    itens: [
      { codigo: 'AR-02', descricao: 'AREIA MEDIA LAVADA', ncm: '25051000', cfop: '5101', unidade: 'M3', quantidade: 120, unitario: 92, total: 11040 },
      { codigo: 'AR-05', descricao: 'AREIA FINA LAVADA', ncm: '25051000', cfop: '5101', unidade: 'M3', quantidade: 30, unitario: 88.5, total: 2655 },
    ],
    frete: 480, desconto: 0,
    duplicatas: [{ numero: '001', vencimento: somarDias(emissao, 30), valor: 14175 }],
    informacoes: 'Pedido 318. Entrega na usina. Documento de demonstração.',
  });
  const lida = interpretarNotaPdf(lerPdf(pdf), { cnpjEmpresa });
  await criarNotaLida(c, {
    empresaId: e, usuarioId, cnpjEmpresa, lida, origem: 'pdf', metodo: 'leitor',
    anexo: { nome: `danfe-${numero}-areial.pdf`, tipo: 'application/pdf', conteudo: pdf }, substituir: null,
  });
}
