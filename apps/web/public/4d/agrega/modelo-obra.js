// Modelo 3D convertido guardado na obra, pela API do Agrega (a página usa a sessão do Agrega).
import { paraBase64 } from './ifc-servidor.js';

const endereco = (base, obraId) => `${String(base).replace(/\/+$/, '')}/api/eng/obras/${encodeURIComponent(obraId)}/modelo-3d`;

async function conferir(res, acao) {
  if (res.ok) return res;
  if (res.status === 401) throw new Error('Sem sessão no Agrega. Entre no Agrega neste navegador e tente de novo.');
  if (res.status === 403) throw new Error(`Seu perfil não pode ${acao} nesta obra.`);
  const corpo = await res.json().catch(() => ({}));
  throw new Error(corpo.erro ?? `Não consegui ${acao} (HTTP ${res.status}).`);
}

/** Dados do modelo guardado na obra, ou null se a obra não tem um. */
export async function infoModelo({ base, obraId, fetchImpl = globalThis.fetch }) {
  const res = await conferir(await fetchImpl(endereco(base, obraId), { credentials: 'include' }), 'consultar o modelo');
  return (await res.json()).modelo;
}

export async function baixarModelo({ base, obraId, fetchImpl = globalThis.fetch }) {
  const res = await conferir(await fetchImpl(`${endereco(base, obraId)}/arquivo`, { credentials: 'include' }), 'baixar o modelo');
  return res.blob();
}

export async function guardarModelo({ base, obraId, dados, nome, fetchImpl = globalThis.fetch }) {
  await conferir(
    await fetchImpl(endereco(base, obraId), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ arquivo: paraBase64(dados), nome }),
    }),
    'guardar o modelo',
  );
}

export async function removerModelo({ base, obraId, fetchImpl = globalThis.fetch }) {
  await conferir(await fetchImpl(endereco(base, obraId), { method: 'DELETE', credentials: 'include' }), 'remover o modelo');
}

/** Linha de situação mostrada na tela. */
export function descreverModelo(m) {
  const mb = (m.tamanho / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const data = new Date(m.enviadoEm).toLocaleDateString('pt-BR');
  return `Modelo guardado na obra: ${m.nome} · ${mb} MB · ${data}${m.enviadoPor ? ` por ${m.enviadoPor}` : ''}.`;
}
