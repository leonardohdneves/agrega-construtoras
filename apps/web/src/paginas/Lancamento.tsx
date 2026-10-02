import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FormBaixa } from '../componentes/FormBaixa';
import {
  api,
  dividirParcelas,
  formatarData,
  formatarMoeda,
  hojeLocal,
  lerNumero,
  moedaCampo,
  NOMES_FORMA,
  SELO_PARCELA,
  somarDias,
  type CentroCusto,
  type ContaFinanceira,
  type FormaPagamento,
  type Fornecedor,
  type Lancamento as Lanc,
  type Parcela,
  type PlanoConta,
  type TipoLanc,
  type Veiculo,
} from '../api';

type Ap = { planoContaId: string; centroCustoId: string; veiculoId: string; valor: string };
type Pa = { chave: string; vencimento: string; valor: string; paga?: Parcela };
type Condicao = 'pago' | 'vencimento' | 'parcelado';
export type Cadastros = { plano: PlanoConta[]; centros: CentroCusto[]; veiculos: Veiculo[]; contas: ContaFinanceira[]; fornecedores: Fornecedor[]; clientes: Fornecedor[] };

const AP_VAZIA: Ap = { planoContaId: '', centroCustoId: '', veiculoId: '', valor: '' };
let seq = 0;
const chave = () => `p${++seq}`;
const soma = (xs: string[]) => Math.round(xs.reduce((s, x) => s + (lerNumero(x) ?? 0), 0) * 100) / 100;

export function useCadastros() {
  const [c, setC] = useState<Cadastros | null>(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(async () => {
    try {
      const [plano, centros, veiculos, contas, fornecedores, clientes] = await Promise.all([
        api<{ contas: PlanoConta[] }>('/fin/plano-contas'),
        api<{ centros: CentroCusto[] }>('/fin/centros-custo'),
        api<{ veiculos: Veiculo[] }>('/frota/veiculos'),
        api<{ contas: ContaFinanceira[] }>('/fin/contas'),
        api<{ fornecedores: Fornecedor[] }>('/adm/fornecedores'),
        api<{ clientes: Fornecedor[] }>('/adm/clientes'),
      ]);
      setC({ plano: plano.contas, centros: centros.centros, veiculos: veiculos.veiculos, contas: contas.contas, fornecedores: fornecedores.fornecedores, clientes: clientes.clientes });
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);
  return { cadastros: c, erro, recarregar: carregar };
}

/** Categorias lançáveis do tipo, agrupadas pelo grupo raiz. */
export function OpcoesCategoria({ plano, tipo, atual }: { plano: PlanoConta[]; tipo: TipoLanc; atual: string }) {
  const grupos = plano.filter((p) => !p.paiId);
  const lancaveis = plano.filter((p) => p.aceitaLancamento && p.tipo === tipo && (p.ativo || p.id === atual));
  const raiz = (p: PlanoConta): string => {
    let x = p;
    while (x.paiId) {
      const pai = plano.find((y) => y.id === x.paiId);
      if (!pai) break;
      x = pai;
    }
    return x.id;
  };
  return (
    <>
      <option value="">Escolha a categoria</option>
      {grupos.map((g) => {
        const filhos = lancaveis.filter((p) => p.id !== g.id && raiz(p) === g.id);
        if (!filhos.length) return null;
        return (
          <optgroup key={g.id} label={`${g.codigo} ${g.nome}`}>
            {filhos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} {p.nome}
              </option>
            ))}
          </optgroup>
        );
      })}
      {lancaveis
        .filter((p) => !p.paiId)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.codigo} {p.nome}
          </option>
        ))}
    </>
  );
}

