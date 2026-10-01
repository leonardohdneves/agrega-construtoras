// Dados iniciais: administrador do sistema (sempre que configurado) e, no ambiente de teste,
// a Concreteira Exemplo com um usuário de cada perfil.
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
