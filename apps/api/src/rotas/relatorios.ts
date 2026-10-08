// Relatórios de cada módulo, relatórios gerais (cruzam módulos) e indicadores.
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../db.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { somarDias } from '../lib/financeiro.ts';
import { montarDre, type CategoriaDre } from '../lib/dre.ts';
import { BRUTO_ZERO, calcularIndicadores, type Bruto, type Retrato } from '../lib/indicadores.ts';
import { acessaFinanceiro } from '../lib/perfis.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { SQL_SALDO } from './financeiro.ts';
import { periodo } from './gerencial.ts';
import { situacaoManutencao } from './manutencao.ts';
import { faixaSlump } from '../lib/qualidade.ts';

const reais = (c: unknown) => Math.round(Number(c ?? 0)) / 100;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const MES_TS = (col: string) => `to_char(${col} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`;

export function rotasRelatorios(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    // ======================= Frota =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/frota', async (req) => {
      const empresaId = empresaDo(req);
      const { meses, inicio, fim, hoje } = periodo(req.query, 3);
      const p = [empresaId, inicio, fim];
      const veiculos = (
        await banco.query(
          `WITH a AS (
             SELECT veiculo_id, data_hora, litros, valor_total_centavos, km, horimetro, origem, nota_item_id,
                    lag(km) OVER w AS km_ant, lag(horimetro) OVER w AS h_ant
               FROM abastecimentos WHERE empresa_id = $1 AND excluido_em IS NULL WINDOW w AS (PARTITION BY veiculo_id ORDER BY data_hora))
           SELECT v.id, v.codigo, v.tipo, v.status,
                  count(a.*)::int AS abastecimentos, coalesce(sum(a.litros), 0) AS litros, coalesce(sum(a.valor_total_centavos), 0) AS valor,
                  coalesce(sum(a.km - a.km_ant) FILTER (WHERE a.km_ant IS NOT NULL AND a.km >= a.km_ant), 0) AS km,
                  coalesce(sum(a.litros) FILTER (WHERE a.km_ant IS NOT NULL AND a.km >= a.km_ant), 0) AS litros_km,
                  coalesce(sum(a.horimetro - a.h_ant) FILTER (WHERE a.h_ant IS NOT NULL AND a.horimetro >= a.h_ant), 0) AS horas,
                  coalesce(sum(a.litros) FILTER (WHERE a.h_ant IS NOT NULL AND a.horimetro >= a.h_ant), 0) AS litros_h,
                  count(a.*) FILTER (WHERE a.origem = 'posto' AND a.nota_item_id IS NULL)::int AS sem_nota
             FROM veiculos v
             LEFT JOIN a ON a.veiculo_id = v.id AND a.data_hora >= $2::date AND a.data_hora < $3::date
            WHERE v.empresa_id = $1 AND v.excluido_em IS NULL
            GROUP BY v.id ORDER BY v.codigo`,
          p,
        )
      ).rows;
      const os = (
        await banco.query(
          `SELECT o.veiculo_id,
                  count(*) FILTER (WHERE o.status = 'concluida' AND o.conclusao >= $2 AND o.conclusao < $3)::int AS concluidas,
                  count(*) FILTER (WHERE o.status IN ('aberta', 'em_andamento'))::int AS abertas,
                  coalesce(sum(o.conclusao - o.abertura) FILTER (WHERE o.status = 'concluida' AND o.conclusao >= $2 AND o.conclusao < $3), 0) AS dias,
                  coalesce(sum((SELECT sum(round(i.quantidade * i.valor_unitario_centavos)) FROM os_itens i WHERE i.os_id = o.id AND i.excluido_em IS NULL))
                    FILTER (WHERE o.status = 'concluida' AND o.conclusao >= $2 AND o.conclusao < $3), 0) AS custo,
                  count(*) FILTER (WHERE o.tipo = 'corretiva' AND o.status = 'concluida' AND o.conclusao >= $2 AND o.conclusao < $3)::int AS corretivas
             FROM ordens_servico o WHERE o.empresa_id = $1 GROUP BY 1`,
          p,
        )
      ).rows;
      const revisoes = await situacaoManutencao(banco, empresaId);
      const porVeiculo = veiculos.map((v) => {
        const o = os.find((x) => x.veiculo_id === v.id);
        const rv = revisoes.filter((r: { veiculoId: string }) => r.veiculoId === v.id);
        const bomba = String(v.tipo).startsWith('bomba');
        return {
          veiculoId: v.id,
          codigo: v.codigo,
          tipo: v.tipo,
          status: v.status,
          abastecimentos: v.abastecimentos,
          litros: num(v.litros),
          valor: reais(v.valor),
          km: num(v.km),
          horas: num(v.horas),
          kmPorLitro: !bomba && num(v.litros_km) > 0 ? num(v.km) / num(v.litros_km) : null,
          litrosPorHora: bomba && num(v.horas) > 0 ? num(v.litros_h) / num(v.horas) : null,
          precoLitro: num(v.litros) > 0 && num(v.valor) > 0 ? reais(v.valor) / num(v.litros) : null,
          semNota: v.sem_nota,
          osConcluidas: o?.concluidas ?? 0,
          osCorretivas: o?.corretivas ?? 0,
          osAbertas: o?.abertas ?? 0,
          diasParado: num(o?.dias),
          custoOs: reais(o?.custo),
          revisoesVencidas: rv.filter((r: { situacao: string }) => r.situacao === 'vencida').length,
          revisoesProximas: rv.filter((r: { situacao: string }) => r.situacao === 'proxima').length,
        };
      });
      const porMotorista = (
        await banco.query(
          `SELECT coalesce(m.nome, 'Sem motorista informado') AS nome, m.funcao, count(*)::int AS abastecimentos, sum(a.litros) AS litros,
                  coalesce(sum(a.valor_total_centavos), 0) AS valor, string_agg(DISTINCT v.codigo, ', ') AS veiculos
             FROM abastecimentos a LEFT JOIN motoristas m ON m.id = a.motorista_id JOIN veiculos v ON v.id = a.veiculo_id
            WHERE a.empresa_id = $1 AND a.excluido_em IS NULL AND a.data_hora >= $2::date AND a.data_hora < $3::date
            GROUP BY m.id, m.nome, m.funcao ORDER BY sum(a.litros) DESC`,
          p,
        )
      ).rows.map((x) => ({ nome: x.nome, funcao: x.funcao, abastecimentos: x.abastecimentos, litros: num(x.litros), valor: reais(x.valor), veiculos: x.veiculos }));
      const mesesAbast = (
        await banco.query(
          `SELECT ${MES_TS('data_hora')} AS mes, count(*)::int AS n, sum(litros) AS litros, coalesce(sum(valor_total_centavos), 0) AS valor
             FROM abastecimentos WHERE empresa_id = $1 AND excluido_em IS NULL AND data_hora >= $2::date AND data_hora < $3::date GROUP BY 1`,
          p,
        )
      ).rows;
      const mesesOs = (
        await banco.query(
          `SELECT to_char(o.conclusao, 'YYYY-MM') AS mes, count(*)::int AS n,
                  coalesce(sum((SELECT sum(round(i.quantidade * i.valor_unitario_centavos)) FROM os_itens i WHERE i.os_id = o.id AND i.excluido_em IS NULL)), 0) AS custo
             FROM ordens_servico o WHERE o.empresa_id = $1 AND o.status = 'concluida' AND o.conclusao >= $2 AND o.conclusao < $3 GROUP BY 1`,
          p,
        )
      ).rows;
      const porMes = meses.map((m) => {
        const a = mesesAbast.find((x) => x.mes === m);
        const o = mesesOs.find((x) => x.mes === m);
        return { mes: m, abastecimentos: a?.n ?? 0, litros: num(a?.litros), valor: reais(a?.valor), precoLitro: num(a?.litros) > 0 ? reais(a?.valor) / num(a?.litros) : null, osConcluidas: o?.n ?? 0, custoOs: reais(o?.custo) };
      });
      const limite = somarDias(hoje, 60);
      const documentos = (
        await banco.query(
          `SELECT v.codigo AS referencia, v.id AS veiculo_id, d.tipo AS item, d.descricao, d.vencimento, d.valor_centavos
             FROM documentos_veiculo d JOIN veiculos v ON v.id = d.veiculo_id
            WHERE d.empresa_id = $1 AND d.excluido_em IS NULL AND v.excluido_em IS NULL AND d.vencimento <= $2 ORDER BY d.vencimento`,
          [empresaId, limite],
        )
      ).rows.map((d) => ({ tipo: 'documento', referencia: d.referencia, veiculoId: d.veiculo_id, item: d.item, descricao: d.descricao, vencimento: d.vencimento, valor: d.valor_centavos === null ? null : reais(d.valor_centavos) }));
      const cnh = (
        await banco.query(
          `SELECT nome AS referencia, cnh_categoria, cnh_vencimento AS vencimento FROM motoristas
            WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo AND cnh_vencimento IS NOT NULL AND cnh_vencimento <= $2 ORDER BY cnh_vencimento`,
          [empresaId, limite],
        )
      ).rows.map((d) => ({ tipo: 'cnh', referencia: d.referencia, item: `CNH ${d.cnh_categoria ?? ''}`.trim(), descricao: null, vencimento: d.vencimento, valor: null }));
      return { meses, de: inicio, ate: somarDias(fim, -1), hoje, porVeiculo, porMotorista, porMes, vencimentos: [...documentos, ...cnh].sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento))) };
    });

    // ======================= Financeiro =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/financeiro', async (req) => {
      const empresaId = empresaDo(req);
      const { meses, inicio, fim, hoje } = periodo(req.query, 3);
      const p = [empresaId, inicio, fim];
      const porCategoria = (
        await banco.query(
          `SELECT l.tipo, pc.codigo, pc.nome, pc.linha_dre, sum(a.valor_centavos) AS v, count(DISTINCT l.id)::int AS n
             FROM apropriacoes a JOIN lancamentos l ON l.id = a.lancamento_id JOIN plano_contas pc ON pc.id = a.plano_conta_id
            WHERE l.empresa_id = $1 AND l.status = 'confirmado' AND l.excluido_em IS NULL AND l.competencia >= $2 AND l.competencia < $3
            GROUP BY 1, 2, 3, 4`,
          p,
        )
      ).rows.map((x) => ({ tipo: x.tipo, codigo: x.codigo, nome: x.nome, linhaDre: x.linha_dre, valor: reais(x.v), lancamentos: x.n }));
      const porCentro = (
        await banco.query(
          `SELECT coalesce(cc.nome, 'Sem centro de custo') AS nome, sum(a.valor_centavos) AS v
             FROM apropriacoes a JOIN lancamentos l ON l.id = a.lancamento_id JOIN plano_contas pc ON pc.id = a.plano_conta_id
             LEFT JOIN centros_custo cc ON cc.id = a.centro_custo_id
            WHERE l.empresa_id = $1 AND l.status = 'confirmado' AND l.excluido_em IS NULL AND l.tipo = 'despesa' AND pc.linha_dre <> 'fora_dre'
              AND l.competencia >= $2 AND l.competencia < $3
            GROUP BY 1 ORDER BY 2 DESC`,
          p,
        )
      ).rows.map((x) => ({ nome: x.nome, valor: reais(x.v) }));
      const porPessoa = (
        await banco.query(
          `SELECT l.tipo, coalesce(f.nome_fantasia, f.razao_social, c.nome_fantasia, c.razao_social, 'Não informado') AS nome,
                  sum(l.valor_total_centavos) AS v, count(*)::int AS n
             FROM lancamentos l LEFT JOIN fornecedores f ON f.id = l.fornecedor_id LEFT JOIN clientes c ON c.id = l.cliente_id
            WHERE l.empresa_id = $1 AND l.status = 'confirmado' AND l.excluido_em IS NULL AND l.competencia >= $2 AND l.competencia < $3
            GROUP BY 1, 2 ORDER BY 3 DESC`,
          p,
        )
      ).rows.map((x) => ({ tipo: x.tipo, nome: x.nome, valor: reais(x.v), lancamentos: x.n }));
      const baixas = (
        await banco.query(
          `SELECT to_char(p.data_pagamento, 'YYYY-MM') AS mes, l.tipo, coalesce(p.forma_pagamento, 'nao_informada') AS forma, cf.nome AS conta,
                  sum(p.valor_pago_centavos) AS v, sum(p.juros_centavos) AS juros, sum(p.desconto_centavos) AS desconto, count(*)::int AS n
             FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id LEFT JOIN contas_financeiras cf ON cf.id = p.conta_financeira_id
            WHERE p.empresa_id = $1 AND p.status = 'paga' AND l.status = 'confirmado' AND l.excluido_em IS NULL
              AND p.data_pagamento >= $2 AND p.data_pagamento < $3
            GROUP BY 1, 2, 3, 4`,
          p,
        )
      ).rows;
      const porMes = meses.map((m) => {
        const x = baixas.filter((b) => b.mes === m);
        const soma = (t: string, k: string) => reais(x.filter((b) => b.tipo === t).reduce((s, b) => s + num(b[k]), 0));
        return { mes: m, recebido: soma('receita', 'v'), pago: soma('despesa', 'v'), jurosPagos: soma('despesa', 'juros'), descontosObtidos: soma('despesa', 'desconto') };
      });
      const formas = new Map<string, { forma: string; recebido: number; pago: number; n: number }>();
      for (const b of baixas) {
        const f = formas.get(b.forma) ?? { forma: b.forma, recebido: 0, pago: 0, n: 0 };
        if (b.tipo === 'receita') f.recebido += num(b.v);
        else f.pago += num(b.v);
        f.n += b.n;
        formas.set(b.forma, f);
      }
      const aging = (
        await banco.query(
          `SELECT l.tipo,
                  CASE WHEN p.vencimento >= $2 THEN 'a_vencer' WHEN $2 - p.vencimento <= 30 THEN 'ate30' WHEN $2 - p.vencimento <= 60 THEN 'ate60'
                       WHEN $2 - p.vencimento <= 90 THEN 'ate90' ELSE 'mais90' END AS faixa,
                  sum(p.valor_centavos) AS v, count(*)::int AS n
             FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
            WHERE p.empresa_id = $1 AND p.status = 'aberta' AND l.status = 'confirmado' AND l.excluido_em IS NULL
            GROUP BY 1, 2`,
          [empresaId, hoje],
        )
      ).rows.map((x) => ({ tipo: x.tipo, faixa: x.faixa, valor: reais(x.v), parcelas: x.n }));
      return {
        meses, de: inicio, ate: somarDias(fim, -1), hoje, porCategoria, porCentro, porPessoa, porMes,
        porForma: [...formas.values()].map((f) => ({ forma: f.forma, recebido: f.recebido / 100, pago: f.pago / 100, baixas: f.n })).sort((a, b) => b.pago + b.recebido - (a.pago + a.recebido)),
        aging,
      };
    });

    // ======================= Administrativo =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/administrativo', async (req) => {
      const ve = acessaFinanceiro(req.usuario!.perfil);
      const empresaId = empresaDo(req);
      const { inicio, fim, hoje } = periodo(req.query, 3);
      const p = [empresaId, inicio, fim];
      const fornecedores = (
        await banco.query(
          `SELECT f.id, coalesce(f.nome_fantasia, f.razao_social) AS nome, f.categoria, f.ramo, f.cnpj_cpf, f.ativo, f.criado_automaticamente,
                  (SELECT count(*)::int FROM notas_fiscais n WHERE n.fornecedor_id = f.id AND n.status = 'confirmada' AND n.excluido_em IS NULL AND n.data_emissao >= $2 AND n.data_emissao < $3) AS notas,
                  (SELECT coalesce(sum(l.valor_total_centavos), 0) FROM lancamentos l WHERE l.fornecedor_id = f.id AND l.status = 'confirmado' AND l.excluido_em IS NULL AND l.competencia >= $2 AND l.competencia < $3) AS comprado,
                  (SELECT max(l.competencia) FROM lancamentos l WHERE l.fornecedor_id = f.id AND l.status = 'confirmado' AND l.excluido_em IS NULL) AS ultima,
                  (SELECT coalesce(sum(pa.valor_centavos), 0) FROM parcelas pa JOIN lancamentos l ON l.id = pa.lancamento_id
                    WHERE l.fornecedor_id = f.id AND pa.status = 'aberta' AND l.status = 'confirmado' AND l.excluido_em IS NULL) AS a_pagar
             FROM fornecedores f WHERE f.empresa_id = $1 AND f.excluido_em IS NULL ORDER BY comprado DESC, nome`,
          p,
        )
      ).rows.map((x) => ({ id: x.id, nome: x.nome, categoria: x.categoria, ramo: x.ramo, documento: x.cnpj_cpf, ativo: x.ativo, automatico: x.criado_automaticamente, notas: x.notas, comprado: reais(x.comprado), ultima: x.ultima, aPagar: ve ? reais(x.a_pagar) : null }));
      const clientes = (
        await banco.query(
          `SELECT c.id, coalesce(c.nome_fantasia, c.razao_social) AS nome, c.cnpj_cpf, c.cidade, c.ativo,
                  (SELECT coalesce(sum(l.valor_total_centavos), 0) FROM lancamentos l WHERE l.cliente_id = c.id AND l.status = 'confirmado' AND l.excluido_em IS NULL AND l.competencia >= $2 AND l.competencia < $3) AS vendido,
                  (SELECT max(l.competencia) FROM lancamentos l WHERE l.cliente_id = c.id AND l.status = 'confirmado' AND l.excluido_em IS NULL) AS ultima,
                  (SELECT coalesce(sum(pa.valor_centavos), 0) FROM parcelas pa JOIN lancamentos l ON l.id = pa.lancamento_id
                    WHERE l.cliente_id = c.id AND pa.status = 'aberta' AND l.status = 'confirmado' AND l.excluido_em IS NULL) AS a_receber,
                  (SELECT coalesce(sum(pa.valor_centavos), 0) FROM parcelas pa JOIN lancamentos l ON l.id = pa.lancamento_id
                    WHERE l.cliente_id = c.id AND pa.status = 'aberta' AND pa.vencimento < $4 AND l.status = 'confirmado' AND l.excluido_em IS NULL) AS vencido
             FROM clientes c WHERE c.empresa_id = $1 AND c.excluido_em IS NULL ORDER BY vendido DESC, nome`,
          [...p, hoje],
        )
      ).rows.map((x) => ({ id: x.id, nome: x.nome, documento: x.cnpj_cpf, cidade: x.cidade, ativo: x.ativo, vendido: reais(x.vendido), ultima: x.ultima, aReceber: ve ? reais(x.a_receber) : null, vencido: ve ? reais(x.vencido) : null }));
      const colaboradores = (
        await banco.query(
          `SELECT m.id, m.nome, m.funcao, m.cargo, m.ativo, m.cnh_categoria, m.cnh_vencimento, m.data_admissao, (u.id IS NOT NULL) AS tem_login,
                  (SELECT count(*)::int FROM abastecimentos a WHERE a.motorista_id = m.id AND a.excluido_em IS NULL AND a.data_hora >= $2::date AND a.data_hora < $3::date) AS abastecimentos
             FROM motoristas m LEFT JOIN usuarios u ON u.motorista_id = m.id AND u.excluido_em IS NULL
            WHERE m.empresa_id = $1 AND m.excluido_em IS NULL ORDER BY m.ativo DESC, m.nome`,
          p,
        )
      ).rows.map((x) => ({ id: x.id, nome: x.nome, funcao: x.funcao, cargo: x.cargo, ativo: x.ativo, cnhCategoria: x.cnh_categoria, cnhVencimento: x.cnh_vencimento, admissao: x.data_admissao, temLogin: x.tem_login, abastecimentos: x.abastecimentos }));
      return { de: inicio, ate: somarDias(fim, -1), hoje, fornecedores, clientes, colaboradores };
    });

    // ======================= Configurações (usuários e atividade) =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/configuracoes', async (req) => {
      const empresaId = empresaDo(req);
      const { inicio, fim } = periodo(req.query, 1);
      const usuarios = (
        await banco.query(
          `SELECT u.id, u.nome, u.email, u.perfil, u.ativo, u.ultimo_acesso,
                  (SELECT count(*)::int FROM auditoria a WHERE a.usuario_id = u.id AND a.data_hora >= $2::date AND a.data_hora < $3::date AND a.acao <> 'entrar') AS alteracoes
             FROM usuarios u WHERE u.empresa_id = $1 AND u.excluido_em IS NULL ORDER BY u.ativo DESC, u.nome`,
          [empresaId, inicio, fim],
        )
      ).rows.map((x) => ({ id: x.id, nome: x.nome, email: x.email, perfil: x.perfil, ativo: x.ativo, ultimoAcesso: x.ultimo_acesso, alteracoes: x.alteracoes }));
      const resumo = (
        await banco.query(
          `SELECT entidade, acao, count(*)::int AS n FROM auditoria WHERE empresa_id = $1 AND data_hora >= $2::date AND data_hora < $3::date GROUP BY 1, 2 ORDER BY 3 DESC`,
          [empresaId, inicio, fim],
        )
      ).rows;
      const atividade = (
        await banco.query(
          `SELECT a.data_hora, a.acao, a.entidade, a.entidade_id, coalesce(u.nome, 'Sistema') AS usuario
             FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
            WHERE a.empresa_id = $1 AND a.data_hora >= $2::date AND a.data_hora < $3::date
            ORDER BY a.data_hora DESC LIMIT 300`,
          [empresaId, inicio, fim],
        )
      ).rows.map((x) => ({ dataHora: x.data_hora, acao: x.acao, entidade: x.entidade, entidadeId: x.entidade_id, usuario: x.usuario }));
      return { de: inicio, ate: somarDias(fim, -1), usuarios, resumo, atividade };
    });

    // ======================= Gerencial: resumo integrado por mês =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/gerencial', async (req) => {
      const empresaId = empresaDo(req);
      const { meses, inicio, fim } = periodo(req.query, 6);
      const brutos = await brutosPorMes(banco, empresaId, meses, inicio, fim);
      const notas = (
        await banco.query(
          `SELECT to_char(data_emissao, 'YYYY-MM') AS mes, count(*) FILTER (WHERE status = 'confirmada')::int AS confirmadas,
                  count(*) FILTER (WHERE status IN ('rascunho', 'aguardando_conferencia'))::int AS pendentes,
                  coalesce(sum(total_centavos) FILTER (WHERE status = 'confirmada' AND direcao = 'entrada'), 0) AS compras,
                  coalesce(sum(total_centavos) FILTER (WHERE status = 'confirmada' AND direcao = 'saida'), 0) AS vendas
             FROM notas_fiscais WHERE empresa_id = $1 AND excluido_em IS NULL AND data_emissao >= $2 AND data_emissao < $3 GROUP BY 1`,
          [empresaId, inicio, fim],
        )
      ).rows;
      const caixa = (
        await banco.query(
          `SELECT to_char(p.data_pagamento, 'YYYY-MM') AS mes, l.tipo, sum(p.valor_pago_centavos) AS v
             FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
            WHERE p.empresa_id = $1 AND p.status = 'paga' AND l.status = 'confirmado' AND l.excluido_em IS NULL AND p.data_pagamento >= $2 AND p.data_pagamento < $3
            GROUP BY 1, 2`,
          [empresaId, inicio, fim],
        )
      ).rows;
      const linhas = meses.map((m) => {
        const b = brutos[m] ?? BRUTO_ZERO;
        const n = notas.find((x) => x.mes === m);
        const custoFrota = b.custoFrotaLancado + b.custoFrotaSemNota;
        return {
          mes: m,
          receita: b.receita / 100,
          custoFrota: custoFrota / 100,
          custoFrotaSemNota: b.custoFrotaSemNota / 100,
          frotaSobreReceita: b.receita ? custoFrota / b.receita : null,
          lucroBruto: b.lucroBruto / 100,
          resultado: b.resultado / 100,
          recebido: reais(caixa.find((x) => x.mes === m && x.tipo === 'receita')?.v),
          pago: reais(caixa.find((x) => x.mes === m && x.tipo === 'despesa')?.v),
          litros: b.dieselLitros,
          km: b.kmBet,
          horas: b.horasBomba,
          receitaPorKm: b.kmBet ? b.receita / 100 / b.kmBet : null,
          osConcluidas: b.osConcluidas,
          notasCompra: reais(n?.compras),
          notasVenda: reais(n?.vendas),
          notasConfirmadas: n?.confirmadas ?? 0,
          notasPendentes: n?.pendentes ?? 0,
          abastecimentosComNota: b.abastPosto ? b.abastComNota / b.abastPosto : null,
        };
      });
      return { meses, linhas };
    });

    // ======================= Indicadores =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/indicadores', async (req) => {
      const empresaId = empresaDo(req);
      const { meses, inicio, fim, hoje } = periodo(req.query, 6);
      const brutos = await brutosPorMes(banco, empresaId, meses, inicio, fim);
      const retrato = await retratoAtual(banco, empresaId, hoje);
      return { meses, hoje, indicadores: calcularIndicadores(meses, brutos, retrato) };
    });
  };
}

