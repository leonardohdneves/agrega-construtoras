export class ErroHttp extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

export const naoAutenticado = () => new ErroHttp(401, 'Entre no sistema para continuar.');
export const semPermissao = () => new ErroHttp(403, 'Seu perfil não tem permissão para esta ação.');
export const naoEncontrado = (o = 'Registro') => new ErroHttp(404, `${o} não encontrado.`);
