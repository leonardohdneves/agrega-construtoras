// Concreteira Modelo: empresa fictícia do ambiente de teste, usada em demonstrações para clientes.
// Seis betoneiras e duas bombas, com seis meses de histórico coerente entre frota, notas e financeiro.
// Tudo é gerado a partir da data de hoje com um sorteio de semente fixa: o mesmo dia gera os mesmos dados.
import type pg from 'pg';
import { somarDias, somarMeses } from './financeiro.ts';
import { normalizar } from './sugestoes.ts';

type C = pg.PoolClient;

/** Mude este valor para o ambiente de teste apagar e recriar a demonstração na próxima inicialização. */
export const VERSAO_DEMO = 'modelo-2026-10-v2';

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
  await c.query('UPDATE notas_fiscais SET lancamento_id = NULL WHERE empresa_id = $1', [empresaId]);
  await c.query('UPDATE lancamentos SET nota_id = NULL, recorrencia_pai_id = NULL WHERE empresa_id = $1', [empresaId]);
  for (const t of [
    'extrato_linhas', 'extratos_ofx', 'escalas', 'cargas', 'tracos_itens', 'tracos', 'insumos', 'valores_producao', 'anexos', 'abastecimentos', 'os_itens', 'apropriacoes', 'revisoes_veiculo', 'ordens_servico', 'parcelas',
    'transferencias', 'notas_duplicatas', 'notas_itens', 'regras_apropriacao', 'notas_fiscais', 'lancamentos', 'documentos_veiculo',
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
  for (const [p, nome] of [['dono@', 'Roberto Almeida'], ['gestor@', 'Juliana Freitas'], ['motorista@', 'Carlos Pereira'], ['operador@', 'Sérgio Nunes']]) {
    await q('UPDATE usuarios SET nome = $3 WHERE empresa_id = $1 AND email LIKE $2', [e, `${p}%`, nome]);
  }

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
    abastecimentos?: { id: string; veiculo: string; valor: number }[]; osItens?: string[] };
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
                                  plano_conta_id, centro_custo_id, veiculo_id, sugestao)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,'regra') RETURNING id`,
        [e, n.id, j + 1, String(100 + j), i.desc, i.ncm, i.cfop, i.un, i.qtd, i.valor, plano[i.codigo], centro[i.centro], i.veiculo ? veic[i.veiculo] : null],
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
    ['C20-S100-B1', 'Concreto convencional fck 20', 20, '10 ± 2', 'Brita 1', [250, 820, 1000, 0, 190, 1.8]],
    ['C25-S100-B1', 'Concreto convencional fck 25', 25, '10 ± 2', 'Brita 1', [275, 800, 1010, 0, 185, 2.1]],
    ['C30-S120-B1', 'Concreto bombeável fck 30', 30, '12 ± 2', 'Brita 1', [310, 770, 1020, 0, 180, 2.5]],
    ['C35-S120-B1', 'Concreto bombeável fck 35', 35, '12 ± 2', 'Brita 1', [345, 740, 1030, 0, 178, 2.9]],
    ['C25-S160-B0', 'Concreto bombeável fck 25 com brita 0', 25, '16 ± 2', 'Brita 0', [300, 880, 0, 900, 195, 2.6]],
  ];
  const traco: Record<string, string> = {};
  for (const [codigo, descricao, fck, slump, brita, qtds] of TRACOS) {
    traco[codigo] = (await um(`INSERT INTO tracos (empresa_id, codigo, descricao, fck, slump, brita) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [e, codigo, descricao, fck, slump, brita])).id;
    for (const [j, qtd] of qtds.entries()) {
      if (qtd > 0) await q('INSERT INTO tracos_itens (empresa_id, traco_id, insumo_id, quantidade) VALUES ($1,$2,$3,$4)', [e, traco[codigo], insumo[INSUMOS[j][0]], qtd]);
    }
  }
  cargasDemo.sort((a, b) => a.dataHora.localeCompare(b.dataHora));
  for (const [i, x] of cargasDemo.entries()) {
    const motorista = rc() < 0.08 ? motoristas[8] : motoristaDo[x.betoneira] ?? null;
    await q(
      `INSERT INTO cargas (empresa_id, numero, data_hora, traco_id, volume_m3, cliente_id, obra, betoneira_id, motorista_id, bomba_id, operador_bomba_id,
                           volume_bombeado_m3, devolvido_m3, registrado_por_id, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$3)`,
      [e, 10001 + i, x.dataHora, traco[x.traco], x.m3, cli[x.cliente], x.obra, veic[x.betoneira], motorista, x.bomba ? veic[x.bomba] : null,
        x.bomba ? motoristaDo[x.bomba] : null, x.bombeado, x.devolvido, usuario('operador@') ?? gestor],
    );
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

  // ----- insumos da usina
  for (const s of volumeSemana) {
    const t = Math.round(s.m3 * 0.275 * 10) / 10;
    await notaCompra('cimento', s.sexta, [{ desc: 'CIMENTO CP II-F 40 GRANEL', ncm: '25232910', cfop: '5101', un: 'T', qtd: t, valor: cents(t * 575), codigo: '3.1', centro: 'Usina' }],
      [{ venc: util(somarDias(s.sexta, 28)), valor: 0 }]);
  }
  for (const [de, ate] of quinzenas) {
    if (ate > ontem) continue;
    const m3 = volumeSemana.filter((s) => s.sexta >= de && s.sexta <= ate).reduce((a, s) => a + s.m3, 0);
    if (!m3) continue;
    const brita = Math.round(m3 * 0.78);
    const areia = Math.round(m3 * 0.62);
    await notaCompra('brita', ate, [{ desc: 'BRITA 1', ncm: '25171000', cfop: '5101', un: 'M3', qtd: brita, valor: cents(brita * 58), codigo: '3.3', centro: 'Usina' }],
      [{ venc: util(somarDias(ate, 21)), valor: 0 }]);
    await notaCompra('areia', ate, [{ desc: 'AREIA MEDIA LAVADA', ncm: '25059000', cfop: '5102', un: 'M3', qtd: areia, valor: cents(areia * 46), codigo: '3.2', centro: 'Usina' }],
      [{ venc: util(somarDias(ate, 21)), valor: 0 }]);
  }
  const meses: string[] = [];
  for (let m = inicio; m <= hoje; m = somarMeses(m, 1)) meses.push(m);
  const fechados = meses.filter((m) => fimMes(m) < hoje);
  const volumeMes = (m: string) => volumeSemana.filter((s) => s.sexta.slice(0, 7) === m.slice(0, 7)).reduce((a, s) => a + s.m3, 0);
  for (const m of fechados) {
    const litros = Math.round(volumeMes(m) * 2.1);
    await notaCompra('aditivo', fimMes(m), [{ desc: 'ADITIVO PLASTIFICANTE POLIFUNCIONAL', ncm: '38244000', cfop: '5101', un: 'L', qtd: litros, valor: cents(litros * 5.2), codigo: '3.4', centro: 'Usina' }],
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
