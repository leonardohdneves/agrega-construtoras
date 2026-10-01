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