/** Números brutos de cada mês usados pelos indicadores e pelo resumo gerencial. */
async function brutosPorMes(banco: Banco, empresaId: string, meses: string[], inicio: string, fim: string): Promise<Record<string, Bruto>> {
  const r: Record<string, Bruto> = Object.fromEntries(meses.map((m) => [m, { ...BRUTO_ZERO }]));
  const add = (mes: string, k: keyof Bruto, v: unknown) => {
    if (r[mes]) r[mes][k] += num(v);
  };
  const p = [empresaId, inicio, fim];

  // DRE por competência (impostos lançados).
  const categorias: CategoriaDre[] = (await banco.query('SELECT id, codigo, nome, tipo, linha_dre FROM plano_contas WHERE empresa_id = $1', [empresaId])).rows.map((x) => ({
    id: x.id, codigo: x.codigo, nome: x.nome, tipo: x.tipo, linha: x.linha_dre,
  }));
  const valores = (
    await banco.query(
      `SELECT to_char(l.competencia, 'YYYY-MM') AS mes, a.plano_conta_id, sum(a.valor_centavos) AS v
         FROM apropriacoes a JOIN lancamentos l ON l.id = a.lancamento_id
        WHERE l.empresa_id = $1 AND l.status = 'confirmado' AND l.excluido_em IS NULL AND l.competencia >= $2 AND l.competencia < $3 GROUP BY 1, 2`,
      p,
    )
  ).rows.map((x) => ({ mes: x.mes, categoriaId: x.plano_conta_id, centavos: Number(x.v) }));
  const dre = montarDre(meses, categorias, valores, { impostos: 'lancados', regime: 'simples', aliquotas: {} });
  const linha = (k: string) => dre.linhas.find((l) => l.chave === k)!;
  for (const m of meses) {
    r[m].receita = linha('receita_bruta').valores[m];
    r[m].lucroBruto = linha('lucro_bruto').valores[m];
    r[m].resultado = linha('resultado_liquido').valores[m];
    r[m].custoFrotaLancado = -linha('custo_frota').valores[m];
  }

  // Abastecimentos: consumo entre abastecimentos, valor, vínculo com nota.
  const ab = (
    await banco.query(
      `WITH a AS (
         SELECT a.*, v.tipo AS vtipo, lag(a.km) OVER w AS km_ant, lag(a.horimetro) OVER w AS h_ant
           FROM abastecimentos a JOIN veiculos v ON v.id = a.veiculo_id
          WHERE a.empresa_id = $1 AND a.excluido_em IS NULL WINDOW w AS (PARTITION BY a.veiculo_id ORDER BY a.data_hora))
       SELECT ${MES_TS('data_hora')} AS mes, (vtipo::text LIKE 'bomba%') AS bomba,
              sum(litros) AS litros, coalesce(sum(valor_total_centavos), 0) AS valor,
              coalesce(sum(litros) FILTER (WHERE valor_total_centavos > 0), 0) AS litros_com_valor,
              coalesce(sum(km - km_ant) FILTER (WHERE km_ant IS NOT NULL AND km >= km_ant), 0) AS km,
              coalesce(sum(litros) FILTER (WHERE km_ant IS NOT NULL AND km >= km_ant), 0) AS litros_km,
              coalesce(sum(horimetro - h_ant) FILTER (WHERE h_ant IS NOT NULL AND horimetro >= h_ant), 0) AS horas,
              coalesce(sum(litros) FILTER (WHERE h_ant IS NOT NULL AND horimetro >= h_ant), 0) AS litros_h,
              count(*) FILTER (WHERE origem = 'posto')::int AS posto,
              count(*) FILTER (WHERE origem = 'posto' AND nota_item_id IS NOT NULL)::int AS com_nota,
              coalesce(sum(valor_total_centavos) FILTER (WHERE origem = 'posto' AND nota_item_id IS NULL), 0) AS sem_nota
         FROM a WHERE data_hora >= $2::date AND data_hora < $3::date GROUP BY 1, 2`,
      p,
    )
  ).rows;
  for (const x of ab) {
    add(x.mes, 'dieselValor', x.valor);
    add(x.mes, 'dieselLitros', x.litros_com_valor);
    add(x.mes, 'abastPosto', x.posto);
    add(x.mes, 'abastComNota', x.com_nota);
    add(x.mes, 'custoFrotaSemNota', x.sem_nota);
    add(x.mes, x.bomba ? 'custoBomba' : 'custoBet', x.sem_nota);
    if (x.bomba) {
      add(x.mes, 'horasBomba', x.horas);
      add(x.mes, 'litrosBomba', x.litros_h);
    } else {
      add(x.mes, 'kmBet', x.km);
      add(x.mes, 'litrosBet', x.litros_km);
    }
  }

  // Ordens de serviço concluídas.
  const os = (
    await banco.query(
      `SELECT to_char(o.conclusao, 'YYYY-MM') AS mes, (v.tipo::text LIKE 'bomba%') AS bomba, count(*)::int AS n, sum(o.conclusao - o.abertura) AS dias,
              coalesce(sum((SELECT sum(round(i.quantidade * i.valor_unitario_centavos)) FROM os_itens i WHERE i.os_id = o.id AND i.excluido_em IS NULL)), 0) AS custo,
              coalesce(sum((SELECT sum(round(i.quantidade * i.valor_unitario_centavos)) FROM os_itens i WHERE i.os_id = o.id AND i.excluido_em IS NULL AND i.nota_item_id IS NULL)), 0) AS sem_nota
         FROM ordens_servico o JOIN veiculos v ON v.id = o.veiculo_id
        WHERE o.empresa_id = $1 AND o.status = 'concluida' AND o.conclusao >= $2 AND o.conclusao < $3 GROUP BY 1, 2`,
      p,
    )
  ).rows;
  for (const x of os) {
    add(x.mes, 'osConcluidas', x.n);
    add(x.mes, 'osDiasParado', x.dias);
    add(x.mes, 'osCusto', x.custo);
    add(x.mes, 'custoFrotaSemNota', x.sem_nota);
    add(x.mes, x.bomba ? 'custoBomba' : 'custoBet', x.sem_nota);
  }

  // Custo lançado com veículo (notas e lançamentos), separado entre bombas e demais.
  const cv = (
    await banco.query(
      `SELECT to_char(l.competencia, 'YYYY-MM') AS mes, (v.tipo::text LIKE 'bomba%') AS bomba, sum(a.valor_centavos) AS v
         FROM apropriacoes a JOIN lancamentos l ON l.id = a.lancamento_id JOIN plano_contas pc ON pc.id = a.plano_conta_id JOIN veiculos v ON v.id = a.veiculo_id
        WHERE l.empresa_id = $1 AND l.status = 'confirmado' AND l.excluido_em IS NULL AND l.tipo = 'despesa' AND pc.linha_dre <> 'fora_dre'
          AND l.competencia >= $2 AND l.competencia < $3 GROUP BY 1, 2`,
      p,
    )
  ).rows;
  for (const x of cv) add(x.mes, x.bomba ? 'custoBomba' : 'custoBet', x.v);

  // Produção: volume, devolvido, cimento e material teórico das cargas; material lançado (3.1 a 3.4).
  const prod = (
    await banco.query(
      `SELECT ${MES_TS('c.data_hora')} AS mes, sum(c.volume_m3) AS m3, sum(c.devolvido_m3) AS devolvido,
              count(DISTINCT (c.betoneira_id, (c.data_hora AT TIME ZONE 'America/Sao_Paulo')::date))::int AS bet_dias,
              coalesce(sum((SELECT sum(cc.quantidade * cc.custo_unitario_centavos) FROM cargas_consumo cc WHERE cc.carga_id = c.id)), 0) AS material,
              coalesce(sum((SELECT sum(CASE WHEN i.unidade = 't' THEN cc.quantidade * 1000 ELSE cc.quantidade END) FROM cargas_consumo cc JOIN insumos i ON i.id = cc.insumo_id
                             WHERE cc.carga_id = c.id AND i.tipo = 'cimento')), 0) AS cimento
         FROM cargas c WHERE c.empresa_id = $1 AND c.status = 'produzida'
          AND (c.data_hora AT TIME ZONE 'America/Sao_Paulo')::date >= $2::date AND (c.data_hora AT TIME ZONE 'America/Sao_Paulo')::date < $3::date
        GROUP BY 1`,
      p,
    )
  ).rows;
  for (const x of prod) {
    add(x.mes, 'm3Produzido', x.m3);
    add(x.mes, 'm3Devolvido', x.devolvido);
    add(x.mes, 'betoneiraDias', x.bet_dias);
    add(x.mes, 'materialTeorico', x.material);
    add(x.mes, 'cimentoKg', x.cimento);
  }
  const mat = (
    await banco.query(
      `SELECT to_char(l.competencia, 'YYYY-MM') AS mes, sum(a.valor_centavos) AS v
         FROM apropriacoes a JOIN lancamentos l ON l.id = a.lancamento_id JOIN plano_contas pc ON pc.id = a.plano_conta_id
        WHERE l.empresa_id = $1 AND l.status = 'confirmado' AND l.excluido_em IS NULL AND l.tipo = 'despesa' AND pc.codigo IN ('3.1', '3.2', '3.3', '3.4')
          AND l.competencia >= $2 AND l.competencia < $3 GROUP BY 1`,
      p,
    )
  ).rows;
  for (const x of mat) add(x.mes, 'materialLancado', x.v);

  // Qualidade: resultados na idade de controle, slump e corpos de prova no prazo.
  const idadeControle = (await banco.query('SELECT idade_controle FROM qualidade_config WHERE empresa_id = $1', [empresaId])).rows[0]?.idade_controle ?? 28;
  const qa = (
    await banco.query(
      `SELECT ${MES_TS('a.data_moldagem')} AS mes, a.slump_cm, t.slump AS faixa, t.fck,
              (SELECT max(cp.resistencia_mpa) FROM corpos_prova cp WHERE cp.amostra_id = a.id AND cp.situacao = 'rompido' AND cp.idade_dias = $4) AS resultado
         FROM amostras a JOIN cargas ca ON ca.id = a.carga_id JOIN tracos t ON t.id = ca.traco_id
        WHERE a.empresa_id = $1 AND a.status = 'ativa'
          AND (a.data_moldagem AT TIME ZONE 'America/Sao_Paulo')::date >= $2::date AND (a.data_moldagem AT TIME ZONE 'America/Sao_Paulo')::date < $3::date`,
      [...p, idadeControle],
    )
  ).rows;
  for (const x of qa) {
    if (x.resultado !== null && x.fck) {
      add(x.mes, 'qualN', 1);
      add(x.mes, 'qualRelSoma', Number(x.resultado) / Number(x.fck));
      if (Number(x.resultado) < Number(x.fck)) add(x.mes, 'qualAbaixo', 1);
    }
    const f = faixaSlump(x.faixa);
    if (x.slump_cm !== null && f) {
      add(x.mes, 'slumpMedidos', 1);
      if (Number(x.slump_cm) < f[0] || Number(x.slump_cm) > f[1]) add(x.mes, 'slumpFora', 1);
    }
  }
  const cpsMes = (
    await banco.query(
      `SELECT to_char(cp.data_prevista, 'YYYY-MM') AS mes, count(*)::int AS previstos,
              count(*) FILTER (WHERE cp.situacao = 'rompido' AND cp.data_ruptura <= cp.data_prevista)::int AS no_prazo
         FROM corpos_prova cp JOIN amostras a ON a.id = cp.amostra_id
        WHERE cp.empresa_id = $1 AND a.status = 'ativa' AND cp.situacao <> 'descartado' AND cp.data_prevista >= $2 AND cp.data_prevista < $3
          AND cp.data_prevista <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
        GROUP BY 1`,
      p,
    )
  ).rows;
  for (const x of cpsMes) {
    add(x.mes, 'cpsPrevistos', x.previstos);
    add(x.mes, 'cpsNoPrazo', x.no_prazo);
  }

  // Prazos médios de recebimento e pagamento.
  const prazos = (
    await banco.query(
      `SELECT to_char(p.data_pagamento, 'YYYY-MM') AS mes, l.tipo, sum(p.valor_pago_centavos * greatest(p.data_pagamento - l.competencia, 0)) AS ponderado,
              sum(p.valor_pago_centavos) AS v
         FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
        WHERE p.empresa_id = $1 AND p.status = 'paga' AND l.status = 'confirmado' AND l.excluido_em IS NULL AND p.data_pagamento >= $2 AND p.data_pagamento < $3
        GROUP BY 1, 2`,
      p,
    )
  ).rows;
  for (const x of prazos) {
    if (x.tipo === 'receita') {
      add(x.mes, 'recPonderado', x.ponderado);
      add(x.mes, 'recValor', x.v);
    } else {
      add(x.mes, 'pagPonderado', x.ponderado);
      add(x.mes, 'pagValor', x.v);
    }
  }
  return r;
}

