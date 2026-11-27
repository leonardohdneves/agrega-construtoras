// Leitura de quantitativos de um modelo IFC para a EAP e o orçamento: cada elemento vai para o seu pavimento
// (IfcBuildingStorey) e para o seu tipo (parede, laje, pilar, viga, porta, janela). Volume (m³) pela geometria do
// próprio modelo; portas e janelas são contadas (un). Nada é gravado aqui: a rota devolve a prévia e o usuário confere.
import * as WebIFC from 'web-ifc';

export type TipoIfc = 'parede' | 'laje' | 'pilar' | 'viga' | 'porta' | 'janela';
export type ItemIfc = { pavimento: string; tipo: TipoIfc; descricao: string; unidade: 'm³' | 'un'; quantidade: number; elementos: number };

const TIPOS: { classe: number; tipo: TipoIfc; descricao: string; contar: boolean }[] = [
  { classe: WebIFC.IFCWALL, tipo: 'parede', descricao: 'Parede', contar: false },
  { classe: WebIFC.IFCWALLSTANDARDCASE, tipo: 'parede', descricao: 'Parede', contar: false },
  { classe: WebIFC.IFCSLAB, tipo: 'laje', descricao: 'Laje', contar: false },
  { classe: WebIFC.IFCCOLUMN, tipo: 'pilar', descricao: 'Pilar', contar: false },
  { classe: WebIFC.IFCBEAM, tipo: 'viga', descricao: 'Viga', contar: false },
  { classe: WebIFC.IFCDOOR, tipo: 'porta', descricao: 'Porta', contar: true },
  { classe: WebIFC.IFCWINDOW, tipo: 'janela', descricao: 'Janela', contar: true },
];

/** Volume (m³) de uma malha fechada: soma dos volumes com sinal dos triângulos, depois da transformação do elemento. */
export function volumeDaMalha(vertices: Float32Array, indices: Uint32Array, transf: number[]): number {
  // vertices: [x, y, z, nx, ny, nz] por vértice; transf: 16 valores em coluna (como o IFC.js entrega).
  const n = vertices.length / 6;
  const p = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = vertices[i * 6], y = vertices[i * 6 + 1], z = vertices[i * 6 + 2];
    p[i * 3] = transf[0] * x + transf[4] * y + transf[8] * z + transf[12];
    p[i * 3 + 1] = transf[1] * x + transf[5] * y + transf[9] * z + transf[13];
    p[i * 3 + 2] = transf[2] * x + transf[6] * y + transf[10] * z + transf[14];
  }
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    // a · (b × c) / 6
    const bx = p[b], by = p[b + 1], bz = p[b + 2], cx = p[c], cy = p[c + 1], cz = p[c + 2];
    v += (p[a] * (by * cz - bz * cy) - p[a + 1] * (bx * cz - bz * cx) + p[a + 2] * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
}

type Refs = { value: number } | { value: number }[] | undefined;
const idsDe = (r: Refs): number[] => (Array.isArray(r) ? r.map((x) => x.value) : r ? [r.value] : []);

/** Lê o modelo e devolve os quantitativos por pavimento e tipo. */
export async function quantitativosDoIfc(bytes: Uint8Array): Promise<{ itens: ItemIfc[]; pendencias: string[] }> {
  const ifc = new WebIFC.IfcAPI();
  await ifc.Init();
  const modelo = ifc.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
  try {
    // pavimento de cada elemento, pelo relacionamento de estrutura espacial
    const nomePavimento = new Map<number, string>();
    const pavimentoDoElemento = new Map<number, string>();
    const pavimentos = ifc.GetLineIDsWithType(modelo, WebIFC.IFCBUILDINGSTOREY);
    for (let i = 0; i < pavimentos.size(); i++) {
      const id = pavimentos.get(i);
      const s = ifc.GetLine(modelo, id);
      nomePavimento.set(id, String(s.Name?.value ?? `Pavimento ${id}`));
    }
    const rels = ifc.GetLineIDsWithType(modelo, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE);
    for (let i = 0; i < rels.size(); i++) {
      const rel = ifc.GetLine(modelo, rels.get(i));
      const pav = idsDe(rel.RelatingStructure);
      if (!pav.length || !nomePavimento.has(pav[0])) continue;
      for (const el of idsDe(rel.RelatedElements)) pavimentoDoElemento.set(el, nomePavimento.get(pav[0])!);
    }

    // volume de cada elemento pela geometria, e a classe de cada um
    const classeDo = new Map<number, number>();
    for (const t of TIPOS) {
      const ids = ifc.GetLineIDsWithType(modelo, t.classe);
      for (let i = 0; i < ids.size(); i++) classeDo.set(ids.get(i), t.classe);
    }
    const volumes = new Map<number, number>();
    ifc.StreamAllMeshes(modelo, (mesh) => {
      const id = mesh.expressID;
      if (!classeDo.has(id)) return;
      for (let i = 0; i < mesh.geometries.size(); i++) {
        const pg = mesh.geometries.get(i);
        const g = ifc.GetGeometry(modelo, pg.geometryExpressID);
        const v = ifc.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
        const idx = ifc.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
        const transf = Array.from(pg.flatTransformation as ArrayLike<number>);
        volumes.set(id, (volumes.get(id) ?? 0) + volumeDaMalha(v, idx, transf));
      }
    });

    // agrupa por pavimento e tipo
    const grupos = new Map<string, { pavimento: string; tipo: TipoIfc; descricao: string; unidade: 'm³' | 'un'; quantidade: number; elementos: number }>();
    const semPavimento: number[] = [];
    let semVolume = 0;
    for (const [id, classe] of classeDo) {
      const t = TIPOS.find((x) => x.classe === classe)!;
      const pavimento = pavimentoDoElemento.get(id);
      if (!pavimento) {
        semPavimento.push(id);
        continue;
      }
      const chave = `${pavimento}|${t.tipo}`;
      const g = grupos.get(chave) ?? { pavimento, tipo: t.tipo, descricao: t.descricao, unidade: t.contar ? 'un' : 'm³', quantidade: 0, elementos: 0 };
      if (t.contar) g.quantidade += 1;
      else {
        const vol = volumes.get(id) ?? 0;
        if (vol <= 0) semVolume++;
        g.quantidade += vol;
      }
      g.elementos += 1;
      grupos.set(chave, g);
    }

    const itens: ItemIfc[] = [...grupos.values()]
      .map((g) => ({ ...g, quantidade: Math.round(g.quantidade * 1000) / 1000 }))
      .sort((a, b) => a.pavimento.localeCompare(b.pavimento, 'pt-BR', { numeric: true }) || a.descricao.localeCompare(b.descricao, 'pt-BR'));
    const pendencias: string[] = [];
    if (semPavimento.length) pendencias.push(`${semPavimento.length} elemento(s) sem pavimento no modelo ficaram de fora.`);
    if (semVolume) pendencias.push(`${semVolume} elemento(s) sem volume calculado ficaram com quantidade zero.`);
    if (!itens.length) pendencias.push('Nenhum elemento de parede, laje, pilar, viga, porta ou janela ligado a um pavimento.');
    return { itens, pendencias };
  } finally {
    ifc.CloseModel(modelo);
  }
}
