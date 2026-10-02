// Rotas de abastecimento e consumo.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { esquemaAbastecimento, esquemaAlterarAbastecimento, esquemaFiltroAbastecimentos } from '../esquemas-abastecimento.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { conferirLeituras, consumoDoAbastecimento, consumoMedio, pioraDeConsumo, saltoSuspeito, type Consumo } from '../lib/consumo.ts';
import { empresaDo, exigir } from '../sessao.ts';

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const dataBr = (d: Date | string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));

// Todos os abastecimentos válidos com a leitura do anterior do mesmo veículo.
const CTE = `
  WITH base AS (
    SELECT a.*,
           lag(a.km) OVER w AS km_ant,
           lag(a.horimetro) OVER w AS hor_ant,
           lag(a.id) OVER w AS id_ant
      FROM abastecimentos a
     WHERE a.empresa_id = $1 AND a.excluido_em IS NULL
    WINDOW w AS (PARTITION BY a.veiculo_id ORDER BY a.data_hora, a.criado_em)
  )`;

type Linha = Record<string, any>;

function abastecimentoPublico(r: Linha) {
  const litros = Number(r.litros);
  const atual = { km: num(r.km), horimetro: num(r.horimetro), litros };
  const consumo = consumoDoAbastecimento(atual, r.id_ant ? { km: num(r.km_ant), horimetro: num(r.hor_ant) } : null);
  const valor = r.valor_total_centavos === null ? null : Number(r.valor_total_centavos) / 100;
  return {
    id: r.id,
    veiculoId: r.veiculo_id,
    veiculoCodigo: r.codigo,
    motoristaId: r.motorista_id,
    motoristaNome: r.motorista_nome ?? null,
    dataHora: new Date(r.data_hora).toISOString(),
    litros,
    valorTotal: valor,
    precoLitro: valor !== null && litros > 0 ? Math.round((valor / litros) * 100) / 100 : null,
    km: atual.km,
    horimetro: atual.horimetro,
    origem: r.origem,
    posto: r.posto,
    tanqueCheio: r.tanque_cheio,
    observacoes: r.observacoes,
    temNota: !!r.nota_item_id,
    ...consumo,
  };
}

