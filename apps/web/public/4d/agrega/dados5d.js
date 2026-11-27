// Lê os dados de uma obra direto da API do Agrega para a tela de 5D: cronograma, curva S e previsto × realizado.
// A página precisa estar no mesmo domínio da API (credentials 'include' envia a sessão do Agrega).
import { montarCronograma } from './cronograma5d.js';

async function lerJson(url, fetchImpl) {
  const res = await fetchImpl(url, { credentials: 'include' });
  if (res.status === 401) throw new Error('Sem sessão no Agrega. Entre no Agrega neste navegador e abra o 5D de novo.');
  if (!res.ok) throw new Error(`Não consegui ler ${url.replace(/^https?:\/\/[^/]+/, '')} (HTTP ${res.status}).`);
  return res.json();
}

/** Data de hoje no formato AAAA-MM-DD (o previsto × realizado é calculado para essa data). */
export const hojeIso = (agora = new Date()) => new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export async function carregarDadosObra({ base, obraId, hoje = hojeIso(), fetchImpl = globalThis.fetch }) {
  const origem = String(base).replace(/\/+$/, '');
  const id = encodeURIComponent(obraId);
  const caminho = `${origem}/api/eng/obras/${id}`;
  const [obraResp, planejamento, eap, pr, curva] = await Promise.all([
    lerJson(caminho, fetchImpl),
    lerJson(`${caminho}/planejamento`, fetchImpl),
    lerJson(`${caminho}/eap`, fetchImpl),
    lerJson(`${caminho}/relatorios-gerenciais/previsto-realizado?data=${hoje}`, fetchImpl),
    lerJson(`${caminho}/relatorios-gerenciais/curva-s`, fetchImpl),
  ]);
  const o = obraResp.obra ?? {};
  const nomeObra = [o.codigo, o.nome].filter(Boolean).join(' · ');
  const cron = montarCronograma({
    atividades: planejamento.atividades ?? [],
    nos: eap.nos ?? [],
    linhas: pr.linhas ?? [],
    obraId,
    obra: nomeObra,
    fonte: `API REST do Agrega (planejamento, EAP, previsto × realizado de ${hoje})`,
  });
  return { cron, curva, pr, obra: nomeObra };
}
