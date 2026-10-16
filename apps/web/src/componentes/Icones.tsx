// Ícones de traço (2px, grade de 24px), na cor do texto.
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const IconeInicio = () => (<svg {...base}><path d="M3 11l9-7 9 7v9H3z" /></svg>);
export const IconeEmpresa = () => (<svg {...base}><path d="M3 21V7l7-4v18" /><path d="M10 21h11V11l-11-4" /><path d="M14 13h3M14 17h3" /></svg>);
export const IconeUsuarios = () => (<svg {...base}><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6" /><path d="M16 4a4 4 0 010 8M22 21c0-3-1.5-5-4-5.7" /></svg>);
export const IconeConta = () => (<svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5" /></svg>);
export const IconeCaminhao = () => (<svg {...base}><rect x="2" y="7" width="13" height="9" rx="1" /><path d="M15 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></svg>);
export const IconeDinheiro = () => (<svg {...base}><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20M6 15h4" /></svg>);
export const IconeGrafico = () => (<svg {...base}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>);
export const IconeSair = () => (<svg {...base}><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11" /></svg>);
export const IconeBomba = () => (<svg {...base}><path d="M4 21V5a2 2 0 012-2h6a2 2 0 012 2v16" /><path d="M3 21h12" /><path d="M14 9h2a2 2 0 012 2v5a1.5 1.5 0 003 0V8l-3-3" /><path d="M7 8h4" /></svg>);
export const IconeEngrenagem = () => (<svg {...base}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>);
export const IconePasta = () => (<svg {...base}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>);
export const IconeMenu = () => (<svg {...base}><path d="M4 6h16M4 12h16M4 18h16" /></svg>);
export const IconeBetoneira = () => (<svg {...base}><path d="M2 16V9h5l2 3h3" /><path d="M12 15l9-5-1-3-8 3z" /><path d="M2 16h19" /><circle cx="6" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></svg>);
export const IconeCapacete = () => (<svg {...base}><path d="M3 15a9 9 0 0 1 18 0" /><path d="M2 15h20v2.5H2z" /><path d="M12 6v9" /></svg>);
export const IconeFrasco = () => (<svg {...base}><path d="M9 3h6" /><path d="M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3" /><path d="M7.5 15h9" /></svg>);
export const IconeCarrinho = () => (<svg {...base}><path d="M3 4h2l2.4 11h11.2L21 8H6.2" /><circle cx="9" cy="19" r="1.6" /><circle cx="17" cy="19" r="1.6" /></svg>);
export const IconeEdificio = () => (<svg {...base}><rect x="4" y="2" width="16" height="20" rx="1" /><path d="M9 22v-4h6v4" /><path d="M8 6h2M14 6h2M8 10h2M14 10h2M8 14h2M14 14h2" /></svg>);
export const IconeVenda = () => (<svg {...base}><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>);