function FormLancamento({ tipo, inicial, cadastros, aoSalvar }: { tipo: TipoLanc; inicial?: Lanc; cadastros: Cadastros; aoSalvar: (l: Lanc, criados?: number) => void }) {
  const editando = !!inicial;
  const hoje = hojeLocal();
  const [f, setF] = useState(() => ({
    competencia: inicial?.competencia ?? hoje,
    descricao: inicial?.descricao ?? '',
    documento: inicial?.documento ?? '',
    pessoaId: (tipo === 'receita' ? inicial?.clienteId : inicial?.fornecedorId) ?? '',
    valorTotal: inicial ? moedaCampo(inicial.valorTotal) : '',
    observacoes: inicial?.observacoes ?? '',
  }));
  const [aps, setAps] = useState<Ap[]>(() =>
    inicial?.apropriacoes.length
      ? inicial.apropriacoes.map((a) => ({ planoContaId: a.planoContaId, centroCustoId: a.centroCustoId ?? '', veiculoId: a.veiculoId ?? '', valor: moedaCampo(a.valor) }))
      : [{ ...AP_VAZIA }],
  );
  const [condicao, setCondicao] = useState<Condicao>('vencimento');
  const [pago, setPago] = useState({ data: hoje, contaId: cadastros.contas.find((c) => c.ativo && c.tipo === 'banco')?.id ?? cadastros.contas.find((c) => c.ativo)?.id ?? '', forma: 'pix' as FormaPagamento });
  const [vencimento, setVencimento] = useState(somarDias(hoje, tipo === 'despesa' ? 28 : 30));
  const [parc, setParc] = useState({ quantidade: '3', primeiro: somarDias(hoje, 28), intervalo: 'mensal' });
  const [parcelas, setParcelas] = useState<Pa[]>(() =>
    (inicial?.parcelas ?? [])
      .filter((p) => p.status !== 'cancelada')
      .map((p) => ({ chave: chave(), vencimento: p.vencimento, valor: moedaCampo(p.valor), paga: p.status === 'paga' ? p : undefined })),
  );
  const [recorrencia, setRecorrencia] = useState({ tipo: 'nenhuma', repeticoes: '12' });
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const total = lerNumero(f.valorTotal);
  const pessoas = tipo === 'receita' ? cadastros.clientes : cadastros.fornecedores;
  const semPlano = !cadastros.plano.some((p) => p.aceitaLancamento && p.tipo === tipo);

  // No parcelamento, refaz as parcelas quando muda o total, a quantidade, a data ou o intervalo.
  useEffect(() => {
    if (editando || condicao !== 'parcelado' || !total) return;
    const n = Math.min(Math.max(Number(parc.quantidade) || 1, 1), 120);
    setParcelas(
      dividirParcelas(total, n, parc.primeiro, parc.intervalo === 'mensal' ? 'mensal' : Number(parc.intervalo)).map((p) => ({ chave: chave(), vencimento: p.vencimento, valor: moedaCampo(p.valor) })),
    );
  }, [editando, condicao, total, parc.quantidade, parc.primeiro, parc.intervalo]);

  function mudarAp(i: number, campo: keyof Ap, valor: string) {
    setAps((xs) =>
      xs.map((a, j) => {
        if (j !== i) return a;
        const n = { ...a, [campo]: valor };
        // Escolheu o veículo e não há centro: sugere Bombas ou Frota.
        if (campo === 'veiculoId' && valor && !a.centroCustoId) {
          const v = cadastros.veiculos.find((x) => x.id === valor);
          const nome = v?.tipo.startsWith('bomba') ? 'bombas' : 'frota';
          const c = cadastros.centros.find((x) => x.ativo && x.nome.toLowerCase() === nome);
          if (c) n.centroCustoId = c.id;
        }
        return n;
      }),
    );
  }

  const somaAps = soma(aps.map((a) => a.valor));
  const somaParcelas = soma(parcelas.map((p) => p.valor));
  const usaParcelas = editando || condicao === 'parcelado';

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (!total || total <= 0) return setErro('Informe o valor total.');
    if (aps.length > 1 && Math.abs(somaAps - total) > 0.001) return setErro(`A soma das categorias (${formatarMoeda(somaAps)}) é diferente do total (${formatarMoeda(total)}).`);
    if (usaParcelas && Math.abs(somaParcelas - total) > 0.001) return setErro(`A soma das parcelas (${formatarMoeda(somaParcelas)}) é diferente do total (${formatarMoeda(total)}).`);
    const corpo: Record<string, unknown> = {
      tipo,
      competencia: f.competencia,
      descricao: f.descricao,
      documento: f.documento,
      clienteId: tipo === 'receita' ? f.pessoaId || null : null,
      fornecedorId: tipo === 'despesa' ? f.pessoaId || null : null,
      observacoes: f.observacoes,
      valorTotal: f.valorTotal,
      apropriacoes: aps.map((a) => ({ planoContaId: a.planoContaId, centroCustoId: a.centroCustoId || null, veiculoId: a.veiculoId || null, ...(aps.length > 1 ? { valor: a.valor } : {}) })),
    };
    if (editando) corpo.parcelas = parcelas.filter((p) => !p.paga).map((p) => ({ vencimento: p.vencimento, valor: p.valor }));
    else if (condicao === 'pago') {
      corpo.parcelas = [{ vencimento: pago.data, valor: f.valorTotal }];
      corpo.baixa = { data: pago.data, contaId: pago.contaId, forma: pago.forma };
    } else if (condicao === 'vencimento') corpo.parcelas = [{ vencimento, valor: f.valorTotal }];
    else corpo.parcelas = parcelas.map((p) => ({ vencimento: p.vencimento, valor: p.valor }));
    if (!editando && recorrencia.tipo !== 'nenhuma') {
      corpo.recorrencia = recorrencia.tipo;
      corpo.repeticoes = recorrencia.repeticoes;
    }
    setOcupado(true);
    try {
      const r = editando
        ? await api<{ lancamento: Lanc }>(`/fin/lancamentos/${inicial!.id}`, { metodo: 'PUT', corpo })
        : await api<{ lancamento: Lanc; criados: number }>('/fin/lancamentos', { corpo });
      aoSalvar(r.lancamento, 'criados' in r ? (r as { criados: number }).criados : undefined);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const rotuloPessoa = tipo === 'receita' ? 'Cliente' : 'Fornecedor ou credor';
  const verbo = tipo === 'despesa' ? 'pago' : 'recebido';

  return (
    <form className="card form" onSubmit={salvar}>
      {semPlano && (
        <div className="alerta alerta-erro" role="alert">
          O plano de contas ainda não tem categorias de {tipo}. <Link to="/fin/plano-contas">Aplique o plano padrão ou crie categorias</Link>.
        </div>
      )}
      <div className="campos">
        <div className="campo largo">
          <label htmlFor="l-desc">Descrição</label>
          <input id="l-desc" value={f.descricao} placeholder={tipo === 'despesa' ? 'Ex.: Cimento CP-II 30 t' : 'Ex.: Concreto fck 25 · 20 m³ · obra X'} onChange={(e) => setF({ ...f, descricao: e.target.value })} required />
        </div>
        <div className="campo">
          <label htmlFor="l-valor">Valor total (R$)</label>
          <input id="l-valor" className="mono" inputMode="decimal" placeholder="0,00" value={f.valorTotal} onChange={(e) => setF({ ...f, valorTotal: e.target.value })} required />
        </div>
        <div className="campo">
          <label htmlFor="l-pessoa">{rotuloPessoa}</label>
          <select id="l-pessoa" value={f.pessoaId} onChange={(e) => setF({ ...f, pessoaId: e.target.value })}>
            <option value="">Não informado</option>
            {tipo === 'despesa'
              ? (['fornecedor', 'credor'] as const).map((cat) => (
                  <optgroup key={cat} label={cat === 'fornecedor' ? 'Fornecedores' : 'Credores'}>
                    {pessoas
                      .filter((p) => p.categoria === cat && (p.ativo || p.id === f.pessoaId))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nomeFantasia || p.razaoSocial}
                        </option>
                      ))}
                  </optgroup>
                ))
              : pessoas
                  .filter((p) => p.ativo || p.id === f.pessoaId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nomeFantasia || p.razaoSocial}
                    </option>
                  ))}
          </select>
          <span className="small muted">
            Não está na lista? <Link to={tipo === 'receita' ? '/adm/clientes' : '/adm/fornecedores'}>Cadastre em Administrativo</Link>.
          </span>
        </div>
        <div className="campo">
          <label htmlFor="l-comp">Competência</label>
          <input id="l-comp" type="date" value={f.competencia} onChange={(e) => setF({ ...f, competencia: e.target.value })} required />
          <span className="small muted">Data do fato: entrega, compra ou serviço. É a que vale na DRE por competência.</span>
        </div>
        <div className="campo">
          <label htmlFor="l-doc">Documento (nota, recibo)</label>
          <input id="l-doc" value={f.documento} placeholder="Ex.: NF 1234" onChange={(e) => setF({ ...f, documento: e.target.value })} />
        </div>
      </div>

      <fieldset className="grupo-marcar">
        <legend>Categoria (apropriação)</legend>
        {aps.map((a, i) => (
          <div key={i} className="campos linha-ap">
            <div className="campo">
              <label htmlFor={`ap-pc-${i}`}>Categoria</label>
              <select id={`ap-pc-${i}`} value={a.planoContaId} onChange={(e) => mudarAp(i, 'planoContaId', e.target.value)} required>
                <OpcoesCategoria plano={cadastros.plano} tipo={tipo} atual={a.planoContaId} />
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`ap-cc-${i}`}>Centro de custo</label>
              <select id={`ap-cc-${i}`} value={a.centroCustoId} onChange={(e) => mudarAp(i, 'centroCustoId', e.target.value)}>
                <option value="">Não informado</option>
                {cadastros.centros
                  .filter((c) => c.ativo || c.id === a.centroCustoId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`ap-v-${i}`}>Veículo</label>
              <select id={`ap-v-${i}`} value={a.veiculoId} onChange={(e) => mudarAp(i, 'veiculoId', e.target.value)}>
                <option value="">Nenhum</option>
                {cadastros.veiculos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.codigo}
                  </option>
                ))}
              </select>
            </div>
            {aps.length > 1 && (
              <div className="campo">
                <label htmlFor={`ap-val-${i}`}>Valor (R$)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input id={`ap-val-${i}`} className="mono" inputMode="decimal" value={a.valor} onChange={(e) => mudarAp(i, 'valor', e.target.value)} required />
                  <button type="button" className="btn btn-link" aria-label={`Remover categoria ${i + 1}`} onClick={() => setAps((xs) => xs.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        <div className="acoes">
          <button
            type="button"
            className="btn btn-link"
            onClick={() =>
              setAps((xs) => {
                const base = xs.length === 1 ? [{ ...xs[0], valor: total ? moedaCampo(total) : '' }] : xs;
                const falta = total ? Math.round((total - soma(base.map((a) => a.valor))) * 100) / 100 : 0;
                return [...base, { ...AP_VAZIA, valor: falta > 0 ? moedaCampo(falta) : '' }];
              })
            }
          >
            + Dividir em mais uma categoria
          </button>
          {aps.length > 1 && total ? (
            <span className={`small ${Math.abs(somaAps - total) > 0.001 ? 'texto-perigo' : 'muted'}`}>
              {somaAps < total - 0.001
                ? `Falta distribuir ${formatarMoeda(Math.round((total - somaAps) * 100) / 100)}`
                : somaAps > total + 0.001
                  ? `Passou ${formatarMoeda(Math.round((somaAps - total) * 100) / 100)} do total`
                  : 'Valores conferem com o total.'}
            </span>
          ) : null}
        </div>
      </fieldset>

      {!editando && (
        <fieldset className="grupo-marcar">
          <legend>{tipo === 'despesa' ? 'Pagamento' : 'Recebimento'}</legend>
          <div className="segmentado tres-opcoes" role="group" aria-label="Condição">
            {(
              [
                ['pago', tipo === 'despesa' ? 'Já paguei' : 'Já recebi'],
                ['vencimento', 'Um vencimento'],
                ['parcelado', 'Parcelado'],
              ] as const
            ).map(([k, t]) => (
              <button key={k} type="button" aria-pressed={condicao === k} className={condicao === k ? 'ativo' : ''} onClick={() => setCondicao(k)}>
                {t}
              </button>
            ))}
          </div>
          {condicao === 'pago' && (
            <div className="campos" style={{ marginTop: 12 }}>
              <div className="campo">
                <label htmlFor="pg-data">{tipo === 'despesa' ? 'Pago em' : 'Recebido em'}</label>
                <input id="pg-data" type="date" max={hoje} value={pago.data} onChange={(e) => setPago({ ...pago, data: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="pg-conta">Conta</label>
                <select id="pg-conta" value={pago.contaId} onChange={(e) => setPago({ ...pago, contaId: e.target.value })} required>
                  <option value="">{cadastros.contas.length ? 'Escolha a conta' : 'Cadastre uma conta antes'}</option>
                  {cadastros.contas
                    .filter((c) => c.ativo)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="pg-forma">Forma</label>
                <select id="pg-forma" value={pago.forma} onChange={(e) => setPago({ ...pago, forma: e.target.value as FormaPagamento })}>
                  {Object.entries(NOMES_FORMA).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {condicao === 'vencimento' && (
            <div className="campos" style={{ marginTop: 12 }}>
              <div className="campo">
                <label htmlFor="pg-venc">Vencimento</label>
                <input id="pg-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} required />
              </div>
            </div>
          )}
          {condicao === 'parcelado' && (
            <div className="campos" style={{ marginTop: 12 }}>
              <div className="campo">
                <label htmlFor="pc-n">Parcelas</label>
                <input id="pc-n" className="mono" inputMode="numeric" value={parc.quantidade} onChange={(e) => setParc({ ...parc, quantidade: e.target.value.replace(/\D/g, '') })} />
              </div>
              <div className="campo">
                <label htmlFor="pc-1">1º vencimento</label>
                <input id="pc-1" type="date" value={parc.primeiro} onChange={(e) => setParc({ ...parc, primeiro: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="pc-int">Intervalo</label>
                <select id="pc-int" value={parc.intervalo} onChange={(e) => setParc({ ...parc, intervalo: e.target.value })}>
                  <option value="mensal">Mensal (mesmo dia)</option>
                  <option value="28">A cada 28 dias</option>
                  <option value="30">A cada 30 dias</option>
                  <option value="14">A cada 14 dias</option>
                  <option value="7">Semanal</option>
                </select>
              </div>
            </div>
          )}
        </fieldset>
      )}

      {usaParcelas && (
        <EditorParcelas
          parcelas={parcelas}
          setParcelas={setParcelas}
          total={total}
          somaParcelas={somaParcelas}
          verbo={verbo}
          editando={editando}
        />
      )}

      {!editando && (
        <div className="campos">
          <div className="campo">
            <label htmlFor="l-rec">Repetir</label>
            <select id="l-rec" value={recorrencia.tipo} onChange={(e) => setRecorrencia({ ...recorrencia, tipo: e.target.value })}>
              <option value="nenhuma">Não repete</option>
              <option value="mensal">Todo mês</option>
              <option value="semanal">Toda semana</option>
              <option value="anual">Todo ano</option>
            </select>
          </div>
          {recorrencia.tipo !== 'nenhuma' && (
            <div className="campo">
              <label htmlFor="l-rep">Quantas vezes, contando esta</label>
              <input id="l-rep" className="mono" inputMode="numeric" value={recorrencia.repeticoes} onChange={(e) => setRecorrencia({ ...recorrencia, repeticoes: e.target.value.replace(/\D/g, '') })} />
              <span className="small muted">Para aluguel, folha, seguros e contratos. Cada repetição vira um lançamento com competência e vencimento avançando.</span>
            </div>
          )}
        </div>
      )}

      <div className="campo">
        <label htmlFor="l-obs">Observações</label>
        <input id="l-obs" value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
      </div>

      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado || semPlano}>
          {ocupado ? 'Salvando…' : editando ? 'Salvar alterações' : tipo === 'despesa' ? 'Lançar despesa' : 'Lançar receita'}
        </button>
        <Link className="btn btn-secundario" to={editando ? '/fin/lancamentos' : `/fin/pagar-receber?tipo=${tipo}`}>
          {editando ? 'Voltar' : 'Cancelar'}
        </Link>
      </div>
    </form>
  );
}

function EditorParcelas({
  parcelas,
  setParcelas,
  total,
  somaParcelas,
  verbo,
  editando,
}: {
  parcelas: Pa[];
  setParcelas: (fn: (xs: Pa[]) => Pa[]) => void;
  total: number | null;
  somaParcelas: number;
  verbo: string;
  editando: boolean;
}) {
  const difere = total !== null && Math.abs(somaParcelas - total) > 0.001;
  return (
    <fieldset className="grupo-marcar">
      <legend>{editando ? 'Vencimentos' : 'Parcelas'}</legend>
      {parcelas.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>Informe o valor total para gerar as parcelas.</p>
      ) : (
        <div className="lista-parcelas">
          {parcelas.map((p, i) => (
            <div key={p.chave} className="linha-parcela">
              <span className="mono small muted">{i + 1}</span>
              {p.paga ? (
                <>
                  <span className="mono">{formatarData(p.vencimento)}</span>
                  <span className="mono">{formatarMoeda(p.paga.valor)}</span>
                  <span className="small muted">
                    {verbo} em {formatarData(p.paga.dataPagamento)}
                  </span>
                </>
              ) : (
                <>
                  <input aria-label={`Vencimento da parcela ${i + 1}`} type="date" value={p.vencimento} onChange={(e) => setParcelas((xs) => xs.map((x) => (x.chave === p.chave ? { ...x, vencimento: e.target.value } : x)))} />
                  <input aria-label={`Valor da parcela ${i + 1}`} className="mono" inputMode="decimal" value={p.valor} onChange={(e) => setParcelas((xs) => xs.map((x) => (x.chave === p.chave ? { ...x, valor: e.target.value } : x)))} />
                  {editando && (
                    <button type="button" className="btn btn-link" onClick={() => setParcelas((xs) => xs.filter((x) => x.chave !== p.chave))}>
                      Remover
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="acoes">
        {editando && (
          <button
            type="button"
            className="btn btn-link"
            onClick={() =>
              setParcelas((xs) => {
                const ultimo = xs[xs.length - 1]?.vencimento ?? hojeLocal();
                const falta = total !== null ? Math.round((total - soma(xs.map((x) => x.valor))) * 100) / 100 : 0;
                return [...xs, { chave: chave(), vencimento: somarDias(ultimo, 30), valor: falta > 0 ? moedaCampo(falta) : '' }];
              })
            }
          >
            + Adicionar parcela
          </button>
        )}
        {parcelas.length > 0 && (
          <span className={`small ${difere ? 'texto-perigo' : 'muted'}`}>
            Soma {formatarMoeda(somaParcelas)}
            {difere && total !== null ? ` · diferença de ${formatarMoeda(Math.round((total - somaParcelas) * 100) / 100)}` : ''}
          </span>
        )}
      </div>
    </fieldset>
  );
}

// ---------- Página ----------
export function Lancamento() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const local = useLocation();
  const { cadastros, erro: erroCad, recarregar } = useCadastros();
  const [lanc, setLanc] = useState<Lanc | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState(() => (local.state as { aviso?: string } | null)?.aviso ?? '');
  const [baixando, setBaixando] = useState<string | null>(null);
  const [cancelar, setCancelar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [versao, setVersao] = useState(0);
  const novo = !id || id === 'novo';
  const tipo: TipoLanc = novo ? (params.get('tipo') === 'receita' ? 'receita' : 'despesa') : lanc?.tipo ?? 'despesa';

  const carregar = useCallback(async () => {
    if (novo) return;
    try {
      setLanc((await api<{ lancamento: Lanc }>(`/fin/lancamentos/${id}`)).lancamento);
      setVersao((v) => v + 1);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id, novo]);
  useEffect(() => {
    setLanc(null);
    carregar();
  }, [carregar]);

  const abertas = useMemo(() => (lanc?.parcelas ?? []).filter((p) => p.status !== 'cancelada'), [lanc]);

  async function estornar(p: Parcela) {
    setErro('');
    setOcupado(true);
    try {
      await api(`/fin/parcelas/${p.id}/estornar`, { metodo: 'POST' });
      setAviso(`Parcela ${p.numero} estornada.`);
      await carregar();
      recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarCancelamento(seguintes: boolean) {
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ cancelados: number }>(`/fin/lancamentos/${id}/cancelar`, { corpo: { seguintes } });
      setCancelar(false);
      setAviso(r.cancelados > 1 ? `${r.cancelados} lançamentos cancelados.` : 'Lançamento cancelado.');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const titulo = novo ? (tipo === 'despesa' ? 'Nova despesa' : 'Nova receita') : lanc ? `${lanc.tipo === 'despesa' ? 'Despesa' : 'Receita'} · ${lanc.descricao}` : 'Lançamento';
  const erroGeral = erro || erroCad;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <Link to="/fin/lancamentos" className="small">← Lançamentos</Link>
          <h1>{titulo}</h1>
          {lanc && (
            <span className="muted">
              Competência {formatarData(lanc.competencia)} · {formatarMoeda(lanc.valorTotal)}
              {lanc.recorrencia !== 'nenhuma' && lanc.recorrenciaOrdem ? ` · repetição ${lanc.recorrenciaOrdem} de ${lanc.recorrenciaTotal}` : ''}
            </span>
          )}
        </div>
        {lanc?.status === 'cancelado' && <span className="selo selo-neutro">Cancelado</span>}
      </div>
      {erroGeral && <div className="alerta alerta-erro" role="alert">{erroGeral}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {!cadastros || (!novo && !lanc) ? (
        !erroGeral && <p className="muted">Carregando…</p>
      ) : lanc?.status === 'cancelado' ? (
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>Este lançamento foi cancelado e não entra no caixa nem nos relatórios. Fica no histórico para consulta.</p>
          <ul className="lista-alertas">
            {lanc.apropriacoes.map((a) => (
              <li key={a.id}>
                <span>
                  {a.planoCodigo} {a.planoNome}
                  {a.veiculoCodigo ? ` · ${a.veiculoCodigo}` : ''}
                </span>
                <span className="mono">{formatarMoeda(a.valor)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {lanc?.notaId ? (
            <div className="card">
              <div className="alerta alerta-info" style={{ marginTop: 0 }}>
                Este lançamento veio de uma nota fiscal. Categorias, valores e vencimentos se alteram pela nota.{' '}
                <Link to={`/fin/notas/${lanc.notaId}`} style={{ fontWeight: 600 }}>Ver a nota</Link>
              </div>
              <ul className="lista-alertas">
                {lanc.apropriacoes.map((a) => (
                  <li key={a.id}>
                    <span style={{ minWidth: 0 }}>
                      {a.planoCodigo} {a.planoNome}
                      <div className="small muted">
                        {[a.descricao, a.centroNome, a.veiculoCodigo].filter(Boolean).join(' · ')}
                      </div>
                    </span>
                    <span className="mono">{formatarMoeda(a.valor)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
          <FormLancamento
            key={`${id}-${versao}`}
            tipo={tipo}
            inicial={lanc ?? undefined}
            cadastros={cadastros}
            aoSalvar={(l, criados) => {
              if (novo) {
                navegar(`/fin/lancamentos/${l.id}`, {
                  replace: true,
                  state: { aviso: criados && criados > 1 ? `${criados} lançamentos criados (um por repetição).` : `${l.tipo === 'despesa' ? 'Despesa' : 'Receita'} lançada.` },
                });
              } else {
                setLanc(l);
                setVersao((v) => v + 1);
                setAviso('Alterações salvas.');
                window.scrollTo({ top: 0 });
              }
            }}
          />
          )}

          {lanc && (
            <div className="card tabela-caixa">
              <h2>{lanc.tipo === 'despesa' ? 'Pagamentos' : 'Recebimentos'}</h2>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Parcela</th>
                    <th>Vencimento</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th>Situação</th>
                    <th>Baixa</th>
                    <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {abertas.map((p) => (
                    <Fragment key={p.id}>
                      <tr>
                        <td className="mono small">{p.numero}/{abertas.length}</td>
                        <td className="mono small">{formatarData(p.vencimento)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(p.valor)}</td>
                        <td>
                          <span className={`selo ${SELO_PARCELA[p.situacao].classe}`}>{SELO_PARCELA[p.situacao].texto}</span>
                        </td>
                        <td className="small">
                          {p.status === 'paga'
                            ? `${formatarData(p.dataPagamento)} · ${p.contaNome ?? ''} · ${formatarMoeda(p.valorPago)}${p.forma ? ` · ${NOMES_FORMA[p.forma]}` : ''}`
                            : '—'}
                        </td>
                        <td>
                          {p.status === 'aberta' ? (
                            <button className="btn btn-link" type="button" onClick={() => setBaixando(baixando === p.id ? null : p.id)}>
                              {baixando === p.id ? 'Fechar' : lanc.tipo === 'despesa' ? 'Pagar' : 'Receber'}
                            </button>
                          ) : (
                            <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => estornar(p)}>
                              Estornar
                            </button>
                          )}
                        </td>
                      </tr>
                      {baixando === p.id && (
                        <tr className="linha-form">
                          <td colSpan={6}>
                            <FormBaixa
                              parcela={p}
                              tipo={lanc.tipo}
                              contas={cadastros.contas}
                              aoCancelar={() => setBaixando(null)}
                              aoConcluir={() => {
                                setBaixando(null);
                                setAviso(`Parcela ${p.numero} ${lanc.tipo === 'despesa' ? 'paga' : 'recebida'}.`);
                                carregar();
                                recarregar();
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {lanc && !lanc.notaId && !cancelar && (
            <div className="acoes">
              <button className="btn btn-secundario" type="button" onClick={() => setCancelar(true)}>
                Cancelar lançamento
              </button>
            </div>
          )}
          {lanc && cancelar && (
            <div className="card">
              <h2>Cancelar este lançamento?</h2>
              <p className="muted">
                Ele sai do caixa e dos relatórios, mas fica no histórico. {abertas.some((p) => p.status === 'paga') ? 'Antes, estorne as parcelas já pagas.' : ''}
              </p>
              <div className="acoes">
                <button className="btn btn-perigo" type="button" disabled={ocupado} onClick={() => confirmarCancelamento(false)}>
                  Cancelar só este
                </button>
                {lanc.recorrencia !== 'nenhuma' && (
                  <button className="btn btn-perigo" type="button" disabled={ocupado} onClick={() => confirmarCancelamento(true)}>
                    Cancelar este e as próximas repetições
                  </button>
                )}
                <button className="btn btn-secundario" type="button" onClick={() => setCancelar(false)}>
                  Voltar
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
