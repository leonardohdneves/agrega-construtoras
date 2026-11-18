import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ferramentas } from '../src/ferramentas/index.ts';
import { listaDeFerramentas } from '../src/nucleo.ts';
import { anotacoesDaFerramenta } from '../src/lib/anotacoes.ts';

type Publicada = { name: string; description: string; inputSchema: { type?: string; properties?: Record<string, { description?: string }> }; annotations: { readOnlyHint: boolean } };
const publicadas = listaDeFerramentas() as Publicada[];

test('catálogo: nome em snake_case, igual à chave, e descrição que explica a ferramenta', () => {
  for (const [chave, f] of Object.entries(ferramentas)) {
    assert.equal(f.name, chave);
    assert.match(f.name, /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/, `nome fora do padrão: ${f.name}`);
    assert.ok(f.name.length <= 64, `nome longo demais: ${f.name}`);
    assert.ok(f.description.trim().length >= 60, `descrição curta demais: ${f.name}`);
  }
});

test('catálogo: toda entrada vira um JSON Schema de objeto e todo campo tem descrição', () => {
  for (const f of publicadas) {
    assert.equal(f.inputSchema.type, 'object', `${f.name}: a entrada precisa ser z.object`);
    for (const [campo, esquema] of Object.entries(f.inputSchema.properties ?? {})) {
      assert.ok(esquema.description?.trim(), `${f.name}.${campo} sem .describe()`);
    }
    // O que vai para o modelo não pode levar marcas que a API do Claude recusa.
    const texto = JSON.stringify(f.inputSchema);
    assert.ok(!texto.includes('"$schema"') && !texto.includes('"nullable"'), `${f.name}: esquema não normalizado`);
  }
});

test('catálogo: o MCP não exclui registros', () => {
  const proibidas = Object.keys(ferramentas).filter((n) => /^(deletar|excluir|apagar)_/.test(n));
  assert.deepEqual(proibidas, []);
});

test('anotações: leitura e destrutiva saem do nome', () => {
  assert.deepEqual(anotacoesDaFerramenta('listar_obras'), { readOnlyHint: true });
  assert.deepEqual(anotacoesDaFerramenta('usuario_atual'), { readOnlyHint: true });
  assert.deepEqual(anotacoesDaFerramenta('criar_obra'), { readOnlyHint: false });
  assert.deepEqual(anotacoesDaFerramenta('cancelar_pedido_compra'), { readOnlyHint: false, destructiveHint: true });
});
