// Números de página do sumário do laudo, para a impressão. O Chrome e o Edge não têm target-counter, então a página de
// cada seção é calculada antes de imprimir: o bloco do laudo é copiado para fora da tela, com a largura da folha
// (170 mm: A4 menos as margens laterais de 20 mm; o recuo de 10 mm do texto fica dentro dessa largura), e a posição de
// cada título é convertida em página.
// Cada folha tem 251 mm úteis (A4 de 297 mm menos 22 mm no alto e 24 mm embaixo). Capa e sumário ocupam as páginas 1 e 2,
// então a primeira seção começa na página 3. O cálculo depende de o espaçamento vertical ser padding (ver estilos.css).

const LARGURA_IMPRESSA_MM = 170;
const ALTURA_UTIL_MM = 251;
const PRIMEIRA_PAGINA_SECOES = 3;

/** Página de cada título de seção (h2.laudo-secao), na ordem em que aparecem no bloco. */
export function paginasDasSecoes(bloco: HTMLElement): number[] {
  const medida = document.createElement('div');
  medida.setAttribute('aria-hidden', 'true');
  medida.style.cssText = `position:absolute;left:-10000px;top:0;width:${LARGURA_IMPRESSA_MM}mm;visibility:hidden`;
  const copia = bloco.cloneNode(true) as HTMLElement;
  copia.classList.remove('so-imprimir');
  copia.style.display = 'block';
  medida.appendChild(copia);
  document.body.appendChild(medida);
  try {
    // Cada seção é um bloco (.laudo-bloco) com o título e o primeiro trecho do texto. O bloco não pode ser partido na
    // impressão (break-inside: avoid), então ele inteiro muda de folha quando não cabe, e o espaço que sobra no fim da
    // folha anterior entra no deslocamento das seções seguintes.
    const blocos = Array.from(copia.querySelectorAll<HTMLElement>('.laudo-bloco'));
    if (!blocos.length) return [];
    const pxPorMm = medida.getBoundingClientRect().width / LARGURA_IMPRESSA_MM;
    const folha = ALTURA_UTIL_MM * pxPorMm;
    const base = blocos[0].getBoundingClientRect().top;
    let deslocamento = 0;
    return blocos.map((bloco) => {
      const r = bloco.getBoundingClientRect();
      const y = r.top - base + deslocamento;
      let pagina = Math.floor(y / folha);
      const fimDaFolha = (pagina + 1) * folha;
      if (y + r.height > fimDaFolha) {
        deslocamento += fimDaFolha - y;
        pagina += 1;
      }
      return PRIMEIRA_PAGINA_SECOES + pagina;
    });
  } finally {
    medida.remove();
  }
}

/** Escreve o número de página em cada item do sumário (span com data-secao="índice da seção"). */
export function marcarPaginasDoSumario(bloco: HTMLElement): void {
  const paginas = paginasDasSecoes(bloco);
  bloco.querySelectorAll<HTMLElement>('[data-secao]').forEach((el) => {
    const pagina = paginas[Number(el.dataset.secao)];
    el.textContent = pagina ? String(pagina) : '';
  });
}
