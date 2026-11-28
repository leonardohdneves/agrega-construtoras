// Converte um IFC no computador para o arquivo leve que o 5D abre. Nada é enviado pela internet.
// Uso: node apps/api/scripts/converter-ifc.ts <modelo.ifc> [saida.agrega3d]
// No Windows, também dá para arrastar o IFC sobre converter-ifc.cmd.
import fs from 'node:fs';
import path from 'node:path';
import { converterIfc } from '../src/lib/modelo3d.ts';

const [entrada, destino] = process.argv.slice(2);
if (!entrada) {
  console.error('Informe o arquivo IFC (ou arraste o IFC sobre converter-ifc.cmd).');
  process.exit(1);
}
if (!/\.ifc$/i.test(entrada) || !fs.existsSync(entrada)) {
  console.error(`Arquivo IFC não encontrado: ${entrada}`);
  process.exit(1);
}
const saida = destino ?? entrada.replace(/\.ifc$/i, '.agrega3d');
const mb = (n: number) => `${(n / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

const inicio = Date.now();
const bytes = new Uint8Array(fs.readFileSync(entrada));
console.log(`Lendo ${path.basename(entrada)} (${mb(bytes.length)})…`);
const { arquivo, resumo } = await converterIfc(bytes, path.basename(entrada));
fs.writeFileSync(saida, arquivo);
console.log(`Pronto em ${((Date.now() - inicio) / 1000).toFixed(1)} s: ${saida} (${mb(arquivo.length)})`);
console.log(`${resumo.elementos} elementos · ${resumo.pecas} peças · ${resumo.formas} formas diferentes`);
if (resumo.ignoradas) console.log(`${resumo.ignoradas} peça(s) com coordenadas inválidas ficaram de fora.`);
console.log('No 5D, use "Modelo convertido" para abrir este arquivo.');
