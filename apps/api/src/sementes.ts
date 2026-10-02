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

/** Histórico de 45 dias de abastecimentos da frota de exemplo, só se ainda não houver nenhum. */
export async function garantirAbastecimentosDemo(banco: Banco, log = console.log): Promise<void> {
  const e = (await banco.query('SELECT id FROM empresas WHERE cnpj = $1', [CNPJ_DEMO])).rows[0];
  if (!e) return;
  const tem = await banco.query('SELECT 1 FROM abastecimentos WHERE empresa_id = $1 LIMIT 1', [e.id]);
  if (tem.rowCount) return;
  const veiculos = (await banco.query(`SELECT id, codigo, tipo, km_atual, horimetro_atual FROM veiculos WHERE empresa_id = $1 AND excluido_em IS NULL AND status <> 'inativo' ORDER BY codigo`, [e.id])).rows;
  const motoristas = (await banco.query('SELECT id FROM motoristas WHERE empresa_id = $1 AND ativo ORDER BY nome', [e.id])).rows.map((m) => m.id);
  if (!veiculos.length) return;

  // Gerador pseudoaleatório fixo, para os dados de exemplo serem sempre iguais.
  let semente = 20261002;
  const aleatorio = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
  const entre = (a: number, b: number) => a + (b - a) * aleatorio();

  await emTransacao(banco, async (c) => {
    for (const v of veiculos) {
      const bomba = String(v.tipo).startsWith('bomba');
      // Monta do mais recente para o mais antigo, partindo da leitura atual do veículo.
      const registros: { dias: number; litros: number; km: number; hor: number }[] = [];
      let km = Number(v.km_atual);
      let hor = Number(v.horimetro_atual);
      let dias = entre(0.3, 1.5);
      while (dias < 45) {
        const horas = bomba ? entre(9, 12) : entre(12.5, 15.5);
        const kmRodado = bomba ? entre(25, 60) : entre(320, 410);
        let litros = bomba ? horas * entre(6.2, 7.0) : kmRodado / entre(2.05, 2.3);
        // BET-03: último abastecimento com consumo bem pior, para mostrar o alerta.
        if (v.codigo === 'BET-03' && registros.length === 0) litros = kmRodado / 1.75;
        registros.push({ dias, litros: Math.round(litros * 10) / 10, km: Math.round(km), hor: Math.round(hor * 10) / 10 });
        km -= kmRodado;
        hor -= horas;
        dias += bomba ? entre(1.5, 3) : entre(1.8, 2.6);
      }
      for (const r of registros) {
        const preco = entre(6.15, 6.35);
        await c.query(
          `INSERT INTO abastecimentos (empresa_id, veiculo_id, motorista_id, data_hora, litros, valor_total_centavos, km, horimetro, origem, posto)
           VALUES ($1, $2, $3, now() - make_interval(secs => $4), $5, $6, $7, $8, 'posto', 'Posto Exemplo')`,
          [e.id, v.id, motoristas.length ? motoristas[Math.floor(aleatorio() * motoristas.length)] : null, Math.round(r.dias * 86400), r.litros, Math.round(r.litros * preco * 100), r.km, r.hor],
        );
      }
    }
  });
  log('Abastecimentos de exemplo criados (45 dias).');
}

