// Botão "Preencher pela foto ou PDF": a IA lê o documento e devolve os campos para o formulário.
// Nada é salvo aqui: o usuário confere os campos e salva pelo próprio formulário.
import { useEffect, useState, type ChangeEvent } from 'react';
import { api } from '../api';

export type EntidadeLeitura = 'fornecedor' | 'credor' | 'cliente' | 'colaborador';
export type DadosLidos = Record<string, string | number | null>;

const LIMITE = 10 * 1024 * 1024;

export function arquivoParaBase64(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => resolver(String(leitor.result).split(',')[1] ?? '');
    leitor.onerror = () => rejeitar(new Error('Não consegui abrir o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

/** Leitura de cadastro (entidade) ou de lançamento (tipoLancamento). Os dados só entram no formulário; nada é salvo aqui. */
export function LeituraIa({ entidade, tipoLancamento, aoLer }: { entidade?: EntidadeLeitura; tipoLancamento?: 'receita' | 'despesa'; aoLer: (dados: DadosLidos) => void }) {
  const caminho = tipoLancamento ? '/fin/lancamentos/leitura' : '/adm/cadastros/leitura';
  const extra = tipoLancamento ? { tipoLancamento } : { entidade };
  const [disponivel, setDisponivel] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [duvidas, setDuvidas] = useState<string[]>([]);

  useEffect(() => {
    api<{ ia: boolean }>(caminho)
      .then((r) => setDisponivel(r.ia))
      .catch(() => setDisponivel(false));
  }, [caminho]);

  if (!disponivel) return null;

  async function aoEscolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setErro('');
    setDuvidas([]);
    if (arquivo.size > LIMITE) return setErro('Arquivo grande demais (máximo 10 MB).');
    setOcupado(true);
    try {
      const base = await arquivoParaBase64(arquivo);
      const r = await api<{ dados: DadosLidos; duvidas: string[] }>(caminho, { corpo: { arquivo: base, tipo: arquivo.type, ...extra } });
      aoLer(r.dados);
      setDuvidas(r.duvidas);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="nao-imprimir" style={{ marginBottom: 12 }}>
      <label className="btn btn-secundario" style={{ cursor: ocupado ? 'wait' : 'pointer' }}>
        {ocupado ? 'Lendo o documento…' : 'Preencher pela foto ou PDF'}
        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={aoEscolher} disabled={ocupado} hidden />
      </label>
      <span className="small muted" style={{ marginLeft: 10 }}>Os dados lidos entram no formulário para você conferir antes de salvar.</span>
      {erro && <div className="alerta alerta-erro" role="alert" style={{ marginTop: 8 }}>{erro}</div>}
      {duvidas.length > 0 && (
        <div className="alerta" role="status" style={{ marginTop: 8 }}>
          Não consegui ler com segurança: {duvidas.join('; ')}. Confira e preencha esses campos.
        </div>
      )}
    </div>
  );
}
