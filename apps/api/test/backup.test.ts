import { test } from 'node:test';
import assert from 'node:assert/strict';
import { condicaoEmpresa, ordemRestauracao, type Esquema } from '../src/lib/backup.ts';
import { configBucket } from '../src/lib/armazenamento.ts';

const esquema: Esquema = new Map([
  ['empresas', { colunas: [{ nome: 'id', tipo: 'uuid' }], fks: [] }],
  ['obras', { colunas: [{ nome: 'id', tipo: 'uuid' }, { nome: 'empresa_id', tipo: 'uuid' }], fks: [{ coluna: 'empresa_id', tabelaPai: 'empresas', colunaPai: 'id' }] }],
  ['eap_nos', { colunas: [{ nome: 'id', tipo: 'uuid' }, { nome: 'obra_id', tipo: 'uuid' }], fks: [{ coluna: 'obra_id', tabelaPai: 'obras', colunaPai: 'id' }, { coluna: 'pai_id', tabelaPai: 'eap_nos', colunaPai: 'id' }] }],
  ['orcamento_itens', { colunas: [{ nome: 'eap_no_id', tipo: 'uuid' }], fks: [{ coluna: 'eap_no_id', tabelaPai: 'eap_nos', colunaPai: 'id' }] }],
  ['marcas_sistema', { colunas: [{ nome: 'chave', tipo: 'text' }], fks: [] }],
]);

test('exportação da empresa: tabela com empresa_id filtra direto', () => {
  assert.equal(condicaoEmpresa('obras', esquema), '"empresa_id" = $1');
});

test('exportação da empresa: segue a chave estrangeira até a empresa', () => {
  assert.equal(condicaoEmpresa('eap_nos', esquema), '"obra_id" IN (SELECT "id" FROM "obras" WHERE "empresa_id" = $1)');
  assert.match(condicaoEmpresa('orcamento_itens', esquema)!, /IN \(SELECT "id" FROM "eap_nos" WHERE "obra_id" IN/);
});

test('exportação da empresa: tabela global (sem ligação com empresa) fica de fora', () => {
  assert.equal(condicaoEmpresa('marcas_sistema', esquema), null);
});

test('restauração: pais antes de filhos, mesmo com a tabela de filhos listada antes', () => {
  const ordem = ordemRestauracao(esquema);
  assert.ok(ordem.indexOf('empresas') < ordem.indexOf('obras'));
  assert.ok(ordem.indexOf('obras') < ordem.indexOf('eap_nos'));
  assert.ok(ordem.indexOf('eap_nos') < ordem.indexOf('orcamento_itens'));
  assert.equal(ordem.length, esquema.size);
});

test('armazenamento: sem as variáveis o backup automático fica desligado', () => {
  assert.equal(configBucket({} as NodeJS.ProcessEnv), null);
  const cfg = configBucket({ BACKUP_BUCKET_ENDPOINT: 'https://x', BACKUP_BUCKET_NAME: 'b', BACKUP_BUCKET_ACCESS_KEY: 'a', BACKUP_BUCKET_SECRET_KEY: 's' } as unknown as NodeJS.ProcessEnv);
  assert.equal(cfg?.region, 'auto');
});
