// P37: grupos de exposição do catálogo. Cliente e servidor MCP ligados em memória, sem API por trás.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { areasDoParametro, createApiClient, createMcpServer, listaDeFerramentas } from '../src/nucleo.ts';
import { AREAS, areaDaFerramenta } from '../src/ferramentas/index.ts';

async function conectar(grupos: unknown) {
  const server = createMcpServer(createApiClient('token-de-teste'), areasDoParametro(grupos));
  const [doCliente, doServidor] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'teste', version: '0' });
  await server.connect(doServidor);
  await client.connect(doCliente);
  return client;
}

test('grupos: sem ?grupos= a conexão expõe o catálogo inteiro, como antes', async () => {
  const client = await conectar(undefined);
  const { tools } = await client.listTools();
  assert.equal(tools.length, listaDeFerramentas().length);
  assert.ok(!tools.some((t) => t.name === 'habilitar_area'));
});

test('grupos: ?grupos=financeiro expõe conta e financeiro, e habilitar_area liga outra área', async () => {
  const client = await conectar('financeiro');
  const { tools } = await client.listTools();
  const areas = new Set(tools.filter((t) => t.name !== 'habilitar_area').map((t) => areaDaFerramenta[t.name]));
  assert.deepEqual([...areas].sort(), ['conta', 'financeiro']);
  assert.ok(tools.some((t) => t.name === 'habilitar_area'));
  const tamanho = JSON.stringify(tools).length;
  assert.ok(tamanho < JSON.stringify(listaDeFerramentas()).length / 2, `catálogo reduzido: ${tamanho} bytes`);

  let avisado = false;
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    avisado = true;
  });
  const r = await client.callTool({ name: 'habilitar_area', arguments: { area: 'engenharia' } });
  assert.ok(!r.isError, JSON.stringify(r));
  const depois = await client.listTools();
  assert.ok(depois.tools.some((t) => areaDaFerramenta[t.name] === 'engenharia'));
  await new Promise((ok) => setTimeout(ok, 20));
  assert.ok(avisado, 'o cliente recebe o aviso de lista alterada');
});

test('grupos: valor inválido ou "todas" volta ao catálogo inteiro', () => {
  assert.equal(areasDoParametro('nada').size, AREAS.length);
  assert.equal(areasDoParametro('todas').size, AREAS.length);
  assert.deepEqual([...areasDoParametro('engenharia, suprimentos')].sort(), ['conta', 'engenharia', 'suprimentos']);
});
