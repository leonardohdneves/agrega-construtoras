// Aviso de lista incompleta (P18): a API devolve no máximo um certo número de registros e marca `temMais` quando
// havia mais. Sem o aviso, os registros a mais sumiam da tela sem nenhuma indicação.
export function AvisoLista({ temMais, limite }: { temMais: boolean | undefined; limite: number }) {
  if (!temMais) return null;
  return (
    <div className="alerta alerta-aviso" role="status">
      A lista mostra só os primeiros {limite.toLocaleString('pt-BR')} registros. Use os filtros (período, situação ou obra) para ver o restante.
    </div>
  );
}
