/** Reduz a foto no navegador (lado maior de 1600 px, JPEG 80%) para caber no envio e no banco. */
export async function comprimirImagem(arquivo: File): Promise<{ imagem: string; tipo: 'image/jpeg' }> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Não foi possível abrir uma das fotos. Use JPEG ou PNG.'));
      i.src = url;
    });
    const escala = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * escala);
    canvas.height = Math.round(img.naturalHeight * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Este navegador não consegue processar a foto.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao reduzir a foto.'))), 'image/jpeg', 0.8),
    );
    const imagem = await new Promise<string>((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(String(leitor.result).split(',')[1] ?? '');
      leitor.onerror = () => reject(new Error('Falha ao ler a foto.'));
      leitor.readAsDataURL(blob);
    });
    return { imagem, tipo: 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}
