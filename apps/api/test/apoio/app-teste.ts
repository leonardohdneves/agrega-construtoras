// Apoio aos testes de rota: sobe o app de verdade (criarApp) contra um Postgres de teste, num esquema próprio,
// com as migrações aplicadas, duas empresas (A e B) e um usuário de cada perfil em cada uma.
//
// Só roda com TEST_DATABASE_URL definida; sem ela, `semBanco` traz o motivo para usar em `test(..., { skip: semBanco })`.
// Exemplo:
//   const ctx = await prepararAppTeste('teste_rotas');
//   const r = await ctx.pedir('gestor', 'GET', '/api/fin/lancamentos');   // empresa A
//   const r2 = await ctx.pedir('dono', 'GET', '/api/eng/obras', { empresa: 'b' });
//   await ctx.fechar();
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { criarApp } from '../../src/app.ts';
import { aplicarMigracoes } from '../../src/migrar.ts';
import { COOKIE_SESSAO, criarTokenSessao } from '../../src/sessao.ts';
import { PERFIS_EMPRESA } from '../../src/lib/perfis.ts';
import { MODULOS } from '../../src/lib/modulos.ts';

export const URL_TESTE = process.env.TEST_DATABASE_URL ?? '';
export const semBanco: string | false = URL_TESTE ? false : 'defina TEST_DATABASE_URL para rodar os testes com banco';

export type PerfilEmpresa = (typeof PERFIS_EMPRESA)[number];
export type Letra = 'a' | 'b';
export type UsuarioTeste = { id: string; token: string };

export type ContextoTeste = {
  app: FastifyInstance;
  banco: pg.Pool;
  empresas: Record<Letra, string>;
  usuarios: Record<Letra, Record<PerfilEmpresa, UsuarioTeste>>;
  admin: UsuarioTeste;
  /** Chama a API como o perfil indicado (empresa A, a menos que `empresa: 'b'`). Perfil null = sem sessão. */
  pedir: (
    perfil: PerfilEmpresa | 'admin_sistema' | null,
    metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    opcoes?: { empresa?: Letra; corpo?: unknown; via?: 'bearer' | 'cookie' },
  ) => Promise<{ status: number; corpo: any }>;
  fechar: () => Promise<void>;
};

const CNPJ: Record<Letra, string> = { a: '11222333000181', b: '45723174000110' };

/** Recria o esquema `esquema` do zero e sobe o app. Cada arquivo de teste usa um esquema diferente. */
export async function prepararAppTeste(esquema: string): Promise<ContextoTeste> {
  if (!URL_TESTE) throw new Error('TEST_DATABASE_URL não definida.');
  if (!/^[a-z_][a-z0-9_]*$/.test(esquema)) throw new Error(`Nome de esquema inválido: ${esquema}`);
  const ssl = /sslmode=require/.test(URL_TESTE) ? { rejectUnauthorized: false } : undefined;
  const banco = new pg.Pool({ connectionString: URL_TESTE, max: 4, ssl, options: `-c search_path=${esquema},public` });
  await banco.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE; CREATE SCHEMA ${esquema}`);
  await aplicarMigracoes(banco, () => {});

  const um = async (sql: string, p: unknown[]) => (await banco.query(sql, p)).rows[0].id as string;
  // O hash não importa: os testes entram pelo token, sem passar pelo login.
  const HASH = 'scrypt$16384$8$1$AAAA$AAAA';

  const empresas = {} as Record<Letra, string>;
  const usuarios = {} as Record<Letra, Record<PerfilEmpresa, UsuarioTeste>>;
  for (const letra of ['a', 'b'] as const) {
    const empresaId = await um(
      `INSERT INTO empresas (razao_social, cnpj, contrato_pacote, modulos_contratados) VALUES ($1, $2, 'completo', $3) RETURNING id`,
      [`Construtora ${letra.toUpperCase()}`, CNPJ[letra], [...MODULOS]],
    );
    empresas[letra] = empresaId;
    usuarios[letra] = {} as Record<PerfilEmpresa, UsuarioTeste>;
    for (const perfil of PERFIS_EMPRESA) {
      const id = await um(
        `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [empresaId, `${perfil} ${letra.toUpperCase()}`, `${perfil}@${letra}.teste`, HASH, perfil],
      );
      usuarios[letra][perfil] = { id, token: criarTokenSessao({ id, empresaId, perfil }) };
    }
  }
  const adminId = await um(
    `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil) VALUES (NULL, 'Admin', 'admin@sistema.teste', $1, 'admin_sistema') RETURNING id`,
    [HASH],
  );
  const admin = { id: adminId, token: criarTokenSessao({ id: adminId, empresaId: null, perfil: 'admin_sistema' }) };

  // TEST_LOG=1 mostra o log do app (útil para ver o erro por trás de um 500).
  const app = await criarApp(banco, { log: process.env.TEST_LOG === '1' });
  await app.ready();

  const pedir: ContextoTeste['pedir'] = async (perfil, metodo, url, opcoes = {}) => {
    const u = perfil === null ? null : perfil === 'admin_sistema' ? admin : usuarios[opcoes.empresa ?? 'a'][perfil];
    const headers: Record<string, string> = {};
    if (u) {
      if (opcoes.via === 'cookie') headers.cookie = `${COOKIE_SESSAO}=${u.token}`;
      else headers.authorization = `Bearer ${u.token}`;
    }
    const r = await app.inject({ method: metodo, url, headers, ...(opcoes.corpo === undefined ? {} : { payload: opcoes.corpo as object }) });
    let corpo: unknown = r.body;
    try {
      corpo = r.json();
    } catch {
      /* resposta sem JSON (ex.: arquivo) */
    }
    return { status: r.statusCode, corpo };
  };

  return {
    app,
    banco,
    empresas,
    usuarios,
    admin,
    pedir,
    fechar: async () => {
      await app.close();
      await banco.query(`DROP SCHEMA IF EXISTS ${esquema} CASCADE`);
      await banco.end();
    },
  };
}
