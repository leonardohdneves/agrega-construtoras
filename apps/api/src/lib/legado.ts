// Rotas legadas da concreteira (Frota, Produção, Qualidade e relatórios ligados a elas), desligadas na construtora (P22).
// Continuavam registradas, protegidas só pela guarda de módulo, e ampliavam a superfície exposta. Agora respondem 404,
// menos as consultas de cadastro que telas ativas ainda usam (veículo na apropriação, insumos e traços em listas).

const PREFIXO_LEGADO = /^\/api\/(frota|prod|qual)(\/|$)/;
const ROTAS_LEGADAS_AVULSAS = new Set(['/api/rel/frota', '/api/ger/custo-veiculo']);

/** Consultas legadas mantidas (método + padrão da rota). */
const MANTIDAS = new Set(['GET /api/frota/veiculos', 'GET /api/frota/motoristas', 'GET /api/prod/insumos', 'GET /api/prod/tracos']);

/** A rota (padrão registrado) é legada e está desligada? */
export function rotaLegadaDesligada(metodo: string, padrao: string | undefined): boolean {
  if (!padrao) return false;
  const legada = PREFIXO_LEGADO.test(padrao) || ROTAS_LEGADAS_AVULSAS.has(padrao);
  return legada && !MANTIDAS.has(`${metodo.toUpperCase()} ${padrao}`);
}