async function retratoAtual(banco: Banco, empresaId: string, hoje: string): Promise<Retrato> {
  const f = (
    await banco.query(
      `SELECT count(*) FILTER (WHERE status = 'disponivel')::int AS disp, count(*) FILTER (WHERE status <> 'inativo')::int AS ativos
         FROM veiculos WHERE empresa_id = $1 AND excluido_em IS NULL`,
      [empresaId],
    )
  ).rows[0];
  const rev = await situacaoManutencao(banco, empresaId);
  const rec = (
    await banco.query(
      `SELECT coalesce(sum(p.valor_centavos), 0) AS aberto, coalesce(sum(p.valor_centavos) FILTER (WHERE p.vencimento < $2), 0) AS vencido
         FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
        WHERE p.empresa_id = $1 AND p.status = 'aberta' AND l.tipo = 'receita' AND l.status = 'confirmado' AND l.excluido_em IS NULL`,
      [empresaId, hoje],
    )
  ).rows[0];
  const saldo = (await banco.query(`SELECT coalesce(sum(${SQL_SALDO}), 0) AS s FROM contas_financeiras c WHERE c.empresa_id = $1 AND c.excluido_em IS NULL`, [empresaId])).rows[0].s;
  const saidas = (
    await banco.query(
      `SELECT coalesce(sum(p.valor_pago_centavos), 0) AS v FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
        WHERE p.empresa_id = $1 AND p.status = 'paga' AND l.tipo = 'despesa' AND l.status = 'confirmado' AND l.excluido_em IS NULL
          AND p.data_pagamento > $2::date - 90 AND p.data_pagamento <= $2`,
      [empresaId, hoje],
    )
  ).rows[0].v;
  const notas = (
    await banco.query("SELECT count(*)::int AS n FROM notas_fiscais WHERE empresa_id = $1 AND excluido_em IS NULL AND status IN ('rascunho', 'aguardando_conferencia')", [empresaId])
  ).rows[0].n;
  // Último inventário: falta (em valor) e consumo teórico (em valor) do período que ele fechou.
  const inv = (
    await banco.query(
      `SELECT sum(ii.diferenca * coalesce(ii.custo_unitario_centavos, 0)) AS diferenca, sum(ii.consumo_periodo * coalesce(ii.custo_unitario_centavos, 0)) AS consumo
         FROM inventarios_itens ii WHERE ii.inventario_id = (SELECT id FROM inventarios WHERE empresa_id = $1 ORDER BY data DESC, criado_em DESC LIMIT 1)
          AND ii.consumo_periodo IS NOT NULL`,
      [empresaId],
    )
  ).rows[0];
  const comRegistro = rev.filter((x: { situacao: string }) => x.situacao !== 'sem_registro');
  return {
    disponiveis: f.disp,
    ativos: f.ativos,
    revisoesEmDia: comRegistro.filter((x: { situacao: string }) => x.situacao === 'em_dia' || x.situacao === 'proxima').length,
    revisoesComRegistro: comRegistro.length,
    receberAberto: num(rec.aberto),
    receberVencido: num(rec.vencido),
    saldoCaixa: num(saldo),
    saidasDia: num(saidas) / 90,
    notasPendentes: notas,
    perdaInventario: num(inv?.diferenca),
    consumoInventario: num(inv?.consumo),
    calibracoesVencidas: (
      await banco.query('SELECT count(*)::int AS n FROM equipamentos WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo AND ultima_calibracao + validade_dias < $2', [empresaId, hoje])
    ).rows[0].n,
  };
}
