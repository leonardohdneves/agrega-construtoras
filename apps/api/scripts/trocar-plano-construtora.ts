// Troca o plano de contas de concreteira pelo plano padrão de construtora, numa empresa que já tem o plano antigo.
// Uso:  DATABASE_URL=postgres://... EMPRESA_ID=<uuid> node scripts/trocar-plano-construtora.ts            (só confere, não altera)
//       DATABASE_URL=postgres://... EMPRESA_ID=<uuid> node scripts/trocar-plano-construtora.ts --aplicar  (aplica)
//
// Regras de segurança:
// - Sem --aplicar, tudo roda numa transação que termina em ROLLBACK: é só um relatório.
// - Se alguma conta ou centro de custo antigo estiver em uso (lançamento, nota, contrato, pedido, solicitação, fornecedor...),
//   o script para e não altera nada. Nesse caso a troca precisa ser decidida caso a caso.
// - As contas antigas não são apagadas: são renomeadas com o prefixo 'antigo-' e desativadas, para manter o histórico.
// - Faça o backup completo antes de usar --aplicar.
import { criarBanco, emTransacao, type Cliente } from '../src/db.ts';
import { aplicarPlanoPadrao, PLANO_CONTAS_PADRAO, CENTROS_CUSTO_PADRAO } from '../src/rotas/financeiro.ts';
import { PLANO_CONTAS_CONCRETEIRA, CENTROS_CUSTO_CONCRETEIRA } from '../src/lib/financeiro.ts';

const aplicar = process.argv.includes('--aplicar');
const empresaId = process.env.EMPRESA_ID;
const url = process.env.DATABASE_URL;
if (!url || !empresaId) {
  console.error('Defina DATABASE_URL e EMPRESA_ID.');
  process.exit(1);
}

class Parou extends Error {}

/** Tabelas e colunas que apontam para plano_contas ou centros_custo (exceto as próprias tabelas de cadastro). */
async function referencias(c: Cliente, tabelaAlvo: 'plano_contas' | 'centros_custo') {
  const fks = (
    await c.query(
      `SELECT kcu.table_name AS tabela, kcu.column_name AS coluna
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = $1 AND kcu.table_name <> $1`,
      [tabelaAlvo],
    )
  ).rows as { tabela: string; coluna: string }[];
  return fks;
}

async function contarUsos(c: Cliente, tabelaAlvo: 'plano_contas' | 'centros_custo', ids: string[]) {
  if (ids.length === 0) return [];
  const usos: { onde: string; quantidade: number }[] = [];
  for (const fk of await referencias(c, tabelaAlvo)) {
    const existe = (await c.query('SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', [fk.tabela, 'empresa_id'])).rowCount;
    const filtro = existe ? 'AND empresa_id = $2' : '';
    const n = Number((await c.query(`SELECT count(*)::int AS n FROM "${fk.tabela}" WHERE "${fk.coluna}" = ANY($1::uuid[]) ${filtro}`, existe ? [ids, empresaId] : [ids])).rows[0].n);
    if (n > 0) usos.push({ onde: `${fk.tabela}.${fk.coluna}`, quantidade: n });
  }
  return usos;
}

async function main() {
  const banco = criarBanco(url!);
  try {
    const resultado = await emTransacao(banco, async (c) => {
      const empresa = (await c.query('SELECT coalesce(nome_fantasia, razao_social) AS nome FROM empresas WHERE id = $1', [empresaId])).rows[0];
      if (!empresa) throw new Parou('Empresa não encontrada.');
      console.log(`Empresa: ${empresa.nome}`);

      // Contas antigas: as que têm código do plano de concreteira e ainda não foram renomeadas.
      const codigosAntigos = PLANO_CONTAS_CONCRETEIRA.map((p) => p.codigo);
      const antigas = (await c.query('SELECT id, codigo, nome FROM plano_contas WHERE empresa_id = $1 AND codigo = ANY($2::text[])', [empresaId, codigosAntigos])).rows as { id: string; codigo: string; nome: string }[];
      console.log(`Contas do plano antigo: ${antigas.length}.`);

      // Conflito: uma conta que não é do plano antigo ocupando um código do plano novo.
      const codigosNovos = PLANO_CONTAS_PADRAO.map((p) => p.codigo);
      const conflitos = (await c.query(
        'SELECT codigo, nome FROM plano_contas WHERE empresa_id = $1 AND codigo = ANY($2::text[]) AND codigo <> ALL($3::text[])',
        [empresaId, codigosNovos, codigosAntigos],
      )).rows;
      if (conflitos.length) throw new Parou(`Há contas personalizadas com código do plano novo: ${conflitos.map((x) => `${x.codigo} ${x.nome}`).join('; ')}. Resolva antes.`);

      const usosContas = await contarUsos(c, 'plano_contas', antigas.map((x) => x.id));
      if (usosContas.length) {
        console.log('Contas antigas em uso:');
        for (const u of usosContas) console.log(`  ${u.onde}: ${u.quantidade}`);
        throw new Parou('Há lançamentos ou cadastros usando contas do plano antigo. Nada foi alterado.');
      }

      // Centros de custo antigos que não existem no padrão novo.
      const centrosAntigos = (await c.query(
        'SELECT id, nome FROM centros_custo WHERE empresa_id = $1 AND nome = ANY($2::text[]) AND nome <> ALL($3::text[])',
        [empresaId, CENTROS_CUSTO_CONCRETEIRA, CENTROS_CUSTO_PADRAO],
      )).rows as { id: string; nome: string }[];
      const usosCentros = await contarUsos(c, 'centros_custo', centrosAntigos.map((x) => x.id));
      if (usosCentros.length) {
        console.log('Centros de custo antigos em uso:');
        for (const u of usosCentros) console.log(`  ${u.onde}: ${u.quantidade}`);
        throw new Parou('Há centros de custo antigos em uso. Nada foi alterado.');
      }

      console.log(`Centros de custo antigos a desativar: ${centrosAntigos.map((x) => x.nome).join(', ') || 'nenhum'}.`);
      if (!aplicar) {
        console.log('Modo conferência: nenhuma alteração gravada. Para aplicar, rode com --aplicar.');
        throw new Parou('__conferencia__');
      }

      // Aplicação: desativa e renomeia o antigo, depois cria o novo.
      for (const x of antigas) {
        await c.query("UPDATE plano_contas SET codigo = $2, ativo = false, pai_id = NULL, atualizado_em = now() WHERE id = $1", [x.id, `antigo-${x.codigo}`]);
      }
      for (const x of centrosAntigos) {
        await c.query('UPDATE centros_custo SET ativo = false, atualizado_em = now() WHERE id = $1', [x.id]);
      }
      const criados = await aplicarPlanoPadrao(c, empresaId, PLANO_CONTAS_PADRAO, CENTROS_CUSTO_PADRAO);
      return { renomeadas: antigas.length, ...criados };
    });
    console.log('Concluído:', resultado);
  } catch (e) {
    if (e instanceof Parou && e.message === '__conferencia__') {
      // Conferência concluída; a transação foi desfeita.
    } else if (e instanceof Parou) {
      console.error(e.message);
      process.exitCode = 1;
    } else {
      throw e;
    }
  } finally {
    await banco.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
