// Anexos dos laudos (ART em PDF ou foto, fotos da obra e outros documentos): envio, lista, download, remoção, limite
// por laudo, conferência do tipo e isolamento entre empresas. Rode com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_laudos_anexos');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

// Começo de cada tipo de arquivo: o servidor confere a assinatura antes de guardar.
const b64 = (bytes: Buffer) => bytes.toString('base64');
const PDF = Buffer.from('%PDF-1.4\n% anexo de teste\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('dados de teste')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('dados de teste')]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

const laudoNovo = async (empresa?: 'b') =>
  (await ctx.pedir('dono', 'POST', '/api/laudos', { corpo: { tipo: 'glp' }, ...(empresa ? { empresa } : {}) })).corpo.id as string;
const enviar = (laudo: string, corpo: Record<string, unknown>, empresa?: 'b') =>
  ctx.pedir('dono', 'POST', `/api/laudos/${laudo}/anexos`, { corpo, ...(empresa ? { empresa } : {}) });
const listar = async (laudo: string) =>
  (await ctx.pedir('dono', 'GET', `/api/laudos/${laudo}/anexos`)).corpo.anexos as { id: string; nome: string; categoria: string; tamanho: number }[];

test('laudos: ART em PDF é guardada, listada e abre inline', { skip: semBanco }, async () => {
  const laudo = await laudoNovo();
  const envio = await enviar(laudo, { nome: 'ART 123.pdf', tipo: 'application/pdf', categoria: 'art', legenda: 'ART da obra', arquivo: b64(PDF) });
  assert.equal(envio.status, 201);
  const [anexo] = await listar(laudo);
  assert.equal(anexo.nome, 'ART 123.pdf');
  assert.equal(anexo.categoria, 'art');
  assert.equal(anexo.tamanho, PDF.length);

  const r = await ctx.app.inject({
    method: 'GET',
    url: `/api/laudos/${laudo}/anexos/${envio.corpo.id}`,
    headers: { authorization: `Bearer ${ctx.usuarios.a.dono.token}` },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['content-type'], 'application/pdf');
  assert.equal(r.headers['content-disposition'], 'inline; filename="ART 123.pdf"');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.deepEqual(r.rawPayload, PDF);

  const audit = await ctx.banco.query(`SELECT acao FROM auditoria WHERE entidade = 'laudos_anexos' AND entidade_id = $1`, [envio.corpo.id]);
  assert.equal(audit.rows[0].acao, 'criar');
});

test('laudos: foto não aceita PDF, e o conteúdo tem que bater com o tipo declarado', { skip: semBanco }, async () => {
  const laudo = await laudoNovo();
  const pdfComoFoto = await enviar(laudo, { nome: 'a.pdf', tipo: 'application/pdf', categoria: 'foto', arquivo: b64(PDF) });
  assert.equal(pdfComoFoto.status, 400);

  const textoComoPng = await enviar(laudo, { nome: 'x.png', tipo: 'image/png', categoria: 'foto', arquivo: b64(Buffer.from('isto é texto')) });
  assert.equal(textoComoPng.status, 400);
  assert.match(textoComoPng.corpo.erro, /não é do tipo/);

  const pngComoPdf = await enviar(laudo, { nome: 'x.pdf', tipo: 'application/pdf', categoria: 'art', arquivo: b64(PNG) });
  assert.equal(pngComoPdf.status, 400);

  const tipoNaoAceito = await enviar(laudo, { nome: 'x.html', tipo: 'text/html', categoria: 'outro', arquivo: b64(Buffer.from('<h1>x</h1>')) });
  assert.equal(tipoNaoAceito.status, 400);

  const vazio = await enviar(laudo, { nome: 'x.jpg', tipo: 'image/jpeg', categoria: 'foto', arquivo: '' });
  assert.equal(vazio.status, 400);

  assert.deepEqual(await listar(laudo), []);
});

test('laudos: fotos entram na lista e remover apaga só o anexo escolhido', { skip: semBanco }, async () => {
  const laudo = await laudoNovo();
  const f1 = await enviar(laudo, { nome: 'fachada.png', tipo: 'image/png', categoria: 'foto', legenda: 'Fachada', arquivo: b64(PNG) });
  const f2 = await enviar(laudo, { nome: 'central.jpg', tipo: 'image/jpeg', categoria: 'foto', arquivo: b64(JPEG) });
  const f3 = await enviar(laudo, { nome: 'webp.webp', tipo: 'image/webp', categoria: 'foto', arquivo: b64(WEBP) });
  assert.deepEqual([f1.status, f2.status, f3.status], [201, 201, 201]);
  assert.equal((await listar(laudo)).length, 3);

  const removido = await ctx.pedir('dono', 'DELETE', `/api/laudos/${laudo}/anexos/${f2.corpo.id}`);
  assert.equal(removido.status, 200);
  assert.deepEqual(
    (await listar(laudo)).map((a) => a.nome).sort(),
    ['fachada.png', 'webp.webp'],
  );

  const outraVez = await ctx.pedir('dono', 'DELETE', `/api/laudos/${laudo}/anexos/${f2.corpo.id}`);
  assert.equal(outraVez.status, 404);
});

test('laudos: limite de anexos por laudo, e excluir o laudo leva os anexos junto', { skip: semBanco }, async () => {
  const laudo = await laudoNovo();
  for (let i = 0; i < 40; i++) {
    const r = await enviar(laudo, { nome: `doc-${i}.pdf`, tipo: 'application/pdf', categoria: 'outro', arquivo: b64(PDF) });
    assert.equal(r.status, 201, `anexo ${i}`);
  }
  const alem = await enviar(laudo, { nome: 'extra.pdf', tipo: 'application/pdf', categoria: 'outro', arquivo: b64(PDF) });
  assert.equal(alem.status, 409);

  const apagar = await ctx.pedir('dono', 'DELETE', `/api/laudos/${laudo}`);
  assert.equal(apagar.status, 200);
  const sobras = await ctx.banco.query('SELECT count(*)::int AS n FROM laudos_anexos WHERE laudo_id = $1', [laudo]);
  assert.equal(sobras.rows[0].n, 0);
});

test('laudos: outra empresa não vê, baixa, remove nem envia anexos de um laudo', { skip: semBanco }, async () => {
  const laudo = await laudoNovo();
  const envio = await enviar(laudo, { nome: 'ART.pdf', tipo: 'application/pdf', categoria: 'art', arquivo: b64(PDF) });
  const anexoId = envio.corpo.id as string;

  assert.equal((await ctx.pedir('dono', 'GET', `/api/laudos/${laudo}/anexos`, { empresa: 'b' })).status, 404);
  const baixar = await ctx.app.inject({
    method: 'GET',
    url: `/api/laudos/${laudo}/anexos/${anexoId}`,
    headers: { authorization: `Bearer ${ctx.usuarios.b.dono.token}` },
  });
  assert.equal(baixar.statusCode, 404);
  assert.equal((await ctx.pedir('dono', 'DELETE', `/api/laudos/${laudo}/anexos/${anexoId}`, { empresa: 'b' })).status, 404);
  assert.equal((await enviar(laudo, { nome: 'x.pdf', tipo: 'application/pdf', categoria: 'outro', arquivo: b64(PDF) }, 'b')).status, 404);

  assert.equal((await listar(laudo)).length, 1, 'o anexo continua na empresa dona');
});

test('laudos: id que não é de laudo ou de anexo dá 404, e perfil sem acesso a laudos é recusado', { skip: semBanco }, async () => {
  const laudo = await laudoNovo();
  assert.equal((await ctx.pedir('dono', 'GET', '/api/laudos/nao-e-uuid/anexos')).status, 404);
  assert.equal((await ctx.pedir('dono', 'GET', `/api/laudos/${laudo}/anexos/nao-e-uuid`)).status, 404);
  assert.equal((await ctx.pedir('dono', 'DELETE', `/api/laudos/${laudo}/anexos/nao-e-uuid`)).status, 404);
  assert.equal((await ctx.pedir('mestre_obra', 'GET', `/api/laudos/${laudo}/anexos`)).status, 403);
});
