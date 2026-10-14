// Gerador de arquivo .zip sem dependências (usa só zlib do Node). Compacta cada arquivo com deflate.
import { deflateRawSync, crc32 } from 'node:zlib';

export type ArquivoZip = { nome: string; dados: Buffer };

function horaDos(d: Date) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
}
function dataDos(d: Date) {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
}

export function criarZip(arquivos: ArquivoZip[], agora = new Date()): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const hora = horaDos(agora);
  const data = dataDos(agora);

  for (const arq of arquivos) {
    const nome = Buffer.from(arq.nome, 'utf8');
    const comp = deflateRawSync(arq.dados);
    const crc = crc32(arq.dados) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(arq.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nome, comp);

    const cab = Buffer.alloc(46);
    cab.writeUInt32LE(0x02014b50, 0);
    cab.writeUInt16LE(20, 4); // versão que criou
    cab.writeUInt16LE(20, 6); // versão necessária
    cab.writeUInt16LE(0x0800, 8);
    cab.writeUInt16LE(8, 10);
    cab.writeUInt16LE(hora, 12);
    cab.writeUInt16LE(data, 14);
    cab.writeUInt32LE(crc, 16);
    cab.writeUInt32LE(comp.length, 20);
    cab.writeUInt32LE(arq.dados.length, 24);
    cab.writeUInt16LE(nome.length, 28);
    cab.writeUInt32LE(offset, 42);
    central.push(cab, nome);

    offset += local.length + nome.length + comp.length;
  }

  const tamanhoCentral = central.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, ...central, fim]);
}