/** Fornecedores, credores, colaboradores, plano de manutenção e ordens de serviço de exemplo. */
export async function garantirManutencaoDemo(banco: Banco, log = console.log): Promise<void> {
  const e = (await banco.query('SELECT id FROM empresas WHERE cnpj = $1', [CNPJ_DEMO])).rows[0];
  if (!e) return;
  const tem = await banco.query('SELECT 1 FROM planos_manutencao WHERE empresa_id = $1 LIMIT 1', [e.id]);
  if (tem.rowCount) return;
  const { PLANO_PADRAO } = await import('./lib/manutencao.ts');

  await emTransacao(banco, async (c) => {
    const forn: Record<string, string> = {};
    const lista: [string, string, string, string, string][] = [
      ['fornecedor', 'Oficina Diesel Exemplo Ltda', 'Oficina Diesel Exemplo', 'Oficina mecânica', '11444777000161'],
      ['fornecedor', 'Posto Exemplo Combustíveis Ltda', 'Posto Exemplo', 'Combustível', '45723174000110'],
      ['fornecedor', 'Pedreira Exemplo Ltda', 'Pedreira Exemplo', 'Brita e areia', '07526557000100'],
      ['fornecedor', 'Cimento Exemplo S.A.', 'Cimento Exemplo', 'Cimento', '33000167000101'],
      ['fornecedor', 'Auto Peças Exemplo Ltda', 'Auto Peças Exemplo', 'Peças', '60746948000112'],
      ['credor', 'Banco Exemplo S.A.', 'Banco Exemplo · financiamento', 'Financiamento de veículos', '90400888000142'],
      ['credor', 'Prefeitura Municipal (exemplo)', 'Prefeitura · ISS', 'Tributos', ''],
    ];
    for (const [cat, razao, fantasia, ramo, doc] of lista) {
      const r = await c.query(
        `INSERT INTO fornecedores (empresa_id, categoria, razao_social, nome_fantasia, ramo, cnpj_cpf, cidade, uf) VALUES ($1,$2,$3,$4,$5,$6,'Palmas','TO') RETURNING id`,
        [e.id, cat, razao, fantasia, ramo, doc || null],
      );
      forn[fantasia] = r.rows[0].id;
    }
    await c.query(`UPDATE abastecimentos SET fornecedor_id = $2 WHERE empresa_id = $1 AND posto = 'Posto Exemplo'`, [e.id, forn['Posto Exemplo']]);

    // Colaboradores fora da frota.
    for (const [nome, funcao, cargo] of [
      ['Rita Souza (exemplo)', 'administrativo', 'Assistente financeiro'],
      ['Marcos Lima (exemplo)', 'operador_usina', 'Operador da central dosadora'],
      ['Paulo Reis (exemplo)', 'mecanico', 'Mecânico de manutenção'],
    ]) {
      await c.query(`INSERT INTO motoristas (empresa_id, nome, funcao, cargo, data_admissao) VALUES ($1,$2,$3,$4, current_date - 400)`, [e.id, nome, funcao, cargo]);
    }

    // Plano padrão.
    const planos: Record<string, { id: string; km?: number; horas?: number; dias?: number; tipo: string | null }> = {};
    for (const p of PLANO_PADRAO) {
      const r = await c.query(
        `INSERT INTO planos_manutencao (empresa_id, tipo_veiculo, item, intervalo_km, intervalo_horas, intervalo_dias) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [e.id, p.tipo, p.item, p.km ?? null, p.horas ?? null, p.dias ?? null],
      );
      planos[p.item] = { id: r.rows[0].id, km: p.km, horas: p.horas, dias: p.dias, tipo: p.tipo };
    }

    // Última execução de cada item: a maioria em dia, alguns perto de vencer e poucos vencidos.
    const veiculos = (await c.query(`SELECT id, codigo, tipo, km_atual, horimetro_atual FROM veiculos WHERE empresa_id = $1 AND excluido_em IS NULL AND status <> 'inativo' ORDER BY codigo`, [e.id])).rows;
    let k = 0;
    for (const v of veiculos) {
      for (const [item, p] of Object.entries(planos)) {
        if (p.tipo && p.tipo !== v.tipo) continue;
        k++;
        // Fração do intervalo já usada: 30% a 85%, com alguns casos próximos (93%) e vencidos (105%).
        const fracao = k % 11 === 0 ? 1.05 : k % 7 === 0 ? 0.93 : 0.3 + ((k * 37) % 55) / 100;
        const km = p.km ? Math.round(Number(v.km_atual) - p.km * fracao) : null;
        const horas = p.horas ? Math.round(Number(v.horimetro_atual) - p.horas * fracao) : null;
        const dias = p.dias ? Math.round(p.dias * fracao) : Math.round(60 * fracao);
        await c.query(
          `INSERT INTO revisoes_veiculo (empresa_id, veiculo_id, plano_id, ultima_km, ultima_horas, ultima_data) VALUES ($1,$2,$3,$4,$5, current_date - $6::int)`,
          [e.id, v.id, p.id, km, horas, dias],
        );
        void item;
      }
    }

    // Ordens de serviço: uma aberta (BET-05 na oficina) e algumas concluídas com custo.
    const id = (codigo: string) => veiculos.find((v) => v.codigo === codigo)?.id;
    const oleo = planos['Troca de óleo do motor e filtro de óleo'].id;
    const ordens: { codigo: string; tipo: string; desc: string; abre: number; fecha: number | null; itens: [string, string, number, number, string | null][] }[] = [
      { codigo: 'BET-05', tipo: 'corretiva', desc: 'Vazamento no redutor do balão', abre: 3, fecha: null, itens: [['peca', 'Retentor do redutor', 2, 380, null], ['mao_de_obra', 'Desmontagem e montagem do redutor', 1, 650, null]] },
      { codigo: 'BET-02', tipo: 'preventiva', desc: 'Troca de óleo e filtros', abre: 12, fecha: 11, itens: [['peca', 'Óleo de motor 15W40 (L)', 32, 28.5, null], ['peca', 'Filtro de óleo', 2, 95, null], ['servico', 'Troca de óleo do motor e filtro de óleo', 1, 180, oleo]] },
      { codigo: 'BOM-01', tipo: 'corretiva', desc: 'Troca de mangote de 4 polegadas', abre: 20, fecha: 19, itens: [['peca', 'Mangote 4" × 3 m', 1, 1450, null], ['mao_de_obra', 'Substituição do mangote', 1, 200, null]] },
      { codigo: 'BET-07', tipo: 'corretiva', desc: 'Pneu traseiro furado', abre: 26, fecha: 26, itens: [['servico', 'Conserto de pneu', 1, 120, null]] },
    ];
    let numero = 0;
    for (const o of ordens) {
      numero++;
      const vid = id(o.codigo);
      if (!vid) continue;
      const r = await c.query(
        `INSERT INTO ordens_servico (empresa_id, numero, veiculo_id, tipo, descricao, abertura, conclusao, oficina, fornecedor_id, status, km, horimetro)
         SELECT $1, $2, v.id, $3, $4, current_date - $5::int, CASE WHEN $6::int IS NULL THEN NULL ELSE current_date - $6::int END, 'externa', $7,
                CASE WHEN $6::int IS NULL THEN 'aberta'::status_os ELSE 'concluida'::status_os END, v.km_atual, v.horimetro_atual
           FROM veiculos v WHERE v.id = $8 RETURNING id`,
        [e.id, numero, o.tipo, o.desc, o.abre, o.fecha, forn['Oficina Diesel Exemplo'], vid],
      );
      for (const [tipo, desc, qtd, valor, plano] of o.itens) {
        await c.query(`INSERT INTO os_itens (empresa_id, os_id, tipo, descricao, quantidade, valor_unitario_centavos, plano_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
          e.id, r.rows[0].id, tipo, desc, qtd, Math.round(valor * 100), plano,
        ]);
      }
    }
  });
  log('Fornecedores, colaboradores, plano de manutenção e ordens de serviço de exemplo criados.');
}

