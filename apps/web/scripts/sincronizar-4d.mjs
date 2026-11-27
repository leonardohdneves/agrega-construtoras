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
/** Texto compara sem diferença de fim de linha; binário (IFC) compara byte a byte. */
const iguais = (atual, esperado) =>
  typeof esperado === 'string' ? normalizar(atual.toString('utf8')) === normalizar(esperado) : Buffer.compare(atual, esperado) === 0;
// Páginas HTML: caminhos de src/ e de data/ viram relativos, porque a página fica em /4d/.
const PAGINAS = ['viewer4d.html', 'custo5d.html'];
// Dados que as páginas leem (JSON exportado e IFC de exemplo), copiados para /4d/data/.
const DADOS = ['agrega_obra_leo.json', 'curvaS_leo.json', 'previsto_realizado_leo.json', 'exemplo_casa.ifc'];

const ajustarPagina = (t) => t.replace(/'\.\.\/src\/([^']+)'/g, "'./$1'").replace(/'\/data\//g, "'data/");

/** Conteúdo que deve estar em cada arquivo do destino. */
function esperado() {
  const saida = new Map();
  for (const [de, para] of ARQUIVOS) {
    const caminho = join(origem, de);
    if (!existsSync(caminho)) throw new Error(`Falta o arquivo de origem: ${caminho}`);
    saida.set(para, readFileSync(caminho, 'utf8'));
  }
  for (const pagina of PAGINAS) {
    const caminho = join(origem, 'src', pagina);
    if (!existsSync(caminho)) throw new Error(`Falta a página: ${caminho}`);
    saida.set(pagina, ajustarPagina(readFileSync(caminho, 'utf8')));
  }
  for (const dado of DADOS) {
    const caminho = join(origem, 'data', dado);
    if (!existsSync(caminho)) throw new Error(`Falta o dado: ${caminho}`);
    saida.set(join('data', dado), readFileSync(caminho));
  }
  return saida;
}

const alvo = esperado();
const diferentes = [];
for (const [arquivo, conteudo] of alvo) {
  const atual = join(destino, arquivo);
  const igual = existsSync(atual) && iguais(readFileSync(atual), conteudo);
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
