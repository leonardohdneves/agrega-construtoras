// Leitura da chave de acesso pelo código de barras do DANFE: leitor USB (digita a chave e Enter),
// câmera do celular ou foto da nota.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { chaveAceita, chaveDoTexto, partesDaChave, partesDaChaveNfse } from '../code128';
import { chaveDaImagem, chaveDoArquivoDeImagem, imagemParaJpeg } from '../leitorBarras';

export function LeitorCodigo({ aoLer, aoFechar, ocupado }: { aoLer: (chave: string, imagem?: Blob | null) => void; aoFechar: () => void; ocupado?: boolean }) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [camera, setCamera] = useState(false);
  const [situacao, setSituacao] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const tela = useRef<HTMLCanvasElement>(null);
  const foto = useRef<HTMLInputElement>(null);
  const lido = useRef(false);

  const digitos = texto.replace(/\D/g, '');
  const partes = digitos.length === 44 ? partesDaChave(digitos) : null;
  const partesNfse = digitos.length === 50 ? partesDaChaveNfse(digitos) : null;

  async function colar() {
    setErro('');
    try {
      const t = await navigator.clipboard.readText();
      const c = chaveDoTexto(t);
      if (c) {
        setTexto(c);
        return;
      }
      setTexto(t.trim());
      setErro('O texto colado não tem uma chave de acesso válida (44 números da NF-e ou 50 da NFS-e nacional).');
    } catch {
      setErro('O navegador não deixou ler a área de transferência. Toque no campo e use "Colar" do teclado.');
    }
  }

  function usar(chave: string, imagem?: Blob | null) {
    if (lido.current) return;
    lido.current = true;
    setCamera(false);
    setTexto(chave);
    aoLer(chave, imagem);
    setTimeout(() => {
      lido.current = false;
    }, 1500);
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (digitos.length !== 44 && digitos.length !== 50) return setErro(`A chave tem 44 números (NF-e) ou 50 (NFS-e nacional); ${digitos.length === 1 ? 'veio 1' : `vieram ${digitos.length}`}.`);
    if (!chaveAceita(digitos)) return setErro('Chave inválida: confira os números (o último é o dígito verificador).');
    usar(digitos);
  }

  // Câmera: lê quadros até achar uma chave válida.
  useEffect(() => {
    if (!camera) return;
    let parar = false;
    let fluxo: MediaStream | null = null;
    (async () => {
      setErro('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setErro('Este navegador não dá acesso à câmera. Use o leitor USB, digite a chave ou envie uma foto.');
        setCamera(false);
        return;
      }
      try {
        fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      } catch {
        setErro('Não consegui abrir a câmera. Confira a permissão do navegador para usar a câmera.');
        setCamera(false);
        return;
      }
      const v = video.current;
      if (!v || parar) return;
      v.srcObject = fluxo;
      await v.play().catch(() => {});
      setSituacao('Aponte para o código de barras da nota, na horizontal, ocupando boa parte da tela.');
      while (!parar) {
        if (v.videoWidth) {
          const c = await chaveDaImagem(v, v.videoWidth, v.videoHeight, tela.current ?? undefined);
          if (c && !parar) {
            // A imagem da câmera vai junto para a IA ler o resto da nota.
            usar(c, await imagemParaJpeg(v));
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    })();
    return () => {
      parar = true;
      fluxo?.getTracks().forEach((t) => t.stop());
    };
  }, [camera]);

  async function lerFoto(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro('');
    setSituacao('Procurando o código de barras na foto…');
    const c = await chaveDoArquivoDeImagem(arquivo);
    setSituacao('');
    if (foto.current) foto.current.value = '';
    if (c) usar(c, await imagemParaJpeg(arquivo));
    else setErro('Não achei o código de barras na foto. Tire outra mais de perto, com o código reto e bem iluminado, ou digite a chave.');
  }

  return (
    <div className="card leitor-codigo">
      <div className="cabecalho" style={{ marginBottom: 8 }}>
        <h2>Chave de acesso da nota</h2>
        <button className="btn btn-link" type="button" onClick={aoFechar}>Fechar</button>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        Leia o código de barras do DANFE (ou o QR code da NFS-e), cole ou digite a chave. O Agrega cria o rascunho com fornecedor, número e série e impede lançar a mesma nota duas vezes. Depois, envie o PDF ou uma foto da nota para completar valor e itens.
      </p>
      <form className="form" onSubmit={enviar}>
        <div className="campo">
          <label htmlFor="lc-chave">Chave de acesso</label>
          <input
            id="lc-chave"
            className="mono"
            inputMode="numeric"
            autoFocus
            autoComplete="off"
            placeholder="Passe o leitor USB, cole ou digite a chave (44 ou 50 números)"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          {partes ? (
            <span className="small">
              {partes.modelo === '65' ? 'NFC-e' : 'NF-e'} {partes.numero} · série {partes.serie} · emitida em {partes.anoMes.slice(5)}/{partes.anoMes.slice(0, 4)} · CNPJ do emitente {partes.documento.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}
            </span>
          ) : partesNfse ? (
            <span className="small">
              NFS-e {partesNfse.numero} · emitida em {partesNfse.anoMes.slice(5)}/{partesNfse.anoMes.slice(0, 4)} · {partesNfse.documento.length === 14 ? 'CNPJ' : 'CPF'} do prestador {partesNfse.documento}
            </span>
          ) : (
            <span className="ajuda">Com o leitor USB, clique no campo e passe o leitor: ele digita a chave e confirma sozinho.</span>
          )}
        </div>
        {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={ocupado || !digitos}>Criar rascunho</button>
          <button className="btn btn-secundario" type="button" onClick={colar}>Colar chave</button>
          <button className="btn btn-secundario" type="button" onClick={() => setCamera(!camera)}>{camera ? 'Parar a câmera' : 'Usar a câmera'}</button>
          <input ref={foto} type="file" accept="image/*" capture="environment" hidden onChange={(e) => lerFoto(e.target.files?.[0])} />
          <button className="btn btn-secundario" type="button" onClick={() => foto.current?.click()}>Ler de uma foto</button>
        </div>
      </form>
      {camera && (
        <div className="camera-codigo">
          <video ref={video} playsInline muted aria-label="Imagem da câmera" />
          <span className="mira" aria-hidden="true" />
        </div>
      )}
      <canvas ref={tela} hidden />
      {situacao && (camera || situacao.startsWith('Procurando')) && <p className="small muted" role="status">{situacao}</p>}
    </div>
  );
}
