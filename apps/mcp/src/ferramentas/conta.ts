import { z } from 'zod';
import { colecao, ferramenta } from './tipos.ts';

export const ferramentasConta = colecao(
  ferramenta({
    name: 'usuario_atual',
    description:
      'Devolve o usuário que autorizou esta conexão (nome, e-mail, perfil e módulos liberados) e a construtora dele (razão social, CNPJ, cidade). Use para saber em nome de quem as outras ferramentas agem e quais módulos estão disponíveis: uma ferramenta de um módulo que o usuário não tem responde 403.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/auth/eu') }),
  }),
);
