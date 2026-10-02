// Rotas da frota: veículos, documentos dos veículos, motoristas e alertas.
import type { FastifyInstance } from 'fastify';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import {
  esquemaAlterarDocumento,
  esquemaAlterarMotorista,
  esquemaAlterarVeiculo,
  esquemaDocumento,
  esquemaMotorista,
  esquemaVeiculo,
} from '../esquemas-frota.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { hojeBrasil, situacaoVencimento } from '../lib/frota.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { consumoDaFrota } from './abastecimentos.ts';

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const dataIso = (v: unknown) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

export function veiculoPublico(r: Record<string, any>) {
  return {
    id: r.id,
    codigo: r.codigo,
    tipo: r.tipo,
    placa: r.placa,
    marcaModelo: r.marca_modelo,
    ano: r.ano,
    capacidadeM3: num(r.capacidade_m3),
    alcanceLancaM: num(r.alcance_lanca_m),
    kmAtual: num(r.km_atual),
    horimetroAtual: num(r.horimetro_atual),
    status: r.status,
    observacoes: r.observacoes,
  };
}

export function documentoPublico(r: Record<string, any>, hoje: string) {
  const vencimento = dataIso(r.vencimento);
  return {
    id: r.id,
    veiculoId: r.veiculo_id,
    tipo: r.tipo,
    descricao: r.descricao,
    numero: r.numero,
    vencimento,
    valor: r.valor_centavos === null || r.valor_centavos === undefined ? null : Number(r.valor_centavos) / 100,
    ...situacaoVencimento(vencimento, hoje),
  };
}

export function motoristaPublico(r: Record<string, any>, hoje: string) {
  const cnhVencimento = dataIso(r.cnh_vencimento);
  const cnh = situacaoVencimento(cnhVencimento, hoje);
  return {
    id: r.id,
    nome: r.nome,
    telefone: r.telefone,
    cpf: r.cpf ? String(r.cpf).trim() : null,
    funcao: r.funcao,
    cnhNumero: r.cnh_numero,
    cnhCategoria: r.cnh_categoria,
    cnhVencimento,
    cnhSituacao: cnh.situacao,
    cnhDias: cnh.dias,
    cursos: r.cursos ?? [],
    ativo: r.ativo,
    usuarioId: r.usuario_id ?? null,
    usuarioEmail: r.usuario_email ?? null,
  };
}

// Campos do formulário (camelCase) → colunas do banco.
const COLUNAS_VEICULO: Record<string, string> = {
  codigo: 'codigo',
  tipo: 'tipo',
  placa: 'placa',
  marcaModelo: 'marca_modelo',
  ano: 'ano',
  capacidadeM3: 'capacidade_m3',
  alcanceLancaM: 'alcance_lanca_m',
  kmAtual: 'km_atual',
  horimetroAtual: 'horimetro_atual',
  status: 'status',
  observacoes: 'observacoes',
};
const COLUNAS_MOTORISTA: Record<string, string> = {
  nome: 'nome',
  telefone: 'telefone',
  cpf: 'cpf',
  funcao: 'funcao',
  cnhNumero: 'cnh_numero',
  cnhCategoria: 'cnh_categoria',
  cnhVencimento: 'cnh_vencimento',
  cursos: 'cursos',
  ativo: 'ativo',
};
const COLUNAS_DOCUMENTO: Record<string, string> = {
  tipo: 'tipo',
  descricao: 'descricao',
  numero: 'numero',
  vencimento: 'vencimento',
  valor: 'valor_centavos',
};

/** Monta "col1 = $3, col2 = $4" a partir dos campos enviados. */
function montarSet(dados: Record<string, unknown>, colunas: Record<string, string>, inicio: number) {
  const partes: string[] = [];
  const valores: unknown[] = [];
  for (const [campo, valor] of Object.entries(dados)) {
    const coluna = colunas[campo];
    if (!coluna || valor === undefined) continue;
    let v = valor;
    if (coluna === 'valor_centavos') v = valor === null ? null : Math.round(Number(valor) * 100);
    if (coluna === 'cursos') v = JSON.stringify(valor);
    valores.push(v);
    partes.push(`${coluna} = $${inicio + valores.length - 1}`);
  }
  return { sql: partes.join(', '), valores };
}

