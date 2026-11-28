// Lê o arquivo .agrega3d gerado no computador pelo conversor (formato descrito em apps/api/src/lib/modelo3d.ts).

const VERSAO = 1;

async function descompactar(buffer) {
  const fluxo = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(fluxo).arrayBuffer();
}

export async function lerModelo3d(compactado) {
  let dados;
  try {
    dados = await descompactar(compactado);
  } catch {
    throw new Error('Este não é um modelo convertido (.agrega3d).');
  }
  const vista = new DataView(dados);
  if (dados.byteLength < 12 || String.fromCharCode(...new Uint8Array(dados, 0, 4)) !== 'AG3D') {
    throw new Error('Este não é um modelo convertido (.agrega3d).');
  }
  if (vista.getUint32(4, true) !== VERSAO) throw new Error('Modelo gerado por outra versão do conversor. Converta o IFC de novo.');
  const tamanho = vista.getUint32(8, true);
  const cab = JSON.parse(new TextDecoder().decode(new Uint8Array(dados, 12, tamanho)));

  let posicao = 12 + tamanho;
  const proximo = (Tipo, quantidade) => {
    const bloco = new Tipo(dados, posicao, quantidade);
    posicao += quantidade * 4;
    return bloco;
  };
  const pos = proximo(Float32Array, cab.vertices * 3);
  const nor = proximo(Float32Array, cab.vertices * 3);
  const idx = proximo(Uint32Array, cab.indices);
  const pecaElemento = proximo(Uint32Array, cab.pecas);
  const pecaForma = proximo(Uint32Array, cab.pecas);
  const matrizes = proximo(Float32Array, cab.pecas * 16);

  return {
    origem: cab.origem,
    elementos: cab.elementos.map(([guid, nome, tipo]) => ({ guid, nome, tipo })),
    formas: cab.formas.map(([v, nv, i, ni]) => ({
      pos: pos.subarray(v * 3, (v + nv) * 3),
      nor: nor.subarray(v * 3, (v + nv) * 3),
      idx: idx.subarray(i, i + ni),
    })),
    pecas: pecaForma.length,
    pecaElemento,
    pecaForma,
    matrizes,
  };
}
