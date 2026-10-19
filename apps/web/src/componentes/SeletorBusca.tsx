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
  children,
}: {
  id: string;
  label: string;
  opcoes: { id: string; rotulo: string }[];
  valor: string;
  onChange: (id: string) => void;
  vazio: string;
  disabled?: boolean;
  /** Sem rótulo visível (uso em célula de tabela); o nome vai em aria-label. */
  semRotulo?: boolean;
  style?: CSSProperties;
  /** Mostra as opções encontradas logo abaixo do campo, a cada tecla (sem precisar abrir a lista). */
  resultadosVisiveis?: boolean;
  children?: ReactNode;
}) {
  const [busca, setBusca] = useState('');
  const termos = normalizaBusca(busca).split(/\s+/).filter(Boolean);
  const visiveis = opcoes.filter((o) => o.id === valor || termos.every((t) => normalizaBusca(o.rotulo).includes(t)));
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
      <select id={id} aria-label={semRotulo ? label : undefined} value={valor} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{visiveis.length === 0 ? 'Nenhum resultado para a busca' : vazio}</option>
        {visiveis.map((o) => (
          <option key={o.id} value={o.id}>{o.rotulo}</option>
        ))}
      </select>
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
