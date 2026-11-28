// Conversor do computador (.agrega3d): o que ele grava é o que o 5D lê, com as mesmas peças da leitura no servidor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { converterIfc } from '../src/lib/modelo3d.ts';
import { geometriaDoIfc } from '../src/lib/ifc-geometria.ts';

const exemplo = fs.readFileSync(new URL('./fixtures/exemplo_casa.ifc', import.meta.url));
// o leitor é o mesmo arquivo que vai para o navegador
const leitor = new URL('../../web/public/4d/agrega/modelo3d.js', import.meta.url).href;

test('converte o exemplo e o leitor do navegador devolve as mesmas peças', async () => {
  const { lerModelo3d } = await import(leitor);
  const { arquivo, resumo } = await converterIfc(new Uint8Array(exemplo), 'exemplo_casa.ifc');
  const lido = await lerModelo3d(new Uint8Array(arquivo).buffer);
  const { pecas } = await geometriaDoIfc(new Uint8Array(exemplo));

  assert.equal(lido.origem, 'exemplo_casa.ifc');
  assert.equal(lido.pecas, pecas.length);
  assert.equal(lido.formas.length, resumo.formas);
  assert.ok(resumo.formas <= pecas.length, 'formas repetidas são guardadas uma vez');
  for (let k = 0; k < lido.pecas; k++) {
    const el = lido.elementos[lido.pecaElemento[k]];
    const forma = lido.formas[lido.pecaForma[k]];
    assert.equal(el.guid, pecas[k].guid);
    assert.equal(el.tipo, pecas[k].tipo);
    assert.equal(Buffer.from(forma.pos.slice().buffer).toString('base64'), pecas[k].pos);
    assert.equal(Buffer.from(forma.idx.slice().buffer).toString('base64'), pecas[k].idx);
    assert.deepEqual([...lido.matrizes.subarray(k * 16, k * 16 + 16)], pecas[k].matriz.map(Math.fround));
  }
});

test('leitor recusa o que não é modelo convertido', async () => {
  const { lerModelo3d } = await import(leitor);
  await assert.rejects(() => lerModelo3d(new Uint8Array([1, 2, 3, 4]).buffer), /não é um modelo convertido/);
});