async function veiculoDaEmpresa(c: Cliente, id: string, empresaId: string, travar = false) {
  const r = await c.query(`SELECT * FROM veiculos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL ${travar ? 'FOR UPDATE' : ''}`, [id, empresaId]);
  if (!r.rows[0]) throw naoEncontrado('Veículo');
  return r.rows[0];
}

const SQL_MOTORISTAS = `
  SELECT m.*, u.id AS usuario_id, u.email AS usuario_email
    FROM motoristas m
    LEFT JOIN usuarios u ON u.motorista_id = m.id AND u.excluido_em IS NULL
   WHERE m.empresa_id = $1 AND m.excluido_em IS NULL`;

export function rotasFrota(banco: Banco) {
  return async function (app: FastifyInstance) {
    const gestao = exigir(banco, 'dono', 'gestor');
    const todos = exigir(banco, 'dono', 'gestor', 'motorista');

    // ---------- Veículos ----------
    app.get('/veiculos', { preHandler: todos }, async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const r = await banco.query(
        `SELECT v.*,
                (SELECT count(*)::int FROM documentos_veiculo d
                  WHERE d.veiculo_id = v.id AND d.excluido_em IS NULL AND d.vencimento < $2) AS docs_vencidos,
                (SELECT count(*)::int FROM documentos_veiculo d
                  WHERE d.veiculo_id = v.id AND d.excluido_em IS NULL AND d.vencimento >= $2 AND d.vencimento <= ($2::date + 30)) AS docs_vencendo
           FROM veiculos v
          WHERE v.empresa_id = $1 AND v.excluido_em IS NULL
          ORDER BY (v.status = 'inativo'), v.tipo, v.codigo`,
        [empresaId, hoje],
      );
      const motorista = req.usuario!.perfil === 'motorista';
      return {
        veiculos: r.rows
          .filter((v) => !motorista || v.status !== 'inativo')
          .map((v) => ({ ...veiculoPublico(v), docsVencidos: v.docs_vencidos, docsVencendo: v.docs_vencendo })),
      };
    });

    app.post('/veiculos', { preHandler: gestao }, async (req, reply) => {
      const d = esquemaVeiculo.parse(req.body);
      const empresaId = empresaDo(req);
      const v = await emTransacao(banco, async (c) => {
        const novo = (
          await c.query(
            `INSERT INTO veiculos (empresa_id, codigo, tipo, placa, marca_modelo, ano, capacidade_m3, alcance_lanca_m, km_atual, horimetro_atual, status, observacoes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [empresaId, d.codigo, d.tipo, d.placa, d.marcaModelo, d.ano, d.capacidadeM3, d.alcanceLancaM, d.kmAtual ?? 0, d.horimetroAtual ?? 0, d.status, d.observacoes],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'veiculos', entidadeId: novo.id, depois: novo });
        return novo;
      });
      reply.code(201);
      return { veiculo: veiculoPublico(v) };
    });

    app.get<{ Params: { id: string } }>('/veiculos/:id', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const v = await veiculoDaEmpresa(banco, req.params.id, empresaId);
      const docs = await banco.query(
        `SELECT * FROM documentos_veiculo WHERE veiculo_id = $1 AND empresa_id = $2 AND excluido_em IS NULL
          ORDER BY vencimento NULLS LAST, tipo`,
        [v.id, empresaId],
      );
      return { veiculo: veiculoPublico(v), documentos: docs.rows.map((d) => documentoPublico(d, hoje)) };
    });

    app.patch<{ Params: { id: string } }>('/veiculos/:id', { preHandler: gestao }, async (req) => {
      const d = esquemaAlterarVeiculo.parse(req.body);
      const empresaId = empresaDo(req);
      const v = await emTransacao(banco, async (c) => {
        const antes = await veiculoDaEmpresa(c, req.params.id, empresaId, true);
        const { sql, valores } = montarSet(d, COLUNAS_VEICULO, 3);
        if (!sql) return antes;
        const depois = (
          await c.query(`UPDATE veiculos SET ${sql}, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 RETURNING *`, [antes.id, empresaId, ...valores])
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'veiculos', entidadeId: antes.id, antes, depois });
        return depois;
      });
      return { veiculo: veiculoPublico(v) };
    });

    // ---------- Documentos dos veículos ----------
    app.post<{ Params: { id: string } }>('/veiculos/:id/documentos', { preHandler: gestao }, async (req, reply) => {
      const d = esquemaDocumento.parse(req.body);
      const empresaId = empresaDo(req);
      const doc = await emTransacao(banco, async (c) => {
        const v = await veiculoDaEmpresa(c, req.params.id, empresaId);
        const novo = (
          await c.query(
            `INSERT INTO documentos_veiculo (empresa_id, veiculo_id, tipo, descricao, numero, vencimento, valor_centavos)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [empresaId, v.id, d.tipo, d.descricao, d.numero, d.vencimento, d.valor === null ? null : Math.round(d.valor * 100)],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'documentos_veiculo', entidadeId: novo.id, depois: novo });
        return novo;
      });
      reply.code(201);
      return { documento: documentoPublico(doc, hojeBrasil()) };
    });

    app.patch<{ Params: { id: string } }>('/documentos/:id', { preHandler: gestao }, async (req) => {
      const d = esquemaAlterarDocumento.parse(req.body);
      const empresaId = empresaDo(req);
      const doc = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM documentos_veiculo WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Documento');
        const { sql, valores } = montarSet(d, COLUNAS_DOCUMENTO, 3);
        if (!sql) return antes;
        const depois = (
          await c.query(`UPDATE documentos_veiculo SET ${sql}, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 RETURNING *`, [antes.id, empresaId, ...valores])
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'documentos_veiculo', entidadeId: antes.id, antes, depois });
        return depois;
      });
      return { documento: documentoPublico(doc, hojeBrasil()) };
    });

    app.delete<{ Params: { id: string } }>('/documentos/:id', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM documentos_veiculo WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Documento');
        await c.query('UPDATE documentos_veiculo SET excluido_em = now() WHERE id = $1', [antes.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'documentos_veiculo', entidadeId: antes.id, antes });
      });
      return { ok: true };
    });

    // ---------- Motoristas ----------
    app.get('/motoristas', { preHandler: gestao }, async (req) => {
      const hoje = hojeBrasil();
      const r = await banco.query(`${SQL_MOTORISTAS} ORDER BY m.ativo DESC, m.nome`, [empresaDo(req)]);
      return { motoristas: r.rows.map((m) => motoristaPublico(m, hoje)) };
    });

    app.post('/motoristas', { preHandler: gestao }, async (req, reply) => {
      const d = esquemaMotorista.parse(req.body);
      const empresaId = empresaDo(req);
      const m = await emTransacao(banco, async (c) => {
        const novo = (
          await c.query(
            `INSERT INTO motoristas (empresa_id, nome, telefone, cpf, funcao, cnh_numero, cnh_categoria, cnh_vencimento, cursos, ativo)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [empresaId, d.nome, d.telefone, d.cpf, d.funcao, d.cnhNumero, d.cnhCategoria, d.cnhVencimento, JSON.stringify(d.cursos), d.ativo],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'motoristas', entidadeId: novo.id, depois: novo });
        return novo;
      });
      reply.code(201);
      return { motorista: motoristaPublico(m, hojeBrasil()) };
    });

    app.patch<{ Params: { id: string } }>('/motoristas/:id', { preHandler: gestao }, async (req) => {
      const d = esquemaAlterarMotorista.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM motoristas WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Motorista');
        const { sql, valores } = montarSet(d, COLUNAS_MOTORISTA, 3);
        let depois = antes;
        if (sql) {
          depois = (await c.query(`UPDATE motoristas SET ${sql}, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 RETURNING *`, [antes.id, empresaId, ...valores])).rows[0];
        }
        // Liga (ou desliga) o login de motorista a este cadastro.
        if (d.usuarioId !== undefined) {
          await c.query('UPDATE usuarios SET motorista_id = NULL WHERE motorista_id = $1 AND empresa_id = $2', [antes.id, empresaId]);
          if (d.usuarioId) {
            const u = (
              await c.query(`UPDATE usuarios SET motorista_id = $1 WHERE id = $2 AND empresa_id = $3 AND perfil = 'motorista' AND excluido_em IS NULL RETURNING id`, [
                antes.id,
                d.usuarioId,
                empresaId,
              ])
            ).rows[0];
            if (!u) throw new ErroHttp(400, 'Escolha um usuário com perfil Motorista desta empresa.');
          }
        }
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'motoristas', entidadeId: antes.id, antes, depois: { ...depois, usuario_id: d.usuarioId } });
      });
      const hoje = hojeBrasil();
      const r = await banco.query(`${SQL_MOTORISTAS} AND m.id = $2`, [empresaId, req.params.id]);
      return { motorista: motoristaPublico(r.rows[0], hoje) };
    });

    // ---------- Alertas de vencimento ----------
    app.get('/alertas', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const docs = await banco.query(
        `SELECT d.*, v.codigo FROM documentos_veiculo d JOIN veiculos v ON v.id = d.veiculo_id
          WHERE d.empresa_id = $1 AND d.excluido_em IS NULL AND v.excluido_em IS NULL AND v.status <> 'inativo'
            AND d.vencimento IS NOT NULL AND d.vencimento <= ($2::date + 30)
          ORDER BY d.vencimento`,
        [empresaId, hoje],
      );
      const cnhs = await banco.query(
        `SELECT * FROM motoristas WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo
            AND cnh_vencimento IS NOT NULL AND cnh_vencimento <= ($2::date + 30)
          ORDER BY cnh_vencimento`,
        [empresaId, hoje],
      );
      const alertas = [
        ...docs.rows.map((d) => {
          const p = documentoPublico(d, hoje);
          return { tipo: 'documento' as const, referencia: d.codigo, veiculoId: d.veiculo_id, item: d.tipo, descricao: d.descricao, vencimento: p.vencimento, situacao: p.situacao, dias: p.dias };
        }),
        ...cnhs.rows.map((m) => {
          const p = motoristaPublico(m, hoje);
          return { tipo: 'cnh' as const, referencia: m.nome, motoristaId: m.id, item: 'cnh', descricao: null, vencimento: p.cnhVencimento, situacao: p.cnhSituacao, dias: p.cnhDias };
        }),
      ].sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0));
      const frota = await banco.query(
        `SELECT status, count(*)::int AS n FROM veiculos WHERE empresa_id = $1 AND excluido_em IS NULL GROUP BY status`,
        [empresaId],
      );
      const resumo = Object.fromEntries(frota.rows.map((r) => [r.status, r.n]));
      const consumoAlto = (await consumoDaFrota(banco, empresaId, 30))
        .filter((v) => v.piora !== null)
        .map((v) => ({ veiculoId: v.veiculoId, codigo: v.codigo, piora: v.piora, ultimo: v.ultimo, media90: v.media90, ultimaData: v.ultimaData }));
      return { alertas, consumoAlto, frota: { disponivel: resumo.disponivel ?? 0, manutencao: resumo.manutencao ?? 0, parado: resumo.parado ?? 0, inativo: resumo.inativo ?? 0 } };
    });
  };
}