/** Financeiro de exemplo: contas, plano padrão, clientes, receitas e despesas com parcelas pagas, abertas e vencidas. */
export async function garantirFinanceiroDemo(banco: Banco, log = console.log): Promise<void> {
  const e = (await banco.query('SELECT id FROM empresas WHERE cnpj = $1', [CNPJ_DEMO])).rows[0];
  if (!e) return;
  if ((await banco.query('SELECT 1 FROM contas_financeiras WHERE empresa_id = $1 LIMIT 1', [e.id])).rowCount) return;
  const { aplicarPlanoPadrao } = await import('./rotas/financeiro.ts');
  const { hojeBrasil } = await import('./lib/frota.ts');
  const { somarDias, somarMeses } = await import('./lib/financeiro.ts');
  const hoje = hojeBrasil();
  const d = (n: number) => somarDias(hoje, n);

  await emTransacao(banco, async (c) => {
    await aplicarPlanoPadrao(c, e.id);
    const mapa = async (sql: string, chave: string) =>
      Object.fromEntries((await c.query(sql, [e.id])).rows.map((r) => [r[chave], r.id])) as Record<string, string>;
    const plano = await mapa('SELECT id, codigo FROM plano_contas WHERE empresa_id = $1', 'codigo');
    const centro = await mapa('SELECT id, nome FROM centros_custo WHERE empresa_id = $1', 'nome');
    const veic = await mapa('SELECT id, codigo FROM veiculos WHERE empresa_id = $1', 'codigo');
    const forn = await mapa('SELECT id, nome_fantasia FROM fornecedores WHERE empresa_id = $1', 'nome_fantasia');

    const conta = async (nome: string, tipo: string, banco_: string | null, saldo: number) =>
      (
        await c.query(
          `INSERT INTO contas_financeiras (empresa_id, nome, tipo, banco, agencia, conta, saldo_inicial_centavos, data_saldo_inicial)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [e.id, nome, tipo, banco_, banco_ ? '0001' : null, banco_ ? '12345-6' : null, Math.round(saldo * 100), d(-75)],
        )
      ).rows[0].id as string;
    const banco1 = await conta('Banco Exemplo · conta corrente', 'banco', 'Banco Exemplo', 85000);
    const caixa = await conta('Caixa da usina', 'caixa', null, 2000);

    const cli: Record<string, string> = {};
    for (const [razao, fantasia, tipo] of [
      ['Construtora Horizonte Ltda (exemplo)', 'Construtora Horizonte', 'PJ'],
      ['Incorporadora Serra Azul Ltda (exemplo)', 'Incorporadora Serra Azul', 'PJ'],
      ['João Pereira (exemplo)', null, 'PF'],
    ] as const) {
      const r = await c.query(
        `INSERT INTO clientes (empresa_id, tipo_pessoa, razao_social, nome_fantasia, ramo, cidade, uf) VALUES ($1,$2,$3,$4,$5,'Palmas','TO') RETURNING id`,
        [e.id, tipo, razao, fantasia, tipo === 'PJ' ? 'Construção civil' : 'Obra residencial'],
      );
      cli[fantasia ?? razao] = r.rows[0].id;
    }

    type Ap = [codigo: string, valor: number, centro?: string, veiculo?: string];
    type Pa = [vencimento: string, valor: number, pagoEm?: string, conta?: string, forma?: string];
    const lanc = async (
      tipo: 'receita' | 'despesa',
      competencia: string,
      descricao: string,
      pessoa: { cliente?: string; fornecedor?: string },
      aps: Ap[],
      pas: Pa[],
      extra: { documento?: string; recorrencia?: string; paiId?: string; ordem?: number } = {},
    ) => {
      const total = Math.round(aps.reduce((s, a) => s + a[1], 0) * 100);
      const l = (
        await c.query(
          `INSERT INTO lancamentos (empresa_id, tipo, competencia, descricao, documento, valor_total_centavos, cliente_id, fornecedor_id, recorrencia, recorrencia_pai_id, recorrencia_ordem)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [
            e.id, tipo, competencia, descricao, extra.documento ?? null, total,
            pessoa.cliente ? cli[pessoa.cliente] : null, pessoa.fornecedor ? forn[pessoa.fornecedor] : null,
            extra.recorrencia ?? 'nenhuma', extra.paiId ?? null, extra.ordem ?? null,
          ],
        )
      ).rows[0].id as string;
      if (extra.recorrencia && !extra.paiId) await c.query('UPDATE lancamentos SET recorrencia_pai_id = id WHERE id = $1', [l]);
      for (const [codigo, valor, cc, v] of aps) {
        await c.query(
          `INSERT INTO apropriacoes (empresa_id, lancamento_id, plano_conta_id, centro_custo_id, veiculo_id, valor_centavos) VALUES ($1,$2,$3,$4,$5,$6)`,
          [e.id, l, plano[codigo], cc ? centro[cc] : null, v ? veic[v] ?? null : null, Math.round(valor * 100)],
        );
      }
      for (const [i, [venc, valor, pagoEm, contaId, forma]] of pas.entries()) {
        const pago = pagoEm && pagoEm <= hoje;
        await c.query(
          `INSERT INTO parcelas (empresa_id, lancamento_id, numero, vencimento, valor_centavos, status, data_pagamento, conta_financeira_id, forma_pagamento, valor_pago_centavos)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [e.id, l, i + 1, venc, Math.round(valor * 100), pago ? 'paga' : 'aberta', pago ? pagoEm : null, pago ? contaId ?? banco1 : null, pago ? forma ?? 'pix' : null, pago ? Math.round(valor * 100) : null],
        );
      }
      return l;
    };

    // Receitas.
    await lanc('receita', d(-45), 'Concreto fck 25 · 42 m³ · Ed. Horizonte', { cliente: 'Construtora Horizonte' }, [['1.1', 21840, 'Usina']],
      [[d(-30), 10920, d(-29), banco1, 'boleto'], [d(-2), 10920]], { documento: 'NFS 1021' });
    await lanc('receita', d(-20), 'Concreto fck 30 · 74 m³ + bombeamento · Res. Serra Azul', { cliente: 'Incorporadora Serra Azul' },
      [['1.1', 33300, 'Usina'], ['1.2', 2400, 'Bombas', 'BOM-01']], [[d(10), 35700]], { documento: 'NFS 1034' });
    await lanc('receita', d(-8), 'Concreto fck 20 · 6 m³ · casa', { cliente: 'João Pereira (exemplo)' }, [['1.1', 3120, 'Usina']], [[d(-8), 3120, d(-8), caixa, 'pix']]);
    await lanc('receita', d(-3), 'Concreto fck 25 · 36 m³ · Ed. Horizonte, 2ª etapa', { cliente: 'Construtora Horizonte' }, [['1.1', 18900, 'Usina']], [[d(25), 18900]], { documento: 'NFS 1040' });

    // Despesas.
    await lanc('despesa', d(-40), 'Cimento CP-II 60 t', { fornecedor: 'Cimento Exemplo' }, [['3.1', 28500, 'Usina']],
      [[d(-12), 9500, d(-12), banco1, 'boleto'], [d(16), 9500], [d(44), 9500]], { documento: 'NF 88213' });
    await lanc('despesa', d(-25), 'Brita 1 e areia média', { fornecedor: 'Pedreira Exemplo' }, [['3.3', 7800, 'Usina'], ['3.2', 4500, 'Usina']], [[d(3), 12300]], { documento: 'NF 5120' });
    await lanc('despesa', d(-15), 'Diesel S10 · quinzena', { fornecedor: 'Posto Exemplo' }, [['4.1', 16350, 'Frota'], ['4.1', 3500, 'Bombas']], [[hoje, 19850]], { documento: 'NF 33190' });
    await lanc('despesa', d(-9), 'Oficina · OS do BET-02 (freios)', { fornecedor: 'Oficina Diesel Exemplo' }, [['4.2', 1282, 'Frota', 'BET-02']], [[d(-5), 1282, d(-5), banco1, 'pix']]);
    await lanc('despesa', d(-6), 'Financiamento caminhão BET-07 · parcela', { fornecedor: 'Banco Exemplo · financiamento' }, [['11.3', 8200, 'Frota', 'BET-07'], ['8.3', 1300, 'Frota', 'BET-07']], [[d(-6), 9500]]);
    await lanc('despesa', d(-1), 'Tarifas bancárias', {}, [['8.2', 89.9, 'Administrativo']], [[d(-1), 89.9, d(-1), banco1, 'debito_automatico']]);
    await lanc('despesa', d(-2), 'IPVA BET-04 · cota única', {}, [['4.5', 2340, 'Frota', 'BET-04']], [[d(5), 2340]]);

    // Salários do mês anterior, pagos no 5º dia.
    const mesAnterior = somarMeses(`${hoje.slice(0, 7)}-01`, -1);
    const dia5 = `${hoje.slice(0, 7)}-05`;
    await lanc('despesa', mesAnterior, 'Folha de pagamento', {}, [['5.1', 24000, 'Frota'], ['5.3', 6500, 'Administrativo']], [[dia5, 30500, dia5, banco1, 'transferencia']]);

    // Aluguel do terreno da usina: mensal, 6 meses a partir de 2 meses atrás.
    const base = somarMeses(`${hoje.slice(0, 7)}-10`, -2);
    let pai = '';
    for (let k = 0; k < 6; k++) {
      const venc = somarMeses(base, k);
      const id = await lanc('despesa', somarMeses(`${hoje.slice(0, 7)}-01`, k - 2), 'Aluguel do terreno da usina', {}, [['6.1', 4500, 'Administrativo']],
        [[venc, 4500, venc < hoje ? venc : undefined, banco1, 'boleto']], { recorrencia: 'mensal', paiId: k ? pai : undefined, ordem: k + 1 });
      if (!k) pai = id;
    }

    await c.query(
      `INSERT INTO transferencias (empresa_id, conta_origem_id, conta_destino_id, data, valor_centavos, descricao) VALUES ($1,$2,$3,$4,$5,'Reforço do caixa')`,
      [e.id, banco1, caixa, d(-10), 150000],
    );
  });
  log('Financeiro de exemplo criado: contas, plano de contas, clientes, receitas e despesas.');
}
