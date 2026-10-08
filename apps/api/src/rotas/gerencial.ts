// Etapa 7 · Relatórios gerenciais: DRE (competência e caixa), fluxo de caixa e custo por veículo.
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../db.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { somarDias } from '../lib/financeiro.ts';
import { mesesEntre, montarDre, type Aliquotas, type CategoriaDre, type Regime, type ValorDre } from '../lib/dre.ts';
import { acessaFinanceiro } from '../lib/perfis.ts';
import { ErroHttp } from '../lib/erros.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { SQL_SALDO } from './financeiro.ts';

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const reais = (c: unknown) => Number(c ?? 0) / 100;

export function periodo(q: { de?: string; ate?: string }, padraoMeses = 6) {
  const hoje = hojeBrasil();
  const atual = hoje.slice(0, 7);
  let ate = MES.test(q.ate ?? '') ? q.ate! : atual;
  let de = MES.test(q.de ?? '') ? q.de! : mesesEntre(somarMesesAAAAMM(atual, -(padraoMeses - 1)), atual)[0];
  if (de > ate) [de, ate] = [ate, de];
  const meses = mesesEntre(de, ate, 24);
  const inicio = `${meses[0]}-01`;
  const fim = `${somarMesesAAAAMM(meses[meses.length - 1], 1)}-01`; // exclusivo
  return { meses, inicio, fim, hoje };
}

