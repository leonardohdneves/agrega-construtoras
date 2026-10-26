import { useState, type CSSProperties, type ReactNode } from 'react';

/** Texto sem acento e sem diferença de maiúsculas, para comparar buscas. */
export const normalizaBusca = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Lista suspensa com campo de busca: filtra por código ou parte da descrição, a cada tecla. */
export function SeletorBusca({
  id,
  label,
  opcoes,
  valor,
  onChange,
  vazio,
  disabled,
  semRotulo,
  style,
  resultadosVisiveis,
  listaCompleta,
  children,
}: {
  id: string;
  label: string;
  /** `busca`: texto extra pelo qual a opção é encontrada (ex.: etapas da EAP), sem aparecer no rótulo. */
  opcoes: { id: string; rotulo: string; busca?: string }[];
  valor: string;
  onChange: (id: string) => void;
  vazio: string;
  disabled?: boolean;
  /** Sem rótulo visível (uso em célula de tabela); o nome vai em aria-label. */
  semRotulo?: boolean;
  style?: CSSProperties;
  /** Mostra as opções encontradas logo abaixo do campo, a cada tecla (sem precisar abrir a lista). */
  resultadosVisiveis?: boolean;
  /** Mostra todas as opções numa lista rolável, com o texto inteiro quebrado em linhas (no lugar do menu suspenso). */
  listaCompleta?: boolean;
  children?: ReactNode;
}) {
  const [busca, setBusca] = useState('');
  const termos = normalizaBusca(busca).split(/\s+/).filter(Boolean);
  const casa = (o: { rotulo: string; busca?: string }) => termos.every((t) => normalizaBusca(o.busca ?? o.rotulo).includes(t));
  const visiveis = opcoes.filter((o) => o.id === valor || casa(o));
  // Busca ao vivo: com lista completa, só mostra os resultados enquanto digita (sem repetir todas as opções).
  const resultados = opcoes.filter(casa);
  return (
    <div className="campo" style={style}>
      {!semRotulo && <label htmlFor={id}>{label}</label>}
      <input
        type="search"
        aria-label={`Buscar ${label.toLowerCase()}`}
        placeholder="Código ou parte da descrição"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        disabled={disabled}
      />
      {listaCompleta ? (
        <>
          {termos.length === 0 ? (
            <p className="small muted" style={{ margin: '4px 0' }}>
              {valor ? <>Selecionado: <b>{opcoes.find((o) => o.id === valor)?.rotulo}</b>. </> : null}
              Digite para buscar pelo código, pela descrição ou pela etapa da EAP.
            </p>
          ) : resultados.length === 0 ? (
            <p className="small muted" style={{ margin: '4px 0' }}>Nenhum resultado para a busca.</p>
          ) : (
            <ul
              id={id}
              aria-label={label}
              style={{ listStyle: 'none', margin: '4px 0', padding: 0, maxHeight: 280, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}
            >
              {resultados.slice(0, 100).map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="btn btn-link"
                    disabled={disabled}
                    aria-pressed={o.id === valor}
                    onClick={() => onChange(o.id)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', minHeight: 0, whiteSpace: 'normal', overflowWrap: 'anywhere', fontWeight: o.id === valor ? 700 : 400, background: o.id === valor ? 'var(--surface-sunken)' : undefined }}
                  >
                    {o.rotulo}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <select id={id} aria-label={semRotulo ? label : undefined} value={valor} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">{visiveis.length === 0 ? 'Nenhum resultado para a busca' : vazio}</option>
          {visiveis.map((o) => (
            <option key={o.id} value={o.id}>{o.rotulo}</option>
          ))}
        </select>
      )}
      {termos.length > 0 && <small className="muted">{visiveis.length} de {opcoes.length} encontrado(s)</small>}
      {resultadosVisiveis && termos.length > 0 && visiveis.length > 0 && (
        <ul aria-label={`Resultados para ${label.toLowerCase()}`} style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-card)' }}>
          {visiveis.slice(0, 15).map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="btn btn-link"
                disabled={disabled}
                onClick={() => {
                  onChange(o.id);
                  setBusca('');
                }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', minHeight: 0, whiteSpace: 'normal', fontWeight: o.id === valor ? 700 : 400 }}
              >
                {o.rotulo}
              </button>
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}
