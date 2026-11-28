// Envia o IFC ao Agrega e recebe a geometria pronta para desenhar. O navegador não lê o IFC: só monta as malhas.

/** Bytes → base64, em pedaços (arquivos grandes estouram a pilha se convertidos de uma vez). */
export function paraBase64(bytes) {
  let binario = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binario);
}

function bytesDe(base64) {
  const binario = atob(base64);
  const saida = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) saida[i] = binario.charCodeAt(i);
  return saida.buffer;
}

export const LIMITE_3D = 30 * 1024 * 1024;

export async function lerGeometriaIfc({ base, dados, fetchImpl = globalThis.fetch }) {
  // acima do limite o servidor recusa o envio inteiro: avisa antes de subir
  if (dados.length > LIMITE_3D) {
    throw new Error(`O modelo tem ${(dados.length / 1048576).toFixed(1).replace('.', ',')} MB; o 3D abre modelos de até 30 MB.`);
  }
  const url = `${String(base).replace(/\/+$/, '')}/api/eng/ifc/geometria`;
  const res = await fetchImpl(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ arquivo: paraBase64(dados) }),
  });
  if (res.status === 401) throw new Error('Sem sessão no Agrega. Entre no Agrega neste navegador para abrir o modelo 3D.');
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo.erro ?? `Não consegui ler o modelo (HTTP ${res.status}).`);
  return {
    ignoradas: corpo.ignoradas ?? 0,
    pecas: (corpo.pecas ?? []).map((p) => ({
      guid: p.guid,
      nome: p.nome,
      tipo: p.tipo,
      matriz: p.matriz,
      pos: new Float32Array(bytesDe(p.pos)),
      nor: new Float32Array(bytesDe(p.nor)),
      idx: new Uint32Array(bytesDe(p.idx)),
    })),
  };
}
