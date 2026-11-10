import { useEffect, useRef, useState, type PointerEvent } from 'react';

// Área de assinatura na tela (dedo ou caneta). Sai como PNG com fundo branco, em tamanho fixo.
const LARGURA = 600;
const ALTURA = 200;

export function AssinaturaPad({ rotulo = 'Confirmar assinatura', aoConfirmar }: { rotulo?: string; aoConfirmar: (imagem: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [temTraco, setTemTraco] = useState(false);
  const [erro, setErro] = useState('');

  function fundoBranco() {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, LARGURA, ALTURA);
    ctx.strokeStyle = '#1f2328';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  useEffect(() => {
    fundoBranco();
    // No iPhone, o arraste sobre o canvas rola a página, e o desenho some. Bloqueia o toque no próprio canvas.
    const c = canvas.current!;
    const bloquear = (e: TouchEvent) => e.preventDefault();
    c.addEventListener('touchstart', bloquear, { passive: false });
    c.addEventListener('touchmove', bloquear, { passive: false });
    return () => {
      c.removeEventListener('touchstart', bloquear);
      c.removeEventListener('touchmove', bloquear);
    };
  }, []);

  function posicao(e: PointerEvent<HTMLCanvasElement>) {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * LARGURA) / r.width, y: ((e.clientY - r.top) * ALTURA) / r.height };
  }

  function iniciar(e: PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvas.current?.setPointerCapture(e.pointerId);
    desenhando.current = true;
    ultimo.current = posicao(e);
    setErro('');
  }

  function mover(e: PointerEvent<HTMLCanvasElement>) {
    if (!desenhando.current || !ultimo.current) return;
    const ctx = canvas.current!.getContext('2d')!;
    const p = posicao(e);
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo.current = p;
    setTemTraco(true);
  }

  function terminar() {
    desenhando.current = false;
    ultimo.current = null;
  }

  function limpar() {
    fundoBranco();
    setTemTraco(false);
    setErro('');
  }

  function confirmar() {
    if (!temTraco) {
      setErro('Assine na área acima antes de confirmar.');
      return;
    }
    aoConfirmar(canvas.current!.toDataURL('image/png'));
  }

  return (
    <div className="assinatura-pad">
      <canvas
        ref={canvas}
        width={LARGURA}
        height={ALTURA}
        aria-label="Área para assinar"
        onPointerDown={iniciar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerLeave={terminar}
        onPointerCancel={terminar}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="acoes" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button className="btn btn-primario" type="button" onClick={confirmar}>
          {rotulo}
        </button>
        <button className="btn btn-secundario" type="button" onClick={limpar}>
          Limpar
        </button>
      </div>
    </div>
  );
}