function somarMesesAAAAMM(m: string, n: number): string {
  const [a, mm] = m.split('-').map(Number);
  const t = a * 12 + (mm - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

// Categorias virtuais para juros e descontos das baixas (visão de caixa).
const VIRTUAIS: CategoriaDre[] = [
  { id: 'baixa:juros_pagos', codigo: '8.9.1', nome: 'Juros e multas pagos nas baixas', tipo: 'despesa', linha: 'despesas_financeiras' },
  { id: 'baixa:descontos_concedidos', codigo: '8.9.2', nome: 'Descontos concedidos a clientes', tipo: 'despesa', linha: 'despesas_financeiras' },
  { id: 'baixa:juros_recebidos', codigo: '8.9.3', nome: 'Juros recebidos nas baixas', tipo: 'receita', linha: 'receitas_financeiras' },
  { id: 'baixa:descontos_obtidos', codigo: '8.9.4', nome: 'Descontos obtidos de fornecedores', tipo: 'receita', linha: 'receitas_financeiras' },
];

export function rotasGerencial(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    // ----- DRE -----
    app.get<{ Querystring: Record<string, string | undefined> }>('/dre', async (req) => {
      const empresaId = empresaDo(req);
      const { meses, inicio, fim } = periodo(req.query);
      const visao = req.query.visao === 'caixa' ? 'caixa' : 'competencia';
      const empresa = (await banco.query('SELECT regime_tributario, aliquotas_dre FROM empresas WHERE id = $1', [empresaId])).rows[0];
      const regime = (empresa?.regime_tributario ?? 'simples') as Regime;
      const aliquotas = (empresa?.aliquotas_dre ?? {}) as Aliquotas;
      const temAliquota = Object.values(aliquotas).some((v) => Number(v) > 0);
      const impostos = req.query.impostos === 'estimados' || req.query.impostos === 'lancados' ? req.query.impostos : 'lancados';

      const categorias: CategoriaDre[] = (
        await banco.query('SELECT id, codigo, nome, tipo, linha_dre FROM plano_contas WHERE empresa_id = $1', [empresaId])
      ).rows.map((r) => ({ id: r.id, codigo: r.codigo, nome: r.nome, tipo: r.tipo, linha: r.linha_dre }));

      let valores: ValorDre[];
      if (visao === 'competencia') {
        valores = (
          await banco.query(
            `SELECT to_char(l.competencia, 'YYYY-MM') AS mes, a.plano_conta_id, sum(a.valor_centavos) AS v
               FROM apropriacoes a JOIN lancamentos l ON l.id = a.lancamento_id
              WHERE l.empresa_id = $1 AND l.status = 'confirmado' AND l.excluido_em IS NULL AND l.competencia >= $2 AND l.competencia < $3
              GROUP BY 1, 2`,
            [empresaId, inicio, fim],
          )
        ).rows.map((r) => ({ mes: r.mes, categoriaId: r.plano_conta_id, centavos: Number(r.v) }));
      } else {
        // Caixa: o valor de cada parcela paga é dividido entre as categorias do lançamento, na proporção delas.
        valores = (
          await banco.query(
            `SELECT to_char(p.data_pagamento, 'YYYY-MM') AS mes, a.plano_conta_id,
                    sum(round(a.valor_centavos::numeric * p.valor_centavos / nullif(l.valor_total_centavos, 0))) AS v
               FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id JOIN apropriacoes a ON a.lancamento_id = l.id
              WHERE p.empresa_id = $1 AND p.status = 'paga' AND l.status = 'confirmado' AND l.excluido_em IS NULL
                AND p.data_pagamento >= $2 AND p.data_pagamento < $3
              GROUP BY 1, 2`,
            [empresaId, inicio, fim],
          )
        ).rows.map((r) => ({ mes: r.mes, categoriaId: r.plano_conta_id, centavos: Number(r.v) }));
        const extras = (
          await banco.query(
            `SELECT to_char(p.data_pagamento, 'YYYY-MM') AS mes, l.tipo, sum(p.juros_centavos) AS juros, sum(p.desconto_centavos) AS desconto
               FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
              WHERE p.empresa_id = $1 AND p.status = 'paga' AND l.status = 'confirmado' AND l.excluido_em IS NULL
                AND p.data_pagamento >= $2 AND p.data_pagamento < $3
              GROUP BY 1, 2`,
            [empresaId, inicio, fim],
          )
        ).rows;
        for (const x of extras) {
          const despesa = x.tipo === 'despesa';
          valores.push({ mes: x.mes, categoriaId: despesa ? 'baixa:juros_pagos' : 'baixa:juros_recebidos', centavos: Number(x.juros) });
          valores.push({ mes: x.mes, categoriaId: despesa ? 'baixa:descontos_obtidos' : 'baixa:descontos_concedidos', centavos: Number(x.desconto) });
        }
        categorias.push(...VIRTUAIS);
      }

      const dre = montarDre(meses, categorias, valores, { impostos, regime, aliquotas });
      const conv = (v: Record<string, number>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x / 100]));
      const linha = (l: (typeof dre.linhas)[number]) => ({
        chave: l.chave,
        nome: l.nome,
        tipo: l.tipo,
        estimado: !!l.estimado,
        valores: conv(l.valores),
        total: l.total / 100,
        categorias: l.categorias.map((c) => ({ id: c.id, codigo: c.codigo, nome: c.nome, valores: conv(c.valores), total: c.total / 100 })),
      });
      return {
        meses,
        visao,
        impostos,
        regime,
        temAliquota,
        linhas: dre.linhas.map(linha),
        fora: linha(dre.fora),
      };
    });

    // ----- Fluxo de caixa: realizado por mês e projeção por semana -----
    app.get<{ Querystring: Record<string, string | undefined> }>('/fluxo', async (req) => {
      if (!acessaFinanceiro(req.usuario!.perfil)) throw new ErroHttp(403, 'O fluxo de caixa mostra saldos e contas: só o dono e o perfil Financeiro veem.');
      const empresaId = empresaDo(req);
      const { meses, inicio, hoje } = periodo(req.query, 6);
      const semanas = Math.min(Math.max(Number(req.query.semanas) || 12, 4), 26);
      const saldoAtual = Number(
        (await banco.query(`SELECT coalesce(sum(${SQL_SALDO}), 0) AS s FROM contas_financeiras c WHERE c.empresa_id = $1 AND c.excluido_em IS NULL`, [empresaId])).rows[0].s,
      );

      // Realizado: tudo o que foi pago e recebido, do início do período até hoje.
      const mov = (
        await banco.query(
          `SELECT to_char(p.data_pagamento, 'YYYY-MM') AS mes, l.tipo, (pc.linha_dre = 'fora_dre') AS fora,
                  sum(round(a.valor_centavos::numeric * p.valor_pago_centavos / nullif(l.valor_total_centavos, 0))) AS v
             FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id JOIN apropriacoes a ON a.lancamento_id = l.id
             JOIN plano_contas pc ON pc.id = a.plano_conta_id
            WHERE p.empresa_id = $1 AND p.status = 'paga' AND l.status = 'confirmado' AND l.excluido_em IS NULL AND p.data_pagamento >= $2
            GROUP BY 1, 2, 3`,
          [empresaId, inicio],
        )
      ).rows;
      const porMes = new Map(meses.map((m) => [m, { mes: m, entradas: 0, saidas: 0, entradasFora: 0, saidasFora: 0 }]));
      let depoisDoPeriodo = 0; // movimento líquido após o último mês (para calcular o saldo final de cada mês)
      for (const x of mov) {
        const v = Number(x.v);
        const alvo = porMes.get(x.mes);
        if (!alvo) {
          depoisDoPeriodo += x.tipo === 'receita' ? v : -v;
          continue;
        }
        if (x.tipo === 'receita') x.fora ? (alvo.entradasFora += v) : (alvo.entradas += v);
        else x.fora ? (alvo.saidasFora += v) : (alvo.saidas += v);
      }
      // Saldo final de cada mês, de trás para frente a partir do saldo de hoje.
      const realizado = [...porMes.values()];
      let saldo = saldoAtual - depoisDoPeriodo;
      const saidaRealizado = [];
      for (let i = realizado.length - 1; i >= 0; i--) {
        const r = realizado[i];
        const liquido = r.entradas + r.entradasFora - r.saidas - r.saidasFora;
        saidaRealizado.unshift({
          mes: r.mes,
          entradas: reais(r.entradas),
          saidas: reais(r.saidas),
          entradasFora: reais(r.entradasFora),
          saidasFora: reais(r.saidasFora),
          liquido: reais(liquido),
          saldoFinal: reais(saldo),
        });
        saldo -= liquido;
      }

      // Projeção: parcelas em aberto por semana; as atrasadas entram na primeira semana.
      const abertas = (
        await banco.query(
          `SELECT p.vencimento, l.tipo, sum(p.valor_centavos) AS v
             FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
            WHERE p.empresa_id = $1 AND p.status = 'aberta' AND l.status = 'confirmado' AND l.excluido_em IS NULL AND p.vencimento < $2::date + $3::int * 7
            GROUP BY 1, 2`,
          [empresaId, hoje, semanas],
        )
      ).rows;
      const atrasadas = { receber: 0, pagar: 0 };
      const semanasSaida = Array.from({ length: semanas }, (_, k) => ({ inicio: somarDias(hoje, k * 7), fim: somarDias(hoje, k * 7 + 6), receber: 0, pagar: 0 }));
      for (const x of abertas) {
        const venc = String(x.vencimento);
        const v = Number(x.v);
        if (venc < hoje) {
          if (x.tipo === 'receita') atrasadas.receber += v;
          else atrasadas.pagar += v;
          continue;
        }
        const k = Math.floor((Date.parse(venc) - Date.parse(hoje)) / (7 * 86_400_000));
        const s = semanasSaida[k];
        if (!s) continue;
        if (x.tipo === 'receita') s.receber += v;
        else s.pagar += v;
      }
      let projetado = saldoAtual + atrasadas.receber - atrasadas.pagar;
      let menor: { semana: string; saldo: number } | null = null;
      const projecao = semanasSaida.map((s) => {
        projetado += s.receber - s.pagar;
        if (!menor || projetado < menor.saldo) menor = { semana: s.inicio, saldo: projetado };
        return { inicio: s.inicio, fim: s.fim, receber: reais(s.receber), pagar: reais(s.pagar), saldo: reais(projetado) };
      });
      return {
        hoje,
        saldoAtual: reais(saldoAtual),
        realizado: saidaRealizado,
        atrasadas: { receber: reais(atrasadas.receber), pagar: reais(atrasadas.pagar) },
        projecao,
        menorSaldo: menor ? { semana: (menor as { semana: string }).semana, saldo: reais((menor as { saldo: number }).saldo) } : null,
      };
    });

    // ----- Custo por veículo -----
    app.get<{ Querystring: Record<string, string | undefined> }>('/custo-veiculo', async (req) => {
      const empresaId = empresaDo(req);
      const { meses, inicio, fim } = periodo(req.query, 3);
      const veiculos = (
        await banco.query('SELECT id, codigo, tipo, status, placa FROM veiculos WHERE empresa_id = $1 AND excluido_em IS NULL ORDER BY codigo', [empresaId])
      ).rows;
      // 1) Despesas lançadas (notas e lançamentos) com veículo.
      const fin = (
        await banco.query(
          `SELECT a.veiculo_id, pc.codigo, pc.nome, sum(a.valor_centavos) AS v
             FROM apropriacoes a JOIN lancamentos l ON l.id = a.lancamento_id JOIN plano_contas pc ON pc.id = a.plano_conta_id
            WHERE l.empresa_id = $1 AND l.status = 'confirmado' AND l.excluido_em IS NULL AND l.tipo = 'despesa'
              AND a.veiculo_id IS NOT NULL AND l.competencia >= $2 AND l.competencia < $3 AND pc.linha_dre <> 'fora_dre'
            GROUP BY 1, 2, 3`,
          [empresaId, inicio, fim],
        )
      ).rows;
      // 2) Registros da frota ainda sem nota (para o custo não ficar faltando enquanto a nota não chega).
      const abastSemNota = (
        await banco.query(
          `SELECT veiculo_id, sum(coalesce(valor_total_centavos, 0)) AS v, count(*)::int AS n FROM abastecimentos
            WHERE empresa_id = $1 AND excluido_em IS NULL AND origem = 'posto' AND nota_item_id IS NULL
              AND data_hora >= $2::date AND data_hora < $3::date
            GROUP BY 1`,
          [empresaId, inicio, fim],
        )
      ).rows;
      const osSemNota = (
        await banco.query(
          `SELECT o.veiculo_id, sum(round(oi.quantidade * oi.valor_unitario_centavos)) AS v, count(DISTINCT o.id)::int AS n
             FROM os_itens oi JOIN ordens_servico o ON o.id = oi.os_id
            WHERE o.empresa_id = $1 AND o.status = 'concluida' AND oi.excluido_em IS NULL AND oi.nota_item_id IS NULL
              AND o.conclusao >= $2 AND o.conclusao < $3
            GROUP BY 1`,
          [empresaId, inicio, fim],
        )
      ).rows;
      // 3) Uso no período: km e horas rodados e litros.
      const uso = (
        await banco.query(
          `SELECT veiculo_id, max(km) - min(km) AS km, max(horimetro) - min(horimetro) AS horas, sum(litros) AS litros, count(*)::int AS n
             FROM abastecimentos WHERE empresa_id = $1 AND excluido_em IS NULL AND data_hora >= $2::date AND data_hora < $3::date
            GROUP BY 1`,
          [empresaId, inicio, fim],
        )
      ).rows;
      // 4) Custos da frota sem veículo (seguro geral, diesel do tanque próprio…).
      const semVeiculo = (
        await banco.query(
          `SELECT pc.codigo, pc.nome, sum(a.valor_centavos) AS v
             FROM apropriacoes a JOIN lancamentos l ON l.id = a.lancamento_id JOIN plano_contas pc ON pc.id = a.plano_conta_id
            WHERE l.empresa_id = $1 AND l.status = 'confirmado' AND l.excluido_em IS NULL AND l.tipo = 'despesa'
              AND a.veiculo_id IS NULL AND pc.linha_dre = 'custo_frota' AND l.competencia >= $2 AND l.competencia < $3
            GROUP BY 1, 2 ORDER BY 1`,
          [empresaId, inicio, fim],
        )
      ).rows;

      // 5) Produção: m³ transportados pelas betoneiras e bombeados pelas bombas.
      const prod = (
        await banco.query(
          `SELECT betoneira_id AS veiculo_id, sum(volume_m3) AS m3 FROM cargas
            WHERE empresa_id = $1 AND status = 'produzida' AND (data_hora AT TIME ZONE 'America/Sao_Paulo')::date >= $2 AND (data_hora AT TIME ZONE 'America/Sao_Paulo')::date < $3
            GROUP BY 1
           UNION ALL
           SELECT bomba_id, sum(volume_bombeado_m3) FROM cargas
            WHERE empresa_id = $1 AND status = 'produzida' AND bomba_id IS NOT NULL AND (data_hora AT TIME ZONE 'America/Sao_Paulo')::date >= $2 AND (data_hora AT TIME ZONE 'America/Sao_Paulo')::date < $3
            GROUP BY 1`,
          [empresaId, inicio, fim],
        )
      ).rows;

      const linhas = veiculos.map((v) => {
        const cats = fin.filter((f) => f.veiculo_id === v.id).map((f) => ({ codigo: f.codigo, nome: f.nome, valor: reais(f.v) }));
        cats.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
        const ab = abastSemNota.find((x) => x.veiculo_id === v.id);
        const os = osSemNota.find((x) => x.veiculo_id === v.id);
        const u = uso.find((x) => x.veiculo_id === v.id);
        const lancado = cats.reduce((s, c) => s + c.valor, 0);
        const semNota = { diesel: reais(ab?.v), abastecimentos: ab?.n ?? 0, manutencao: reais(os?.v), ordens: os?.n ?? 0 };
        const total = Math.round((lancado + semNota.diesel + semNota.manutencao) * 100) / 100;
        const km = u?.km !== null && u?.km !== undefined ? Number(u.km) : 0;
        const horas = u?.horas !== null && u?.horas !== undefined ? Number(u.horas) : 0;
        const bomba = String(v.tipo).startsWith('bomba');
        return {
          veiculoId: v.id,
          codigo: v.codigo,
          tipo: v.tipo,
          status: v.status,
          categorias: cats,
          lancado: Math.round(lancado * 100) / 100,
          semNota,
          total,
          km,
          horas,
          litros: u ? Number(u.litros) : 0,
          custoKm: !bomba && km > 0 ? Math.round((total / km) * 100) / 100 : null,
          custoHora: bomba && horas > 0 ? Math.round((total / horas) * 100) / 100 : null,
          m3: Math.round(prod.filter((x) => x.veiculo_id === v.id).reduce((s, x) => s + Number(x.m3 ?? 0), 0) * 100) / 100,
          custoM3: (() => {
            const m3 = prod.filter((x) => x.veiculo_id === v.id).reduce((s, x) => s + Number(x.m3 ?? 0), 0);
            return m3 > 0 ? Math.round((total / m3) * 100) / 100 : null;
          })(),
        };
      });
      const totalGeral = linhas.reduce((s, l) => s + l.total, 0);
      return {
        meses,
        de: inicio,
        ate: somarDias(fim, -1),
        veiculos: linhas.filter((l) => l.total > 0 || l.km > 0 || l.status !== 'inativo'),
        semVeiculo: semVeiculo.map((x) => ({ codigo: x.codigo, nome: x.nome, valor: reais(x.v) })),
        total: Math.round(totalGeral * 100) / 100,
      };
    });
  };
}
