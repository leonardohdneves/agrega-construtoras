// Geometria de um modelo IFC para o desenho 3D das telas 4D/5D. A leitura fica no servidor: o navegador só desenha,
// então a política de segurança das páginas não precisa liberar eval nem WebAssembly.
import * as WebIFC from 'web-ifc';

/** Classes de elemento que as telas conhecem (sem o prefixo IFC). Outras peças vêm com tipo nulo. */
const CLASSES = [
  'IFCBUILDINGELEMENTPROXY', 'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCCOLUMN', 'IFCBEAM', 'IFCMEMBER',
  'IFCPLATE', 'IFCFOOTING', 'IFCPILE', 'IFCDOOR', 'IFCWINDOW', 'IFCROOF', 'IFCSTAIR', 'IFCSTAIRFLIGHT', 'IFCRAILING',
  'IFCCOVERING', 'IFCFURNISHINGELEMENT', 'IFCFLOWSEGMENT', 'IFCFLOWTERMINAL', 'IFCFLOWFITTING',
  'IFCBUILDINGELEMENTPART', 'IFCCURTAINWALL', 'IFCRAMP', 'IFCRAMPFLIGHT',
];

/** Limite de vértices por modelo: acima disso a resposta fica grande demais para o servidor e para o navegador. */
export const LIMITE_VERTICES = 3_000_000;

export type PecaIfc = {
  guid: string | null;
  nome: string | null;
  tipo: string | null;
  /** Matriz 4x4 em coluna, como o three.js espera. */
  matriz: number[];
  /** Float32 (x,y,z), Float32 (normais) e Uint32 (índices), em base64. */
  pos: string;
  nor: string;
  idx: string;
};

const base64 = (v: Float32Array | Uint32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');

/** Classe conhecida de cada elemento do modelo (id da linha → classe sem o prefixo IFC). */
export function tiposDosElementos(ifc: WebIFC.IfcAPI, modelo: number): Map<number, string> {
  const classes = WebIFC as unknown as Record<string, unknown>;
  const tipoDo = new Map<number, string>();
  for (const nome of CLASSES) {
    const codigo = classes[nome];
    if (typeof codigo !== 'number') continue;
    const ids = ifc.GetLineIDsWithType(modelo, codigo);
    for (let i = 0; i < ids.size(); i++) tipoDo.set(ids.get(i), nome.replace(/^IFC/, ''));
  }
  return tipoDo;
}

export async function geometriaDoIfc(bytes: Uint8Array, limite = LIMITE_VERTICES): Promise<{ pecas: PecaIfc[]; ignoradas: number }> {
  const ifc = new WebIFC.IfcAPI();
  await ifc.Init();
  const modelo = ifc.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
  if (modelo < 0) throw new Error('arquivo inválido');
  try {
    const tipoDo = tiposDosElementos(ifc, modelo);
    const pecas: PecaIfc[] = [];
    let ignoradas = 0;
    let vertices = 0;
    let excedeu = false;
    ifc.StreamAllMeshes(modelo, (mesh) => {
      if (excedeu) return;
      let guid: string | null = null;
      let nome: string | null = null;
      try {
        const linha = ifc.GetLine(modelo, mesh.expressID);
        guid = linha.GlobalId?.value ?? null;
        nome = linha.Name?.value ?? null;
      } catch {
        // linha sem atributos legíveis: a peça é desenhada sem identificação
      }
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const pg = mesh.geometries.get(i);
        const g = ifc.GetGeometry(modelo, pg.geometryExpressID);
        const v = ifc.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
        const idx = ifc.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
        const n = v.length / 6;
        vertices += n;
        if (vertices > limite) {
          excedeu = true;
          return;
        }
        const pos = new Float32Array(n * 3);
        const nor = new Float32Array(n * 3);
        for (let q = 0, j = 0; q < v.length; q += 6, j += 3) {
          pos.set(v.subarray(q, q + 3), j);
          nor.set(v.subarray(q + 3, q + 6), j);
        }
        // coordenadas inválidas (NaN) quebram o enquadramento do desenho
        if (pos.some((x) => !Number.isFinite(x))) {
          ignoradas++;
          continue;
        }
        pecas.push({
          guid,
          nome,
          tipo: tipoDo.get(mesh.expressID) ?? null,
          matriz: Array.from(pg.flatTransformation as ArrayLike<number>),
          pos: base64(pos),
          nor: base64(nor),
          idx: base64(new Uint32Array(idx)),
        });
      }
    });
    if (excedeu) throw new Error(`modelo grande demais para o 3D (mais de ${limite.toLocaleString('pt-BR')} vértices)`);
    return { pecas, ignoradas };
  } finally {
    ifc.CloseModel(modelo);
  }
}
