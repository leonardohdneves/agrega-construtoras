import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compararVersoes, criarSnapshot, relatorioDaVersao, type SnapshotVersao } from '../src/lib/versoes.ts';

const OBRA = { codigo: 'L1', nome: 'Casa Teste', endereco: null, cidade: null, uf: 'TO', responsavel: null };
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Obra pequena: 1.1 Etapa (grupo) > 1.1.1 tarefa com serviço S1; 1.2 tarefa com serviço S2. */
function versao(over: { qtd1?: number; preco1?: number; bdi?: number; semTarefa2?: boolean; servico1?: string } = {}): SnapshotVersao {
  const linhas = [
    { id: ID(1), paiId: null, nivel: 'etapa' as const, codigo: '1', descricao: 'Fundação', servico: null },
    { id: ID(2), paiId: ID(1), nivel: 'tarefa' as const, codigo: '1.1', descricao: 'Vigas', servico: { codigo: over.servico1 ?? 'S1', unidade: 'm3', quantidade: over.qtd1 ?? 10, custoUnitario: over.preco1 ?? 100, itemId: ID(10) } },
    ...(over.semTarefa2
      ? []
      : [{ id: ID(3), paiId: ID(1), nivel: 'tarefa' as const, codigo: '1.2', descricao: 'Blocos', servico: { codigo: 'S2', unidade: 'm3', quantidade: 5, custoUnitario: 200, itemId: ID(11) } }]),
  ];
  return criarSnapshot(OBRA, over.bdi ?? 0, linhas, new Map());
}

test('versão guarda os preços do momento: alterar o snapshot original não muda o total salvo', () => {
  const salva = versao({ preco1: 100 });
  const total = relatorioDaVersao(salva).precoTotal;
  // Simula preço alterado depois: outra versão com preço diferente não afeta a salva.
  versao({ preco1: 999 });
  assert.equal(relatorioDaVersao(salva).precoTotal, total);
  assert.equal(total, 10 * 100 + 5 * 200);
});

test('BDI entra no total da versão e fica guardado nela', () => {
  const v = versao({ bdi: 25 });
  assert.equal(v.bdiPercentual, 25);
  assert.equal(relatorioDaVersao(v).precoTotal, r2((10 * 100 + 5 * 200) * 1.25));
});

test('comparação: sem mudanças, tudo igual e delta zero', () => {
  const c = compararVersoes(versao(), versao());
  assert.equal(c.resumo.delta, 0);
  assert.equal(c.resumo.alteradas, 0);
  assert.equal(c.resumo.iguais, 2);
  assert.ok(c.tarefas.every((t) => t.situacao === 'igual'));
});

test('comparação: quantidade e preço alterados aparecem na tarefa com o delta certo', () => {
  const c = compararVersoes(versao(), versao({ qtd1: 12, preco1: 110 }));
  const t = c.tarefas.find((x) => x.codigo === '1.1')!;
  assert.equal(t.situacao, 'alterada');
  assert.deepEqual(t.mudancas, ['quantidade', 'preço unitário']);
  assert.equal(t.delta, r2(12 * 110 - 10 * 100));
  assert.equal(c.resumo.delta, r2(12 * 110 + 5 * 200 - (10 * 100 + 5 * 200)));
});

test('comparação: tarefa incluída e removida são identificadas', () => {
  const sem2 = compararVersoes(versao(), versao({ semTarefa2: true }));
  assert.equal(sem2.tarefas.find((t) => t.codigo === '1.2')!.situacao, 'removida');
  assert.equal(sem2.resumo.removidas, 1);
  const com2 = compararVersoes(versao({ semTarefa2: true }), versao());
  assert.equal(com2.tarefas.find((t) => t.codigo === '1.2')!.situacao, 'incluida');
  assert.equal(com2.resumo.incluidas, 1);
});

test('comparação: troca de serviço na mesma tarefa é apontada', () => {
  const c = compararVersoes(versao(), versao({ servico1: 'S9' }));
  const t = c.tarefas.find((x) => x.codigo === '1.1')!;
  assert.ok(t.mudancas.includes('serviço trocado'));
});

test('comparação: etapa mostra o total das duas versões', () => {
  const c = compararVersoes(versao(), versao({ qtd1: 12, preco1: 110 }));
  const e = c.etapas.find((g) => g.codigo === '1')!;
  assert.equal(e.totalA, r2(10 * 100 + 5 * 200));
  assert.equal(e.totalB, r2(12 * 110 + 5 * 200));
  assert.equal(e.situacao, 'alterada');
});

function r2(n: number) {
  return Math.round(n * 100) / 100;
}
