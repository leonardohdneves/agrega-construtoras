import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatarMoeda, hojeLocal, lerNumero, NOMES_FORMA, type ContaFinanceira, type FormaPagamento, type Parcela } from '../api';

/** Formulário para dar baixa (pagar ou receber) em uma parcela. */
export function FormBaixa({
  parcela,
  tipo,
  contas,
  aoConcluir,
  aoCancelar,
}: {
  parcela: Parcela;
  tipo: 'receita' | 'despesa';
  contas: ContaFinanceira[];
  aoConcluir: (p: Parcela) => void;
  aoCancelar: () => void;
}) {
  const ativas = contas.filter((c) => c.ativo);
  const [f, setF] = useState({
    data: hojeLocal(),
    contaId: ativas.find((c) => c.tipo === 'banco')?.id ?? ativas[0]?.id ?? '',
    forma: (tipo === 'despesa' ? 'boleto' : 'pix') as FormaPagamento,
    juros: '',
    desconto: '',
  });
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const final = parcela.valor + (lerNumero(f.juros) ?? 0) - (lerNumero(f.desconto) ?? 0);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ parcela: Parcela }>(`/fin/parcelas/${parcela.id}/baixar`, { corpo: f });
      aoConcluir(r.parcela);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  if (!ativas.length) {
    return (
      <div className="alerta alerta-erro" role="alert">
        Cadastre uma conta bancária ou caixa em <Link to="/fin/contas">Bancos e conciliação</Link> para registrar pagamentos.
      </div>
    );
  }

  return (
    <form className="form baixa" onSubmit={salvar}>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor={`b-data-${parcela.id}`}>{tipo === 'despesa' ? 'Pago em' : 'Recebido em'}</label>
          <input id={`b-data-${parcela.id}`} type="date" max={hojeLocal()} value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor={`b-conta-${parcela.id}`}>Conta</label>
          <select id={`b-conta-${parcela.id}`} value={f.contaId} onChange={(e) => setF({ ...f, contaId: e.target.value })}>
            {ativas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor={`b-forma-${parcela.id}`}>Forma</label>
          <select id={`b-forma-${parcela.id}`} value={f.forma} onChange={(e) => setF({ ...f, forma: e.target.value as FormaPagamento })}>
            {Object.entries(NOMES_FORMA).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor={`b-juros-${parcela.id}`}>Juros e multa (R$)</label>
          <input id={`b-juros-${parcela.id}`} className="mono" inputMode="decimal" placeholder="0,00" value={f.juros} onChange={(e) => setF({ ...f, juros: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor={`b-desc-${parcela.id}`}>Desconto (R$)</label>
          <input id={`b-desc-${parcela.id}`} className="mono" inputMode="decimal" placeholder="0,00" value={f.desconto} onChange={(e) => setF({ ...f, desconto: e.target.value })} />
        </div>
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado || !f.contaId}>
          {tipo === 'despesa' ? 'Confirmar pagamento' : 'Confirmar recebimento'} · <span className="mono">{formatarMoeda(final)}</span>
        </button>
        <button className="btn btn-secundario" type="button" onClick={aoCancelar}>
          Voltar
        </button>
      </div>
    </form>
  );
}
