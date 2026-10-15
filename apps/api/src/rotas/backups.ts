// Backups do sistema (área do administrador) e exportação dos dados de cada empresa (dono e gestor).
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { apagarObjeto, configBucket, lerObjeto } from '../lib/armazenamento.ts';
import { executarBackupCompleto, executarBackupEmpresa } from '../lib/backup-job.ts';
import { gerarExportacaoEmpresa, listarBackups } from '../lib/backup.ts';
import { empresaDo, exigir } from '../sessao.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Administrador do sistema: lista, faz e baixa o backup completo. */
export function rotasBackups(banco: Banco) {
  return async function (app: FastifyInstance) {
    const so = exigir(banco, 'admin_sistema');

    app.get('/backups', { preHandler: so }, async () => {
      const lista = await listarBackups(banco);
      return {
        armazenamentoConfigurado: !!configBucket(),
        backups: lista.map((b) => ({
          id: b.id,
          criadoEm: b.criado_em,
          tipo: b.tipo,
          status: b.status,
          tamanhoBytes: b.tamanho_bytes === null ? null : Number(b.tamanho_bytes),
          registros: b.registros,
          tabelas: b.tabelas,
          erro: b.erro,
        })),
      };
    });

    app.post('/backups', { preHandler: so, config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (req, reply) => {
      const r = await executarBackupCompleto(banco, 'manual', req.usuario!.nome);
      reply.code(201);
      return { backup: r };
    });

    app.get<{ Params: { id: string } }>('/backups/:id/download', { preHandler: so }, async (req, reply) => {
      if (!UUID.test(req.params.id)) throw naoEncontrado('Backup');
      const cfg = configBucket();
      if (!cfg) throw new ErroHttp(503, 'O armazenamento de backups não está configurado.');
      const b = (await banco.query<{ chave: string; criado_em: Date }>(`SELECT chave, criado_em FROM backups WHERE id = $1 AND status = 'ok'`, [req.params.id])).rows[0];
      if (!b?.chave) throw naoEncontrado('Backup');
      const dados = await lerObjeto(cfg, b.chave);
      const nome = b.chave.split('/').pop() ?? 'backup.zip';
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${nome}"`);
      return reply.send(dados);
    });

    app.delete<{ Params: { id: string } }>('/backups/:id', { preHandler: so }, async (req) => {
      if (!UUID.test(req.params.id)) throw naoEncontrado('Backup');
      const b = (await banco.query<{ chave: string | null }>('SELECT chave FROM backups WHERE id = $1', [req.params.id])).rows[0];
      if (!b) throw naoEncontrado('Backup');
      const cfg = configBucket();
      if (cfg && b.chave) await apagarObjeto(cfg, b.chave).catch(() => undefined);
      await banco.query('DELETE FROM backups WHERE id = $1', [req.params.id]);
      return { ok: true };
    });
  };
}

/** Dono e gestor: exporta os dados da própria empresa (XLSX e JSON, sem senhas). */
export function rotasExportacao(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.get('/exportacao', { preHandler: exigir(banco, 'dono', 'gestor'), config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
      const empresaId = empresaDo(req);
      const empresa = (await banco.query<{ nome: string }>('SELECT COALESCE(nome_fantasia, razao_social) AS nome FROM empresas WHERE id = $1', [empresaId])).rows[0];
      if (!empresa) throw naoEncontrado('Empresa');
      const agora = new Date();
      const pacote = await gerarExportacaoEmpresa(banco, { id: empresaId, nome: empresa.nome }, agora);
      await auditar(banco, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'exportacao', entidadeId: empresaId, depois: { registros: pacote.registros, tabelas: pacote.tabelas.length } });
      const slug = empresa.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '') || 'empresa';
      const data = agora.toISOString().slice(0, 10);
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="exportacao-${slug}-${data}.zip"`);
      return reply.send(pacote.zip);
    });

    // ----- Backup da própria empresa (só o dono): fica guardado e pode ser baixado a qualquer momento -----
    const dono = exigir(banco, 'dono');

    app.get('/backups', { preHandler: dono }, async (req) => {
      const r = await banco.query(
        `SELECT id, criado_em, status, tamanho_bytes, registros, tabelas, erro, criado_por FROM backups
          WHERE empresa_id = $1 ORDER BY criado_em DESC LIMIT 50`,
        [empresaDo(req)],
      );
      return {
        armazenamentoConfigurado: !!configBucket(),
        backups: r.rows.map((b) => ({
          id: b.id as string,
          criadoEm: b.criado_em as string,
          status: b.status as string,
          tamanhoBytes: b.tamanho_bytes === null ? null : Number(b.tamanho_bytes),
          registros: b.registros as number | null,
          tabelas: b.tabelas as number | null,
          erro: b.erro as string | null,
          criadoPor: b.criado_por as string | null,
        })),
      };
    });

    app.post('/backups', { preHandler: dono, config: { rateLimit: { max: 3, timeWindow: '10 minutes' } } }, async (req, reply) => {
      const empresaId = empresaDo(req);
      const empresa = (await banco.query<{ nome: string }>('SELECT COALESCE(nome_fantasia, razao_social) AS nome FROM empresas WHERE id = $1', [empresaId])).rows[0];
      if (!empresa) throw naoEncontrado('Empresa');
      const r = await executarBackupEmpresa(banco, { id: empresaId, nome: empresa.nome }, req.usuario!.nome);
      await auditar(banco, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'backups', entidadeId: r.id, depois: { registros: r.registros, tabelas: r.tabelas } });
      reply.code(201);
      return { backup: { id: r.id, criadoEm: r.criadoEm, tamanhoBytes: r.tamanhoBytes, registros: r.registros, tabelas: r.tabelas } };
    });

    app.get<{ Params: { id: string } }>('/backups/:id/download', { preHandler: dono }, async (req, reply) => {
      if (!UUID.test(req.params.id)) throw naoEncontrado('Backup');
      const empresaId = empresaDo(req);
      const b = (await banco.query<{ chave: string; criado_em: Date }>(`SELECT chave, criado_em FROM backups WHERE id = $1 AND empresa_id = $2 AND status = 'ok'`, [req.params.id, empresaId])).rows[0];
      if (!b?.chave) throw naoEncontrado('Backup');
      const cfg = configBucket();
      if (!cfg) throw new ErroHttp(503, 'O armazenamento de backups não está configurado.');
      const dados = await lerObjeto(cfg, b.chave);
      const nome = b.chave.split('/').pop() ?? 'backup.zip';
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${nome}"`);
      return reply.send(dados);
    });
  };
}
