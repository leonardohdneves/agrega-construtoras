// Leitura da chave de acesso pelo código de barras do DANFE: leitor USB (digita a chave e Enter),
// câmera do celular ou foto da nota.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { chavePlausivel, partesDaChave } from '../code128';
import { chaveDaImagem, chaveDoArquivoDeImagem } from '../leitorBarras';

export function LeitorCodigo({ aoLer, aoFechar, ocupado }: { aoLer: (chave: string) => void; aoFechar: () => void; ocupado?: boolean }) {
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

  function usar(chave: string) {
    if (lido.current) return;
    lido.current = true;
    setCamera(false);
    setTexto(chave);
    aoLer(chave);
    setTimeout(() => {
      lido.current = false;
    }, 1500);
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (digitos.length !== 44) return setErro(`A chave tem 44 números; ${digitos.length === 1 ? 'veio 1' : `vieram ${digitos.length}`}.`);
    if (!chavePlausivel(digitos)) return setErro('Chave inválida: confira os números (o último é o dígito verificador).');
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
            usar(c);
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
    if (c) usar(c);
    else setErro('Não achei o código de barras na foto. Tire outra mais de perto, com o código reto e bem iluminado, ou digite a chave.');
  }

  return (
    <div className="card leitor-codigo">
      <div className="cabecalho" style={{ marginBottom: 8 }}>
        <h2>Ler o código de barras da nota</h2>
        <button className="btn btn-link" type="button" onClick={aoFechar}>Fechar</button>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        O código de barras do DANFE traz a chave de acesso: o Agrega cria o rascunho com fornecedor, número e série e impede lançar a mesma nota duas vezes.
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
            placeholder="Passe o leitor USB no código de barras ou digite os 44 números"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          {partes ? (
            <span className="small">
              {partes.modelo === '65' ? 'NFC-e' : 'NF-e'} {partes.numero} · série {partes.serie} · emitida em {partes.anoMes.slice(5)}/{partes.anoMes.slice(0, 4)} · CNPJ do emitente {partes.documento.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}
            </span>
          ) : (
            <span className="ajuda">Com o leitor USB, clique no campo e passe o leitor: ele digita a chave e confirma sozinho.</span>
          )}
        </div>
        {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={ocupado || !digitos}>Criar rascunho</button>
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
