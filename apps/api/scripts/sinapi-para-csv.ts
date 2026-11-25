// Converte a planilha oficial do SINAPI para o CSV padrão das tabelas de referência do Agrega.
// Uso: node scripts/sinapi-para-csv.ts <SINAPI_Referência_AAAA_MM.xlsx ou o .zip do mês> <saida.csv> [UF=TO] [com|sem=com]
// Depois: Engenharia > Tabelas > Nova tabela (fonte SINAPI, mesma UF, mês e desoneração) e envie o CSV.
import fs from 'node:fs';
import { lerAbasXlsx, lerZip } from '../src/lib/xlsx-leitura.ts';
import { converterSinapiOficial } from '../src/lib/sinapi-oficial.ts';

const [entrada, saida, ufArg = 'TO', modoArg = 'com'] = process.argv.slice(2);
if (!entrada || !saida) {
  console.error('Uso: node scripts/sinapi-para-csv.ts <planilha.xlsx|arquivo.zip> <saida.csv> [UF=TO] [com|sem=com]');
  process.exit(1);
}
let buf = fs.readFileSync(entrada);
if (/\.zip$/i.test(entrada)) {
  const arquivos = lerZip(buf);
  const nome = [...arquivos.keys()].find((n) => /refer[êe]ncia.*\.xlsx$/i.test(n));
  if (!nome) throw new Error('O zip não tem a planilha SINAPI_Referência.');
  buf = arquivos.get(nome)!;
}
const desonerado = modoArg.toLowerCase().startsWith('com');
const { csv, resumo, avisos } = converterSinapiOficial(lerAbasXlsx(buf), { uf: ufArg, desonerado });
fs.writeFileSync(saida, csv, 'utf8');
console.log(`CSV gravado em ${saida} (${(csv.length / 1e6).toFixed(1)} MB) · ${ufArg.toUpperCase()} ${desonerado ? 'com' : 'sem'} desoneração`);
const { divergentes, ...contagens } = resumo;
console.log(contagens);
console.log(`Divergências com o custo oficial: ${contagens.divergentesTotal} (maior: ${contagens.maiorDivergenciaPct}%)`);
for (const d of divergentes.slice(0, 15)) console.log(`  ${d.codigo} ${d.descricao}: calculado ${d.calculado} · oficial ${d.oficial}`);
for (const a of avisos) console.log('Aviso:', a);