/** Consumo por veículo no período, com o último consumo e a piora em relação à média de 90 dias. */
export async function consumoDaFrota(c: Cliente, empresaId: string, dias: number) {
  const r = await c.query(
    `${CTE}
     SELECT b.*, v.codigo, v.tipo, v.status
       FROM base b JOIN veiculos v ON v.id = b.veiculo_id
      WHERE b.data_hora >= now() - make_interval(days => $2)
      ORDER BY b.veiculo_id, b.data_hora, b.criado_em`,
    [empresaId, Math.max(dias, 90)],
  );
  const limite = Date.now() - dias * 86_400_000;
  const porVeiculo = new Map<string, { codigo: string; tipo: string; status: string; noPeriodo: { litros: number; valor: number; consumo: Consumo }[]; em90: { litros: number; consumo: Consumo }[]; ultimo: Consumo | null; ultimaData: string | null }>();
  for (const l of r.rows) {
    const a = abastecimentoPublico(l);
    let v = porVeiculo.get(l.veiculo_id);
    if (!v) {
      v = { codigo: l.codigo, tipo: l.tipo, status: l.status, noPeriodo: [], em90: [], ultimo: null, ultimaData: null };
      porVeiculo.set(l.veiculo_id, v);
    }
    const item = { litros: a.litros, valor: a.valorTotal ?? 0, consumo: a as Consumo };
    v.em90.push(item);
    if (new Date(a.dataHora).getTime() >= limite) v.noPeriodo.push(item);
    if (a.kmPorLitro !== null || a.litrosPorHora !== null) {
      v.ultimo = { kmRodados: a.kmRodados, horas: a.horas, kmPorLitro: a.kmPorLitro, litrosPorHora: a.litrosPorHora };
      v.ultimaData = a.dataHora;
    }
  }
  return [...porVeiculo.entries()]
    .map(([veiculoId, v]) => {
      const periodo = consumoMedio(v.noPeriodo);
      const media90 = consumoMedio(v.em90);
      const valor = Math.round(v.noPeriodo.reduce((s, i) => s + i.valor, 0) * 100) / 100;
      return {
        veiculoId,
        codigo: v.codigo,
        tipo: v.tipo,
        abastecimentos: v.noPeriodo.length,
        litros: periodo.litros,
        valor,
        km: periodo.km,
        horas: periodo.horas,
        kmPorLitro: periodo.kmPorLitro,
        litrosPorHora: periodo.litrosPorHora,
        media90: { kmPorLitro: media90.kmPorLitro, litrosPorHora: media90.litrosPorHora },
        ultimo: v.ultimo,
        ultimaData: v.ultimaData,
        piora: v.ultimo && v.status !== 'inativo' ? pioraDeConsumo(v.ultimo, media90) : null,
      };
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
}

async function vizinhos(c: Cliente, empresaId: string, veiculoId: string, dataHora: Date, ignorarId: string | null) {
  const anterior = (
    await c.query(
      `SELECT km, horimetro, data_hora FROM abastecimentos
        WHERE empresa_id = $1 AND veiculo_id = $2 AND excluido_em IS NULL AND data_hora <= $3 AND ($4::uuid IS NULL OR id <> $4)
        ORDER BY data_hora DESC, criado_em DESC LIMIT 1`,
      [empresaId, veiculoId, dataHora, ignorarId],
    )
  ).rows[0];
  const seguinte = (
    await c.query(
      `SELECT km, horimetro, data_hora FROM abastecimentos
        WHERE empresa_id = $1 AND veiculo_id = $2 AND excluido_em IS NULL AND data_hora > $3 AND ($4::uuid IS NULL OR id <> $4)
        ORDER BY data_hora, criado_em LIMIT 1`,
      [empresaId, veiculoId, dataHora, ignorarId],
    )
  ).rows[0];
  const ler = (x: Linha | undefined) => (x ? { km: num(x.km), horimetro: num(x.horimetro), data: dataBr(x.data_hora) } : null);
  return { anterior: ler(anterior), seguinte: ler(seguinte) };
}

async function motoristaDoUsuario(c: Cliente, req: FastifyRequest): Promise<string | null> {
  const r = await c.query('SELECT motorista_id FROM usuarios WHERE id = $1', [req.usuario!.id]);
  return r.rows[0]?.motorista_id ?? null;
}

export function rotasAbastecimento(banco: Banco) {
  return async function (app: FastifyInstance) {
    const gestao = exigir(banco, 'dono', 'gestor');
    const todos = exigir(banco, 'dono', 'gestor', 'motorista');

    app.get('/abastecimentos', { preHandler: todos }, async (req) => {
      const f = esquemaFiltroAbastecimentos.parse(req.query);
      const empresaId = empresaDo(req);
      const motorista = req.usuario!.perfil === 'motorista';
      const meuMotorista = motorista ? await motoristaDoUsuario(banco, req) : null;
      if (motorista && !meuMotorista) return { abastecimentos: [] };
      const r = await banco.query(
        `${CTE}
         SELECT b.*, v.codigo, m.nome AS motorista_nome
           FROM base b
           JOIN veiculos v ON v.id = b.veiculo_id
           LEFT JOIN motoristas m ON m.id = b.motorista_id
          WHERE b.data_hora >= now() - make_interval(days => $2)
            AND ($3::uuid IS NULL OR b.veiculo_id = $3)
            AND ($4::uuid IS NULL OR b.motorista_id = $4)
          ORDER BY b.data_hora DESC, b.criado_em DESC
          LIMIT 1000`,
        [empresaId, motorista ? Math.min(f.dias, 60) : f.dias, f.veiculoId ?? null, meuMotorista],
      );
      return { abastecimentos: r.rows.map(abastecimentoPublico) };
    });

    // Última leitura do veículo, para orientar quem está lançando.
    app.get<{ Querystring: { veiculoId?: string } }>('/abastecimentos/ultima-leitura', { preHandler: todos }, async (req) => {
      const empresaId = empresaDo(req);
      const id = req.query.veiculoId;
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new ErroHttp(400, 'Escolha o veículo.');
      const v = (await banco.query('SELECT km_atual, horimetro_atual FROM veiculos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [id, empresaId])).rows[0];
      if (!v) throw naoEncontrado('Veículo');
      const ult = (
        await banco.query(
          `SELECT km, horimetro, data_hora FROM abastecimentos WHERE empresa_id = $1 AND veiculo_id = $2 AND excluido_em IS NULL
            ORDER BY data_hora DESC, criado_em DESC LIMIT 1`,
          [empresaId, id],
        )
      ).rows[0];
      return {
        km: ult ? num(ult.km) : num(v.km_atual),
        horimetro: ult ? num(ult.horimetro) : num(v.horimetro_atual),
        dataHora: ult ? new Date(ult.data_hora).toISOString() : null,
      };
    });

    app.post('/abastecimentos', { preHandler: todos }, async (req, reply) => {
      const d = esquemaAbastecimento.parse(req.body);
      const empresaId = empresaDo(req);
      const motorista = req.usuario!.perfil === 'motorista';
      const dataHora = d.dataHora ?? new Date();
      if (dataHora.getTime() > Date.now() + 10 * 60_000) throw new ErroHttp(400, 'A data e hora não podem estar no futuro.');
      if (motorista && Date.now() - dataHora.getTime() > 3 * 86_400_000) {
        throw new ErroHttp(400, 'Abastecimentos com mais de 3 dias devem ser lançados pelo gestor.');
      }
      const novo = await emTransacao(banco, async (c) => {
        const v = (await c.query('SELECT * FROM veiculos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [d.veiculoId, empresaId])).rows[0];
        if (!v) throw naoEncontrado('Veículo');
        if (v.status === 'inativo') throw new ErroHttp(400, 'Este veículo está inativo.');

        let motoristaId: string | null;
        if (motorista) {
          motoristaId = await motoristaDoUsuario(c, req);
          if (!motoristaId) throw new ErroHttp(400, 'Seu acesso ainda não está ligado a um cadastro de motorista. Peça ao gestor para fazer isso em Motoristas.');
        } else {
          motoristaId = d.motoristaId ?? null;
          if (motoristaId) {
            const m = await c.query('SELECT 1 FROM motoristas WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [motoristaId, empresaId]);
            if (!m.rowCount) throw new ErroHttp(400, 'Motorista não encontrado.');
          }
        }

        const leitura = { km: d.km, horimetro: d.horimetro };
        const { anterior, seguinte } = await vizinhos(c, empresaId, v.id, dataHora, null);
        const erro = conferirLeituras(leitura, anterior, seguinte);
        if (erro) throw new ErroHttp(400, erro);
        const salto = saltoSuspeito(leitura, anterior);
        if (salto && !d.confirmarSalto) throw new ErroHttp(422, salto);

        const a = (
          await c.query(
            `INSERT INTO abastecimentos (empresa_id, veiculo_id, motorista_id, registrado_por_id, data_hora, litros, valor_total_centavos, km, horimetro, origem, posto, tanque_cheio, observacoes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [empresaId, v.id, motoristaId, req.usuario!.id, dataHora, d.litros, d.valorTotal === null ? null : Math.round(d.valorTotal * 100), d.km, d.horimetro, d.origem, d.posto, d.tanqueCheio, d.observacoes],
          )
        ).rows[0];
        await c.query(
          `UPDATE veiculos SET km_atual = GREATEST(km_atual, COALESCE($2, km_atual)), horimetro_atual = GREATEST(horimetro_atual, COALESCE($3, horimetro_atual)), atualizado_em = now() WHERE id = $1`,
          [v.id, d.km, d.horimetro],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'abastecimentos', entidadeId: a.id, depois: a });
        return a;
      });
      const r = await banco.query(
        `${CTE} SELECT b.*, v.codigo, m.nome AS motorista_nome FROM base b JOIN veiculos v ON v.id = b.veiculo_id LEFT JOIN motoristas m ON m.id = b.motorista_id WHERE b.id = $2`,
        [empresaId, novo.id],
      );
      reply.code(201);
      return { abastecimento: abastecimentoPublico(r.rows[0]) };
    });

    app.patch<{ Params: { id: string } }>('/abastecimentos/:id', { preHandler: gestao }, async (req) => {
      const d = esquemaAlterarAbastecimento.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM abastecimentos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Abastecimento');
        const veiculoId = d.veiculoId ?? antes.veiculo_id;
        const dataHora = d.dataHora ?? new Date(antes.data_hora);
        const km = d.km !== undefined ? d.km : num(antes.km);
        const horimetro = d.horimetro !== undefined ? d.horimetro : num(antes.horimetro);
        const { anterior, seguinte } = await vizinhos(c, empresaId, veiculoId, dataHora, antes.id);
        const erro = conferirLeituras({ km, horimetro }, anterior, seguinte);
        if (erro) throw new ErroHttp(400, erro);
        const salto = saltoSuspeito({ km, horimetro }, anterior);
        if (salto && !d.confirmarSalto) throw new ErroHttp(422, salto);
        const depois = (
          await c.query(
            `UPDATE abastecimentos SET veiculo_id = $3, motorista_id = $4, data_hora = $5, litros = $6, valor_total_centavos = $7, km = $8, horimetro = $9,
                    origem = $10, posto = $11, tanque_cheio = $12, observacoes = $13, atualizado_em = now()
              WHERE id = $1 AND empresa_id = $2 RETURNING *`,
            [
              antes.id,
              empresaId,
              veiculoId,
              d.motoristaId !== undefined ? d.motoristaId : antes.motorista_id,
              dataHora,
              d.litros ?? antes.litros,
              d.valorTotal !== undefined ? (d.valorTotal === null ? null : Math.round(d.valorTotal * 100)) : antes.valor_total_centavos,
              km,
              horimetro,
              d.origem ?? antes.origem,
              d.posto !== undefined ? d.posto : antes.posto,
              d.tanqueCheio ?? antes.tanque_cheio,
              d.observacoes !== undefined ? d.observacoes : antes.observacoes,
            ],
          )
        ).rows[0];
        await c.query(
          `UPDATE veiculos SET km_atual = GREATEST(km_atual, COALESCE($2, km_atual)), horimetro_atual = GREATEST(horimetro_atual, COALESCE($3, horimetro_atual)) WHERE id = $1`,
          [veiculoId, km, horimetro],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'abastecimentos', entidadeId: antes.id, antes, depois });
      });
      const r = await banco.query(
        `${CTE} SELECT b.*, v.codigo, m.nome AS motorista_nome FROM base b JOIN veiculos v ON v.id = b.veiculo_id LEFT JOIN motoristas m ON m.id = b.motorista_id WHERE b.id = $2`,
        [empresaId, req.params.id],
      );
      return { abastecimento: abastecimentoPublico(r.rows[0]) };
    });

    app.delete<{ Params: { id: string } }>('/abastecimentos/:id', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM abastecimentos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Abastecimento');
        if (antes.nota_item_id) throw new ErroHttp(400, 'Este abastecimento já está ligado a uma nota fiscal. Desfaça o vínculo antes de excluir.');
        await c.query('UPDATE abastecimentos SET excluido_em = now() WHERE id = $1', [antes.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'abastecimentos', entidadeId: antes.id, antes });
      });
      return { ok: true };
    });

    app.get('/consumo', { preHandler: gestao }, async (req) => {
      const f = esquemaFiltroAbastecimentos.parse(req.query);
      return { veiculos: await consumoDaFrota(banco, empresaDo(req), f.dias) };
    });
  };
}
