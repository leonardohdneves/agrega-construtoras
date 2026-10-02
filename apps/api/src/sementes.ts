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

/** Frota de exemplo (10 betoneiras, 2 bombas, motoristas e documentos), só se a Concreteira Exemplo ainda não tiver veículos. */
export async function garantirFrotaDemo(banco: Banco, log = console.log): Promise<void> {
  const e = (await banco.query('SELECT id FROM empresas WHERE cnpj = $1', [CNPJ_DEMO])).rows[0];
  if (!e) return;
  const tem = await banco.query('SELECT 1 FROM veiculos WHERE empresa_id = $1 LIMIT 1', [e.id]);
  if (tem.rowCount) return;

  const hoje = new Date();
  const dia = (n: number) => new Date(hoje.getTime() + n * 86_400_000).toISOString().slice(0, 10);

  await emTransacao(banco, async (c) => {
    const placas = ['RXA1B23', 'RXA2C34', 'RXA3D45', 'RXB4E56', 'RXB5F67', 'RXC6G78', 'RXC7H89', 'RXD8J90', 'RXD9K01', 'RXE0L12'];
    const ids: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      const codigo = `BET-${String(i + 1).padStart(2, '0')}`;
      const status = i === 4 ? 'manutencao' : i === 8 ? 'parado' : 'disponivel';
      const r = await c.query(
        `INSERT INTO veiculos (empresa_id, codigo, tipo, placa, marca_modelo, ano, capacidade_m3, km_atual, horimetro_atual, status)
         VALUES ($1, $2, 'betoneira', $3, 'Caminhão 6x4 com balão 8 m³', $4, 8, $5, $6, $7) RETURNING id`,
        [e.id, codigo, placas[i], 2016 + (i % 7), 95000 + i * 7350, 4800 + i * 310, status],
      );
      ids[codigo] = r.rows[0].id;
    }
    for (const [codigo, tipo, placa, alcance] of [
      ['BOM-01', 'bomba_lanca', 'RXF1M23', 36],
      ['BOM-02', 'bomba_lanca', 'RXF2N34', 42],
    ] as const) {
      const r = await c.query(
        `INSERT INTO veiculos (empresa_id, codigo, tipo, placa, marca_modelo, ano, alcance_lanca_m, km_atual, horimetro_atual)
         VALUES ($1, $2, $3, $4, 'Caminhão com bomba lança', 2020, $5, 61000, 3900) RETURNING id`,
        [e.id, codigo, tipo, placa, alcance],
      );
      ids[codigo] = r.rows[0].id;
    }

    // Documentos: a maioria em dia; alguns vencendo e um vencido para mostrar os alertas.
    const docs: [string, string, string, number | null][] = [];
    for (const codigo of Object.keys(ids)) {
      docs.push([codigo, 'licenciamento', dia(60 + Object.keys(ids).indexOf(codigo) * 9), 18500]);
      docs.push([codigo, 'seguro', dia(120 + Object.keys(ids).indexOf(codigo) * 5), 640000]);
    }
    docs.push(['BOM-02', 'tacografo', dia(5), 32000]);
    docs.push(['BET-07', 'ipva', dia(-3), 412000]);
    docs.push(['BET-03', 'licenciamento', dia(18), 18500]);
    for (const [codigo, tipo, vencimento, valor] of docs) {
      await c.query(
        `INSERT INTO documentos_veiculo (empresa_id, veiculo_id, tipo, vencimento, valor_centavos) VALUES ($1, $2, $3, $4, $5)`,
        [e.id, ids[codigo], tipo, vencimento, valor],
      );
    }

    const motoristas: [string, string, string, number][] = [
      ['Motorista Exemplo', 'motorista', 'E', 400],
      ['Carlos Alberto (exemplo)', 'motorista', 'E', 12],
      ['João Batista (exemplo)', 'motorista', 'D', 210],
      ['Pedro Henrique (exemplo)', 'operador_bomba', 'D', 95],
      ['Antônio Silva (exemplo)', 'motorista_operador', 'E', -10],
    ];
    for (const [nome, funcao, cat, dias] of motoristas) {
      const m = await c.query(
        `INSERT INTO motoristas (empresa_id, nome, funcao, cnh_categoria, cnh_vencimento) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [e.id, nome, funcao, cat, dia(dias)],
      );
      if (nome === 'Motorista Exemplo') {
        await c.query(`UPDATE usuarios SET motorista_id = $1 WHERE empresa_id = $2 AND email = 'motorista@demo.agrega.test'`, [m.rows[0].id, e.id]);
      }
    }
  });
  log('Frota de exemplo criada na Concreteira Exemplo.');
}
