// Backup do sistema: gera o pacote (JSON por tabela + manifesto) e, para a exportação da empresa, também a planilha .xlsx.
import { createHash } from 'node:crypto';
import type { Banco, Cliente } from '../db.ts';
import { criarZip, type ArquivoZip } from './zip.ts';
import { criarXlsx, type Aba } from './xlsx.ts';

/** Tabelas que não entram no backup: controle de migrações e o próprio registro dos backups. */
const FORA = new Set(['migracoes', 'backups']);
/** Colunas que nunca saem numa exportação da empresa (credenciais). */
const OCULTAS_NA_EXPORTACAO: Record<string, string[]> = { usuarios: ['senha_hash'] };
const NUMERICOS = new Set(['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision']);
const VERSAO_FORMATO = 1;

type Coluna = { nome: string; tipo: string };
type Fk = { coluna: string; tabelaPai: string; colunaPai: string };
export type Esquema = Map<string, { colunas: Coluna[]; fks: Fk[] }>;

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const sha = (d: Buffer) => createHash('sha256').update(d).digest('hex');

export async function lerEsquema(c: Cliente): Promise<Esquema> {
  const colunas = (
    await c.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    )
  ).rows;
  const fks = (
    await c.query<{ tabela: string; coluna: string; tabela_pai: string; coluna_pai: string }>(
      `SELECT kcu.table_name AS tabela, kcu.column_name AS coluna, ccu.table_name AS tabela_pai, ccu.column_name AS coluna_pai
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
    )
  ).rows;
  const esquema: Esquema = new Map();
  for (const r of colunas) {
    const t = esquema.get(r.table_name) ?? { colunas: [], fks: [] };
    t.colunas.push({ nome: r.column_name, tipo: r.data_type });
    esquema.set(r.table_name, t);
  }
  for (const f of fks) {
    const t = esquema.get(f.tabela);
    if (t && f.tabela !== f.tabela_pai) t.fks.push({ coluna: f.coluna, tabelaPai: f.tabela_pai, colunaPai: f.coluna_pai });
  }
  return esquema;
}

/**
 * Condição SQL (com $1 = id da empresa) que escolhe as linhas da tabela que pertencem à empresa.
 * Tabela com empresa_id: direto. Senão, segue uma chave estrangeira até uma tabela que tenha a empresa.
 */
export function condicaoEmpresa(tabela: string, esquema: Esquema, profundidade = 0): string | null {
  if (tabela === 'empresas') return `"id" = $1`;
  const t = esquema.get(tabela);
  if (!t || profundidade > 6) return null;
  if (t.colunas.some((c) => c.nome === 'empresa_id')) return `"empresa_id" = $1`;
  for (const fk of t.fks) {
    const sub = condicaoEmpresa(fk.tabelaPai, esquema, profundidade + 1);
    if (sub) return `${q(fk.coluna)} IN (SELECT ${q(fk.colunaPai)} FROM ${q(fk.tabelaPai)} WHERE ${sub})`;
  }
  return null;
}

type Tabela = { nome: string; colunas: string[]; numericas: boolean[]; binarias: boolean[]; linhas: Record<string, unknown>[] };

async function lerTabela(c: Cliente, nome: string, esquema: Esquema, empresaId?: string): Promise<Tabela> {
  const meta = esquema.get(nome)!;
  const ocultas = empresaId ? OCULTAS_NA_EXPORTACAO[nome] ?? [] : [];
  const colunas = meta.colunas.filter((col) => !ocultas.includes(col.nome));
  const lista = colunas.map((col) => q(col.nome)).join(', ');
  let sql = `SELECT ${lista} FROM ${q(nome)}`;
  const params: unknown[] = [];
  if (empresaId) {
    const cond = condicaoEmpresa(nome, esquema);
    if (!cond) return { nome, colunas: [], numericas: [], binarias: [], linhas: [] };
    sql += ` WHERE ${cond}`;
    params.push(empresaId);
  }
  const linhas = ((await c.query(sql, params)).rows as Record<string, unknown>[]).map((l) => {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(l)) saida[k] = Buffer.isBuffer(v) ? `\\x${v.toString('hex')}` : v; // bytea no formato do PostgreSQL
    return saida;
  });
  return {
    nome,
    colunas: colunas.map((col) => col.nome),
    numericas: colunas.map((col) => NUMERICOS.has(col.tipo)),
    binarias: colunas.map((col) => col.tipo === 'bytea'),
    linhas,
  };
}

export type ResumoTabela = { nome: string; registros: number; sha256: string; arquivo: string };
export type Pacote = { zip: Buffer; registros: number; tabelas: ResumoTabela[]; tipo: 'completo' | 'empresa' };

/** Backup completo do sistema (todas as empresas). */
export async function gerarBackupCompleto(c: Cliente, agora = new Date()): Promise<Pacote> {
  return montar(c, agora, { tipo: 'completo' });
}

/** Exportação de uma empresa: só os dados dela, sem senhas, em XLSX (uma aba por tabela) e JSON. */
export async function gerarExportacaoEmpresa(c: Cliente, empresa: { id: string; nome: string }, agora = new Date()): Promise<Pacote> {
  return montar(c, agora, { tipo: 'empresa', empresa });
}

async function montar(
  c: Cliente,
  agora: Date,
  alvo: { tipo: 'completo' } | { tipo: 'empresa'; empresa: { id: string; nome: string } },
): Promise<Pacote> {
  const esquema = await lerEsquema(c);
  const nomes = [...esquema.keys()].filter((n) => !FORA.has(n)).sort();
  const empresaId = alvo.tipo === 'empresa' ? alvo.empresa.id : undefined;
  const tabelas: Tabela[] = [];
  for (const nome of nomes) {
    const t = await lerTabela(c, nome, esquema, empresaId);
    if (alvo.tipo === 'empresa' && !condicaoEmpresa(nome, esquema)) continue;
    tabelas.push(t);
  }

  const arquivos: ArquivoZip[] = [];
  const resumo: ResumoTabela[] = [];
  let registros = 0;
  for (const t of tabelas) {
    const json = Buffer.from(JSON.stringify(t.linhas), 'utf8');
    const arquivo = alvo.tipo === 'completo' ? `dados/${t.nome}.json` : `json/${t.nome}.json`;
    arquivos.push({ nome: arquivo, dados: json });
    resumo.push({ nome: t.nome, registros: t.linhas.length, sha256: sha(json), arquivo });
    registros += t.linhas.length;
  }

  const manifesto = {
    formato: VERSAO_FORMATO,
    sistema: 'Agrega',
    tipo: alvo.tipo,
    geradoEm: agora.toISOString(),
    ...(alvo.tipo === 'empresa' ? { empresa: alvo.empresa } : {}),
    registros,
    tabelas: resumo,
  };
  arquivos.unshift({ nome: 'manifesto.json', dados: Buffer.from(JSON.stringify(manifesto, null, 2), 'utf8') });
  arquivos.unshift({ nome: 'LEIA-ME.txt', dados: Buffer.from(textoLeiaMe(alvo.tipo), 'utf8') });

  if (alvo.tipo === 'empresa') {
    const abas: Aba[] = [
      {
        nome: 'Leia-me',
        colunas: ['Aba', 'Registros', 'O que contém'],
        linhas: resumo.map((r) => [r.nome, r.registros, descricaoTabela(r.nome)]),
        numericas: [false, true, false],
      },
      ...tabelas.map((t) => ({
        nome: t.nome,
        colunas: t.colunas,
        linhas: t.linhas.map((l, _i) => t.colunas.map((col, i) => (t.binarias[i] && typeof l[col] === 'string' ? '(arquivo binário)' : (l[col] ?? null)))),
        numericas: t.numericas,
      })),
    ];
    arquivos.push({ nome: 'planilha.xlsx', dados: criarXlsx(abas) });
  }

  return { zip: criarZip(arquivos, agora), registros, tabelas: resumo, tipo: alvo.tipo };
}

function textoLeiaMe(tipo: 'completo' | 'empresa') {
  if (tipo === 'empresa') {
    return [
      'Exportação de dados da empresa (Agrega).',
      '',
      'planilha.xlsx: uma aba por tabela do sistema. A aba "Leia-me" resume o conteúdo.',
      'json/: os mesmos dados em JSON, um arquivo por tabela.',
      'manifesto.json: data da geração, quantidade de registros e verificação (sha256) de cada arquivo.',
      '',
      'As senhas dos usuários não são exportadas.',
      'Esta exportação não serve para restaurar o sistema. Para isso, use o backup completo.',
    ].join('\n');
  }
  return [
    'Backup completo do sistema Agrega (todas as empresas).',
    '',
    'dados/: um arquivo JSON por tabela.',
    'manifesto.json: data da geração, quantidade de registros e verificação (sha256) de cada arquivo.',
    '',
    'Para restaurar: descompacte o arquivo, rode as migrações num banco vazio e depois',
    'o script de restauração (apps/api/scripts/restaurar-backup.ts), informando a pasta descompactada.',
    '',
    'Este arquivo contém dados sensíveis (inclusive credenciais dos usuários). Guarde com cuidado.',
  ].join('\n');
}

const DESCRICOES: Record<string, string> = {
  empresas: 'Dados da empresa e configuração fiscal',
  usuarios: 'Usuários e perfis (sem senhas)',
  obras: 'Obras e suas configurações',
  obra_itens: 'Insumos e serviços copiados para cada obra',
  orcamento_itens: 'Quantidades do orçamento por tarefa',
  eap_nos: 'Estrutura analítica do projeto (etapas, subetapas e tarefas)',
  orcamento_versoes: 'Versões salvas do orçamento, com preços e BDI do momento',
  auditoria: 'Registro de alterações feitas no sistema',
};
function descricaoTabela(nome: string) {
  return DESCRICOES[nome] ?? '';
}

/** Ordem de restauração: pais antes de filhos (ciclos entre tabelas são quebrados na ordem alfabética). */
export function ordemRestauracao(esquema: Esquema): string[] {
  const feitas: string[] = [];
  const pendentes = new Set(esquema.keys());
  while (pendentes.size) {
    const pronta = [...pendentes].sort().find((t) => esquema.get(t)!.fks.every((f) => f.tabelaPai === t || !pendentes.has(f.tabelaPai)));
    const escolhida = pronta ?? [...pendentes].sort()[0]!;
    feitas.push(escolhida);
    pendentes.delete(escolhida);
  }
  return feitas;
}

export type RegistroBackup = { id: string; criado_em: Date; tipo: string; status: string; tamanho_bytes: string | null; registros: number | null; tabelas: number | null; chave: string | null; erro: string | null };

export async function listarBackups(banco: Banco): Promise<RegistroBackup[]> {
  return (await banco.query<RegistroBackup>('SELECT id, criado_em, tipo, status, tamanho_bytes, registros, tabelas, chave, erro FROM backups ORDER BY criado_em DESC LIMIT 200')).rows;
}

export { sha };
