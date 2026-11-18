// Cliente HTTP da API do Agrega. Cada sessão MCP tem o seu, com o token de sessão do usuário que autorizou.
// As ferramentas só falam com a API por aqui; nunca montam chamadas HTTP por conta própria.

/** Erro devolvido pela API: `{ erro, campos? }` com o status HTTP. */
export class ErroDaApi extends Error {
  statusCode: number;
  campos: { campo: string; mensagem: string }[] | undefined;

  constructor(mensagem: string, statusCode: number, campos?: { campo: string; mensagem: string }[]) {
    super(mensagem);
    this.name = 'ErroDaApi';
    this.statusCode = statusCode;
    this.campos = campos;
  }
}

type Consulta = Record<string, string | number | boolean | null | undefined>;

export class ClienteApi {
  private baseUrl: string;
  private token: string | undefined;

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  getToken(): string | undefined {
    return this.token;
  }

  isAuthenticated(): boolean {
    return !!this.token;
  }

  private async pedir<T>(metodo: string, caminho: string, opcoes: { consulta?: Consulta; corpo?: unknown } = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/api${caminho}`);
    for (const [chave, valor] of Object.entries(opcoes.consulta ?? {})) {
      if (valor !== undefined && valor !== null && valor !== '') url.searchParams.set(chave, String(valor));
    }
    let resposta: Response;
    try {
      resposta = await fetch(url, {
        method: metodo,
        headers: {
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(opcoes.corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      throw new ErroDaApi(`A API do Agrega não respondeu (${(e as Error).message}).`, 503);
    }
    const dados = (await resposta.json().catch(() => ({}))) as { erro?: string; campos?: { campo: string; mensagem: string }[] };
    if (!resposta.ok) throw new ErroDaApi(dados?.erro ?? `Erro ${resposta.status} na API do Agrega.`, resposta.status, dados?.campos);
    return dados as T;
  }

  get<T = any>(caminho: string, consulta?: Consulta): Promise<T> {
    return this.pedir<T>('GET', caminho, { consulta });
  }

  post<T = any>(caminho: string, corpo?: unknown): Promise<T> {
    return this.pedir<T>('POST', caminho, { corpo: corpo ?? {} });
  }

  put<T = any>(caminho: string, corpo?: unknown): Promise<T> {
    return this.pedir<T>('PUT', caminho, { corpo: corpo ?? {} });
  }

  patch<T = any>(caminho: string, corpo?: unknown): Promise<T> {
    return this.pedir<T>('PATCH', caminho, { corpo: corpo ?? {} });
  }

  delete<T = any>(caminho: string): Promise<T> {
    return this.pedir<T>('DELETE', caminho);
  }
}
