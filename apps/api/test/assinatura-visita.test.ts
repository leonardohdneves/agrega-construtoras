import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codigoDaVisita, PREFIXO_PNG, validarImagemAssinatura } from '../src/lib/assinatura.ts';

const visita = { numero: 2, data: '2026-11-05', responsavel: 'Eng. Maria', observacoes: 'Ok' };
const png = PREFIXO_PNG + Buffer.from('imagem de teste').toString('base64');

test('aceita PNG em base64 e recusa outros formatos', () => {
  assert.equal(validarImagemAssinatura(png), png);
  assert.throws(() => validarImagemAssinatura('data:image/jpeg;base64,AAAA'), /PNG/);
  assert.throws(() => validarImagemAssinatura(PREFIXO_PNG + 'não é base64!'), /inválida/);
  assert.throws(() => validarImagemAssinatura(PREFIXO_PNG + 'A'.repeat(260_000)), /grande demais/);
});

test('o código muda quando o conteúdo da visita muda, e não depende da ordem das fotos', () => {
  const base = codigoDaVisita(visita, ['f1', 'f2']);
  assert.equal(codigoDaVisita(visita, ['f2', 'f1']), base);
  assert.notEqual(codigoDaVisita({ ...visita, observacoes: 'Ok, mas com ressalva' }, ['f1', 'f2']), base);
  assert.notEqual(codigoDaVisita(visita, ['f1']), base);
  assert.notEqual(codigoDaVisita({ ...visita, responsavel: 'Outro' }, ['f1', 'f2']), base);
  assert.match(base, /^[0-9A-F]{16}$/);
});
