// Execução dos backups completos (automático diário às 03:00 de Brasília, ou manual) e retenção de 30 dias.
import type { Banco } from '../db.ts';
import { ErroHttp } from './erros.ts';
import { apagarObjeto, configBucket, enviarObjeto } from './armazenamento.ts';
import { gerarBackupCompleto, gerarExportacaoEmpresa, sha } from './backup.ts';

const TRAVA = 7001; // trava de sessão no PostgreSQL: impede dois backups ao mesmo tempo (inclusive em duas instâncias)
const TRAVA_EMPRESA = 7002; // um backup de empresa por vez
const DIAS_RETENCAO = 30;

export async function executarBackupCompleto(banco: Banco, tipo: 'automatico' | 'manual', criadoPor = 'sistema') {
  const cfg = configBucket();
  if (!cfg) throw new ErroHttp(503, 'O armazenamento de backups ainda não está configurado (variáveis BACKUP_BUCKET_*).');

  const c = await banco.connect();
  try {
    const trava = (await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [TRAVA])).rows[0]!.ok;
    if (!trava) throw new ErroHttp(409, 'Já existe um backup em andamento. Aguarde terminar.');
    const agora = new Date();
    const chave = `backups/completo-${agora.toISOString().replace(/[:.]/g, '-')}.zip`;
    try {
      // Snapshot consistente: todas as tabelas leem o mesmo momento.
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const pacote = await gerarBackupCompleto(c, agora);
      await c.query('COMMIT');
      await enviarObjeto(cfg, chave, pacote.zip);
      const r = await banco.query(
        `INSERT INTO backups (tipo, status, tamanho_bytes, registros, tabelas, chave, sha256, criado_por)
         VALUES ($1, 'ok', $2, $3, $4, $5, $6, $7) RETURNING id, criado_em`,
        [tipo, pacote.zip.length, pacote.registros, pacote.tabelas.length, chave, sha(pacote.zip), criadoPor],
      );
      await retencao(banco, cfg);
      return { id: r.rows[0].id as string, criadoEm: r.rows[0].criado_em as Date, tamanhoBytes: pacote.zip.length, registros: pacote.registros, tabelas: pacote.tabelas.length };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      const msg = (e as Error).message.slice(0, 500);
      await banco.query(`INSERT INTO backups (tipo, status, chave, erro, criado_por) VALUES ($1, 'erro', $2, $3, $4)`, [tipo, chave, msg, criadoPor]).catch(() => undefined);
      throw e;
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [TRAVA]).catch(() => undefined);
    }
  } finally {
    c.release();
  }
}

/** Backup da própria empresa (feito pelo dono): mesmo conteúdo da exportação, guardado no bucket e baixável por ele. */
export async function executarBackupEmpresa(banco: Banco, empresa: { id: string; nome: string }, criadoPor: string) {
  const cfg = configBucket();
  if (!cfg) throw new ErroHttp(503, 'O armazenamento de backups ainda não está configurado. Procure o suporte.');
  const c = await banco.connect();
  try {
    const trava = (await c.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [TRAVA_EMPRESA])).rows[0]!.ok;
    if (!trava) throw new ErroHttp(409, 'Já existe um backup desta empresa em andamento. Aguarde terminar.');
    const agora = new Date();
    const chave = `backups/empresa-${empresa.id}-${agora.toISOString().replace(/[:.]/g, '-')}.zip`;
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const pacote = await gerarExportacaoEmpresa(c, empresa, agora);
      await c.query('COMMIT');
      await enviarObjeto(cfg, chave, pacote.zip);
      const r = await banco.query(
        `INSERT INTO backups (tipo, status, tamanho_bytes, registros, tabelas, chave, sha256, criado_por, empresa_id)
         VALUES ('manual', 'ok', $1, $2, $3, $4, $5, $6, $7) RETURNING id, criado_em`,
        [pacote.zip.length, pacote.registros, pacote.tabelas.length, chave, sha(pacote.zip), criadoPor, empresa.id],
      );
      return { id: r.rows[0].id as string, criadoEm: r.rows[0].criado_em as Date, tamanhoBytes: pacote.zip.length, registros: pacote.registros, tabelas: pacote.tabelas.length };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      await banco.query(`INSERT INTO backups (tipo, status, chave, erro, criado_por, empresa_id) VALUES ('manual', 'erro', $1, $2, $3, $4)`, [chave, (e as Error).message.slice(0, 500), criadoPor, empresa.id]).catch(() => undefined);
      throw e;
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [TRAVA_EMPRESA]).catch(() => undefined);
    }
  } finally {
    c.release();
  }
}

/** Apaga backups com mais de 30 dias (arquivo no bucket e registro). */
async function retencao(banco: Banco, cfg: NonNullable<ReturnType<typeof configBucket>>) {
  const antigos = (await banco.query<{ id: string; chave: string }>(
    `SELECT id, chave FROM backups WHERE status = 'ok' AND criado_em < now() - ($1 || ' days')::interval`,
    [String(DIAS_RETENCAO)],
  )).rows;
  for (const b of antigos) {
    await apagarObjeto(cfg, b.chave).catch(() => undefined);
    await banco.query('DELETE FROM backups WHERE id = $1', [b.id]);
  }
}

/** Agendamento: verifica a cada 30 minutos; às 03:xx (Brasília), faz o backup se não houve um nas últimas 20 horas. */
export function iniciarAgendamentoBackup(banco: Banco, log: (m: string) => void) {
  if (!configBucket()) {
    log('Backup automático desligado: armazenamento não configurado.');
    return;
  }
  const formatoHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' });
  const verificar = async () => {
    if (Number(formatoHora.format(new Date())) !== 3) return;
    const feito = await banco.query(`SELECT 1 FROM backups WHERE status = 'ok' AND empresa_id IS NULL AND criado_em > now() - interval '20 hours' LIMIT 1`);
    if (feito.rowCount) return;
    const r = await executarBackupCompleto(banco, 'automatico');
    log(`Backup automático concluído: ${r.registros} registros em ${r.tabelas} tabelas.`);
  };
  setInterval(() => {
    verificar().catch((e) => log(`Falha no backup automático: ${(e as Error).message}`));
  }, 30 * 60 * 1000).unref();
}
