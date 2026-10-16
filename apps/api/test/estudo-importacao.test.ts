import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarEstudoAprovado, entrarViabiliza, esquemaEstudo, planejarImportacao, type UnidadeExistente, type UnidadeExportada } from '../src/lib/estudo-importacao.ts';

const un = (codigo: string, preco: number, extra: Partial<UnidadeExportada> = {}): UnidadeExportada => ({
  codigoExterno: codigo, nome: `Apto ${codigo}`, numero: 101, andar: 1, tipologia: 'Tipo A', areaPrivativa: 80, preco, permuta: false, ...extra,
});
const ex = (codigo: string, preco: number, situacao: UnidadeExistente['situacao'] = 'disponivel', nome = `Apto ${codigo}`): UnidadeExistente => ({ codigoExterno: codigo, nome, preco, situacao });

test('unidade nova no estudo entra como criação', () => {
  const p = planejarImportacao([], [un('a#0', 500_000)]);
  assert.equal(p.criar.length, 1);
  assert.equal(p.totais.criar, 1);
});

test('disponível com preço novo é atualizado', () => {
  const p = planejarImportacao([ex('a#0', 500_000)], [un('a#0', 520_000)]);
  assert.deepEqual(p.atualizar.map((u) => [u.codigoExterno, u.preco]), [['a#0', 520_000]]);
  assert.equal(p.divergencias.length, 0);
});

test('vendida com preço alterado no estudo gera divergência e mantém o preço do contrato', () => {
  const p = planejarImportacao([ex('a#0', 500_000, 'vendida')], [un('a#0', 520_000)]);
  assert.equal(p.atualizar.some((u) => u.preco === 520_000), false);
  assert.deepEqual(p.divergencias, [{ codigoExterno: 'a#0', motivo: 'preco', precoContrato: 500_000, precoEstudo: 520_000 }]);
});

test('reservada mantém preço e nome pode acompanhar o estudo', () => {
  const p = planejarImportacao([ex('a#0', 500_000, 'reservada', 'Apto antigo')], [un('a#0', 500_000)]);
  assert.equal(p.divergencias.length, 0);
  assert.equal(p.atualizar[0].nome, 'Apto a#0');
  assert.equal(p.atualizar[0].preco, 500_000);
});

test('unidade disponível que saiu do estudo vai para removidas, sem apagar', () => {
  const p = planejarImportacao([ex('a#0', 500_000), ex('a#1', 480_000)], [un('a#0', 500_000)]);
  assert.deepEqual(p.removidas, ['a#1']);
});

test('unidade vendida que saiu do estudo gera divergência, não remoção', () => {
  const p = planejarImportacao([ex('a#1', 480_000, 'vendida')], []);
  assert.equal(p.removidas.length, 0);
  assert.equal(p.divergencias[0].motivo, 'removida');
});

test('unidade em permuta no estudo vai para a situação permuta', () => {
  const p = planejarImportacao([ex('a#0', 500_000)], [un('a#0', 500_000, { permuta: true })]);
  assert.equal(p.atualizar[0].situacao, 'permuta');
});

test('unidade vendida que virou permuta no estudo gera divergência', () => {
  const p = planejarImportacao([ex('a#0', 500_000, 'vendida')], [un('a#0', 500_000, { permuta: true })]);
  assert.equal(p.divergencias[0].motivo, 'permuta');
});

test('código repetido no estudo é recusado', () => {
  assert.throws(() => planejarImportacao([], [un('a#0', 1), un('a#0', 2)]), /repetida/);
});

test('estudo que não segue o formato combinado é recusado', () => {
  const r = esquemaEstudo.safeParse({ schemaVersion: 2, empreendimento: {}, versaoEstudo: 'x', aprovadoEm: '2026-10-01', unidades: [] });
  assert.equal(r.success, false);
});

const respostaJson = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const estudoValido = {
  schemaVersion: 1,
  empreendimento: { id: 'e1', nome: 'Residencial Sul', cidade: 'Palmas', uf: 'TO' },
  versaoEstudo: 'v3',
  aprovadoEm: '2026-10-10',
  unidades: [un('a#0', 500_000)],
};

test('entrar no Viabiliza devolve o token e envia e-mail e senha no login', async () => {
  let corpoEnviado = '';
  const token = await entrarViabiliza('https://viabiliza.test', 'eng@x.com', 'segredo', async (_u, init) => {
    corpoEnviado = String(init?.body);
    return respostaJson({ token: 't-123' });
  });
  assert.equal(token, 't-123');
  assert.deepEqual(JSON.parse(corpoEnviado), { email: 'eng@x.com', senha: 'segredo' });
});

test('senha errada no Viabiliza vira erro 401 do Agrega', async () => {
  await assert.rejects(entrarViabiliza('https://viabiliza.test', 'a@b.c', 'x', async () => respostaJson({ erro: 'no' }, 401)), (e: any) => e.status === 401);
});

test('estudo não aprovado (409) é recusado com mensagem clara', async () => {
  await assert.rejects(buscarEstudoAprovado('https://viabiliza.test', 't', 'e1', async () => respostaJson({}, 409)), (e: any) => e.status === 409 && /aprovado/.test(e.message));
});

test('perfil sem permissão de exportação (403) é recusado', async () => {
  await assert.rejects(buscarEstudoAprovado('https://viabiliza.test', 't', 'e1', async () => respostaJson({}, 403)), (e: any) => e.status === 403);
});

test('estudo aprovado válido é lido e validado', async () => {
  const e = await buscarEstudoAprovado('https://viabiliza.test', 't', 'e1', async (u, init) => {
    assert.equal(String(u), 'https://viabiliza.test/api/exportacao/empreendimentos/e1');
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer t');
    return respostaJson(estudoValido);
  });
  assert.equal(e.versaoEstudo, 'v3');
  assert.equal(e.unidades.length, 1);
});

test('resposta com formato inesperado vira erro 502', async () => {
  await assert.rejects(buscarEstudoAprovado('https://viabiliza.test', 't', 'e1', async () => respostaJson({ x: 1 })), (e: any) => e.status === 502);
});
