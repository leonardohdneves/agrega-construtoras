import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { criarZip } from '../src/lib/zip.ts';
import { criarXlsx, nomesDeAbas } from '../src/lib/xlsx.ts';

// Os leitores externos (unzip e Python com openpyxl) podem faltar na máquina (ex.: Windows): aí o teste pula.
const roda = (cmd: string, args: string[]) => { try { return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0; } catch { return false; } };
const semUnzip = roda('unzip', ['-v']) ? false : 'sem unzip nesta máquina';
const semOpenpyxl = roda('python3', ['-c', 'import openpyxl']) ? false : 'sem python3 com openpyxl nesta máquina';

test('zip: arquivos são extraídos com o mesmo conteúdo (validado por unzip)', { skip: semUnzip }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'zip-'));
  const z = path.join(dir, 'a.zip');
  const conteudo = Buffer.from('ação ✓ '.repeat(500));
  writeFileSync(z, criarZip([{ nome: 'pasta/a.json', dados: conteudo }, { nome: 'b.txt', dados: Buffer.from('oi') }]));
  execFileSync('unzip', ['-tq', z]); // lança erro se o zip estiver inválido
  const saida = path.join(dir, 'out');
  execFileSync('unzip', ['-qo', z, '-d', saida]);
  assert.deepEqual(readFileSync(path.join(saida, 'pasta/a.json')), conteudo);
  assert.equal(readFileSync(path.join(saida, 'b.txt'), 'utf8'), 'oi');
});

test('xlsx: abre no leitor de planilhas com cabeçalho, texto, número e células vazias', { skip: semOpenpyxl }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xlsx-'));
  const f = path.join(dir, 'p.xlsx');
  writeFileSync(f, criarXlsx([{ nome: 'obra_itens', colunas: ['id', 'codigo', 'preco', 'ativo', 'nota'], linhas: [['x', '1.10', '12.5', true, null], ['y', 'a<b & "c"', 3, false, { k: 1 }]], numericas: [false, false, true, false, false] }]));
  const script = `
import openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb['obra_itens']
rows = [[c.value for c in r] for r in ws.iter_rows()]
print(repr(rows))
`;
  const py = path.join(dir, 'ler.py');
  writeFileSync(py, script);
  const out = execFileSync('python3', ['-I', py, f], { encoding: 'utf8' });
  assert.ok(out.includes("['id', 'codigo', 'preco', 'ativo', 'nota']"));
  assert.ok(out.includes("'1.10'"), 'código com zero à direita continua texto');
  assert.ok(out.includes("12.5"));
  assert.ok(out.includes('a<b & "c"'));
  assert.ok(out.includes('{"k":1}'));
});

test('xlsx: nomes de aba são válidos e únicos', () => {
  const nomes = nomesDeAbas(['a/b:c', 'a/b:c', 'x'.repeat(40)]);
  assert.equal(nomes[0], 'a-b-c');
  assert.equal(nomes[1], 'a-b-c_2');
  assert.ok(nomes[2]!.length <= 31);
});
