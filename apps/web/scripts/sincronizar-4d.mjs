// Copia o visualizador 4D (pasta de origem) para apps/web/public/4d, ajustando os caminhos de importação.
// Uso:
//   node apps/web/scripts/sincronizar-4d.mjs [pasta_origem]     copia (padrão: E:/TRABALHO/4D ou FOUR_D_ORIGEM)
//   node apps/web/scripts/sincronizar-4d.mjs --verificar        só confere se as duas pastas estão iguais (código 1 se não)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const destino = resolve(aqui, '..', 'public', '4d');
const args = process.argv.slice(2);
const verificar = args.includes('--verificar');
const origem = resolve(args.find((a) => !a.startsWith('--')) ?? process.env.FOUR_D_ORIGEM ?? 'E:/TRABALHO/4D');

// Arquivos de src/ da origem e onde ficam no destino (o viewer usa './...' a partir de /4d/).
const ARQUIVOS = [
  ['src/cronograma.js', 'cronograma.js'],
  ['src/classificacao_geometrica.js', 'classificacao_geometrica.js'],
  ['src/reconhecimento.js', 'reconhecimento.js'],
  ['src/agrega/planejamento.js', 'agrega/planejamento.js'],
];

const normalizar = (t) => t.replace(/\r\n/g, '\n');
const ajustarViewer = (t) => t.replace(/'\.\.\/src\/([^']+)'/g, "'./$1'");

/** Conteúdo que deve estar em cada arquivo do destino. */
function esperado() {
  const saida = new Map();
  for (const [de, para] of ARQUIVOS) {
    const caminho = join(origem, de);
    if (!existsSync(caminho)) throw new Error(`Falta o arquivo de origem: ${caminho}`);
    saida.set(para, readFileSync(caminho, 'utf8'));
  }
  const viewer = join(origem, 'src', 'viewer4d.html');
  if (!existsSync(viewer)) throw new Error(`Falta o visualizador: ${viewer}`);
  saida.set('viewer4d.html', ajustarViewer(readFileSync(viewer, 'utf8')));
  return saida;
}

const alvo = esperado();
const diferentes = [];
for (const [arquivo, conteudo] of alvo) {
  const atual = join(destino, arquivo);
  const igual = existsSync(atual) && normalizar(readFileSync(atual, 'utf8')) === normalizar(conteudo);
  if (!igual) diferentes.push(arquivo);
}

if (verificar) {
  if (diferentes.length) {
    console.error(`Diferente da origem (${origem}): ${diferentes.join(', ')}. Rode sem --verificar para copiar.`);
    process.exit(1);
  }
  console.log(`Visualizador 4D em dia com ${origem}.`);
} else {
  for (const [arquivo, conteudo] of alvo) {
    const caminho = join(destino, arquivo);
    mkdirSync(dirname(caminho), { recursive: true });
    writeFileSync(caminho, conteudo, 'utf8');
  }
  console.log(diferentes.length ? `Copiados de ${origem}: ${diferentes.join(', ')}.` : `Nada a copiar: já estava em dia com ${origem}.`);
}
