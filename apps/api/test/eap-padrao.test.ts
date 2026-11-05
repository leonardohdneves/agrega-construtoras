import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarEapPadrao, EAP_PADRAO } from '../src/lib/eap-padrao.ts';

const profundidade = (codigo: string) => codigo.split('.').length;
const nivelDe = { 1: 'etapa', 2: 'subetapa', 3: 'tarefa' } as const;

test('EAP padrão: 20 etapas, 39 sub etapas e 74 tarefas, sem códigos repetidos', () => {
  const codigos = EAP_PADRAO.map(([c]) => c);
  assert.equal(new Set(codigos).size, codigos.length);
  const contar = (n: number) => EAP_PADRAO.filter(([c]) => profundidade(c) === n).length;
  assert.equal(contar(1), 20);
  assert.equal(contar(2), 39);
  assert.equal(contar(3), 74);
  assert.equal(EAP_PADRAO.length, 133);
});

test('EAP padrão: nível confere com a profundidade do código e o pai vem antes do filho', () => {
  const vistos = new Set<string>();
  for (const [codigo, nivel] of EAP_PADRAO) {
    assert.equal(nivel, nivelDe[profundidade(codigo) as 1 | 2 | 3], `nível de ${codigo}`);
    if (codigo.includes('.')) assert.ok(vistos.has(codigo.slice(0, codigo.lastIndexOf('.'))), `pai de ${codigo}`);
    vistos.add(codigo);
  }
});

test('aplicarEapPadrao grava as linhas ligadas ao pai correto, sem serviços', async () => {
  const gravados: { obra: string; pai: string | null; nivel: string; codigo: string; descricao: string }[] = [];
  let proximo = 0;
  const cliente = {
    async query(sql: string, valores: unknown[]) {
      assert.match(sql, /INSERT INTO eap_nos/);
      const [obra, pai, nivel, codigo, descricao] = valores as string[];
      gravados.push({ obra, pai, nivel, codigo, descricao });
      return { rows: [{ id: `no-${++proximo}` }], rowCount: 1 };
    },
  };
  const total = await aplicarEapPadrao(cliente as never, 'obra-1');
  assert.equal(total, 133);
  assert.equal(gravados.length, 133);
  const porCodigo = new Map(gravados.map((g, i) => [g.codigo, { ...g, id: `no-${i + 1}` }]));
  assert.equal(porCodigo.get('1')!.pai, null);
  assert.equal(porCodigo.get('1.1')!.pai, 'no-1');
  assert.equal(porCodigo.get('1.1.1')!.pai, porCodigo.get('1.1')!.id);
  assert.equal(porCodigo.get('1.1.1')!.nivel, 'tarefa');
  assert.equal(porCodigo.get('20.1.1')!.descricao, 'LIMPEZA FINAL DE OBRA');
  assert.ok(gravados.every((g) => g.obra === 'obra-1'));
});
