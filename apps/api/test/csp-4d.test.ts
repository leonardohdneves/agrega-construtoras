// Política de segurança: /4d/ (ferramentas 3D/IFC) recebe o WebAssembly; o resto do sistema não.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CSP, CSP_4D, cabecalhosSeguranca } from '../src/lib/endurecimento.ts';

async function cabecalhoPara(url: string) {
  const cabecalhos: Record<string, string> = {};
  const reply = { header: (k: string, v: string) => { cabecalhos[k] = v; } };
  await cabecalhosSeguranca(false)({ url } as never, reply as never, null);
  return cabecalhos['Content-Security-Policy'];
}

test('/4d/ aceita WebAssembly, sem liberar script inline nem origens externas', async () => {
  assert.equal(await cabecalhoPara('/4d/custo5d.html'), CSP_4D);
  // só a regra de scripts muda: WebAssembly, sem 'unsafe-inline', sem 'unsafe-eval' e sem origem externa
  const scripts = CSP_4D.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'))!;
  assert.equal(scripts, "script-src 'self' 'wasm-unsafe-eval'");
  assert.doesNotMatch(scripts, /unsafe-inline|'unsafe-eval'|http/);
});

test('o resto do sistema segue com a política padrão', async () => {
  assert.equal(await cabecalhoPara('/eng/eap'), CSP);
  assert.equal(await cabecalhoPara('/api/eng/obras'), CSP);
  assert.match(CSP, /script-src 'self'(;|$)/);
});
