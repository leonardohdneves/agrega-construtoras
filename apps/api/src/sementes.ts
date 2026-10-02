// Dados iniciais: administrador do sistema (sempre que configurado) e, no ambiente de teste,
// a empresa de demonstração (Concreteira Modelo) com um usuário de cada perfil.
import type { Banco } from './db.ts';
import { emTransacao } from './db.ts';
import { gerarHashSenha } from './lib/senha.ts';
import { CNPJ_DEMO, USUARIOS_DEMO } from './lib/demo.ts';

export async function garantirAdmin(banco: Banco, email: string, senha: string, log = console.log): Promise<void> {
  if (!email || !senha) return;
  const existe = await banco.query('SELECT 1 FROM usuarios WHERE lower(email) = lower($1) AND excluido_em IS NULL', [email]);
  if (existe.rowCount) return;
  await banco.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil) VALUES (NULL, 'Administrador', $1, $2, 'admin_sistema')`, [
    email.toLowerCase(),
    await gerarHashSenha(senha),
  ]);
  log('Administrador do sistema criado.');
}

export async function garantirDemo(banco: Banco, senha: string, log = console.log): Promise<void> {
  if (!senha) {
    log('SEED_DEMO ativo, mas DEMO_SENHA não foi definida: dados de exemplo não criados.');
    return;
  }
  const existe = await banco.query('SELECT 1 FROM empresas WHERE cnpj = $1', [CNPJ_DEMO]);
  if (existe.rowCount) return;
  const hash = await gerarHashSenha(senha);
  await emTransacao(banco, async (c) => {
    const e = (
      await c.query(
        `INSERT INTO empresas (razao_social, nome_fantasia, cnpj, regime_tributario, aliquotas_dre, cidade, uf, plano)
         VALUES ('Concreteira Exemplo Ltda', 'Concreteira Exemplo', $1, 'simples', '{"simples": 9}', 'Palmas', 'TO', 'demonstracao')
         RETURNING id`,
        [CNPJ_DEMO],
      )
    ).rows[0];
    for (const u of USUARIOS_DEMO) {
      await c.query('INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4, $5)', [e.id, u.nome, u.email, hash, u.perfil]);
    }
  });
  log('Concreteira Exemplo criada com dono, gestor e motorista.');
}

/**
 * Conteúdo da demonstração (Concreteira Modelo). Quando VERSAO_DEMO muda, apaga os dados da empresa de
 * demonstração e recria tudo; usuários e senhas continuam os mesmos. Outras empresas não são tocadas.
 */
export async function garantirConteudoDemo(banco: Banco, log = console.log): Promise<void> {
  const { VERSAO_DEMO, limparEmpresa, popularDemo } = await import('./lib/demo-modelo.ts');
  const { hojeBrasil } = await import('./lib/frota.ts');
  const e = (await banco.query('SELECT id FROM empresas WHERE cnpj = $1', [CNPJ_DEMO])).rows[0];
  if (!e) return;
  const versao = async (c: { query: Banco['query'] }) =>
    (await c.query("SELECT valor FROM marcas_sistema WHERE chave = 'demo_versao'")).rows[0]?.valor as string | undefined;
  if ((await versao(banco)) === VERSAO_DEMO) return;
  const inicio = Date.now();
  await emTransacao(banco, async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(727275)');
    if ((await versao(c as never)) === VERSAO_DEMO) return;
    await limparEmpresa(c, e.id);
    await popularDemo(c, e.id, hojeBrasil());
    await c.query(
      `INSERT INTO marcas_sistema (chave, valor) VALUES ('demo_versao', $1)
       ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = now()`,
      [VERSAO_DEMO],
    );
  });
  log(`Demonstração recriada (Concreteira Modelo, ${VERSAO_DEMO}) em ${Math.round((Date.now() - inicio) / 1000)} s.`);
}
