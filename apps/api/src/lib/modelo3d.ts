// Converte um IFC num arquivo leve de 3D (.agrega3d) para o 5D abrir direto do computador, sem enviar o modelo.
// Cada forma é guardada uma só vez e cada peça aponta para ela (parafusos repetidos quase não pesam).
//
// Formato (tudo little-endian, compactado com gzip):
//   "AG3D" | uint32 versão | uint32 tamanho do cabeçalho | cabeçalho JSON (completado com espaços até múltiplo de 4)
//   float32 posições | float32 normais | uint32 índices | uint32 elemento da peça | uint32 forma da peça | float32 matrizes
// O leitor fica em public/4d/agrega/modelo3d.js.
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import * as WebIFC from 'web-ifc';
import { tiposDosElementos } from './ifc-geometria.ts';

export const VERSAO_MODELO3D = 1;

export type ResumoModelo3d = { elementos: number; pecas: number; formas: number; vertices: number; ignoradas: number };

type Forma = { pos: Float32Array; nor: Float32Array; idx: Uint32Array };

const bytesDe = (v: Float32Array | Uint32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);

export async function converterIfc(bytes: Uint8Array, origem: string): Promise<{ arquivo: Buffer; resumo: ResumoModelo3d }> {
  const ifc = new WebIFC.IfcAPI();
  await ifc.Init();
  const modelo = ifc.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
  if (modelo < 0) throw new Error('arquivo inválido');
  try {
    const tipoDo = tiposDosElementos(ifc, modelo);
    const elementos: [string | null, string | null, string | null][] = [];
    const formas: Forma[] = [];
    const formaPorConteudo = new Map<string, number>();
    const pecaElemento: number[] = [];
    const pecaForma: number[] = [];
    const matrizes: number[] = [];
    let ignoradas = 0;

    ifc.StreamAllMeshes(modelo, (mesh) => {
      let guid: string | null = null;
      let nome: string | null = null;
      try {
        const linha = ifc.GetLine(modelo, mesh.expressID);
        guid = linha.GlobalId?.value ?? null;
        nome = linha.Name?.value ?? null;
      } catch {
        // linha sem atributos legíveis: a peça é desenhada sem identificação
      }
      const elemento = elementos.push([guid, nome, tipoDo.get(mesh.expressID) ?? null]) - 1;
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const pg = mesh.geometries.get(i);
        const g = ifc.GetGeometry(modelo, pg.geometryExpressID);
        const v = ifc.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
        const idx = new Uint32Array(ifc.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize()));
        const matriz = Array.from(pg.flatTransformation as ArrayLike<number>);
        const chave = createHash('sha1').update(bytesDe(v)).update(bytesDe(idx)).digest('base64');
        let forma = formaPorConteudo.get(chave);
        if (forma === undefined) {
          const n = v.length / 6;
          const pos = new Float32Array(n * 3);
          const nor = new Float32Array(n * 3);
          for (let q = 0, j = 0; q < v.length; q += 6, j += 3) {
            pos.set(v.subarray(q, q + 3), j);
            nor.set(v.subarray(q + 3, q + 6), j);
          }
          // coordenadas inválidas (NaN) quebram o enquadramento do desenho
          forma = n && pos.every((x) => Number.isFinite(x)) ? formas.push({ pos, nor, idx }) - 1 : -1;
          formaPorConteudo.set(chave, forma);
        }
        if (forma < 0 || !matriz.every((x) => Number.isFinite(x))) {
          ignoradas++;
          continue;
        }
        pecaElemento.push(elemento);
        pecaForma.push(forma);
        for (const x of matriz) matrizes.push(x);
      }
    });

    let vertices = 0;
    let indices = 0;
    const faixas = formas.map((f) => {
      const faixa = [vertices, f.pos.length / 3, indices, f.idx.length];
      vertices += f.pos.length / 3;
      indices += f.idx.length;
      return faixa;
    });
    const texto = Buffer.from(JSON.stringify({ origem, elementos, formas: faixas, pecas: pecaForma.length, vertices, indices }), 'utf8');
    const cabecalho = Buffer.concat([texto, Buffer.alloc((4 - (texto.length % 4)) % 4, ' ')]);
    const inicio = Buffer.alloc(12);
    inicio.write('AG3D', 0, 'latin1');
    inicio.writeUInt32LE(VERSAO_MODELO3D, 4);
    inicio.writeUInt32LE(cabecalho.length, 8);
    const corpo = Buffer.concat([
      inicio,
      cabecalho,
      ...formas.map((f) => bytesDe(f.pos)),
      ...formas.map((f) => bytesDe(f.nor)),
      ...formas.map((f) => bytesDe(f.idx)),
      bytesDe(new Uint32Array(pecaElemento)),
      bytesDe(new Uint32Array(pecaForma)),
      bytesDe(new Float32Array(matrizes)),
    ]);
    return {
      arquivo: gzipSync(corpo),
      resumo: { elementos: elementos.length, pecas: pecaForma.length, formas: formas.length, vertices, ignoradas },
    };
  } finally {
    ifc.CloseModel(modelo);
  }
}
