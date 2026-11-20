/** Uma dependência do serviço (banco, broker): resolve se está respondendo, lança se não está. */
export type Verificacao = () => Promise<unknown> | unknown;

export interface Saude {
  status: 'ok' | 'falha';
  verificacoes: Record<string, string>;
}

const comLimite = <T>(promessa: Promise<T>, ms: number) =>
  Promise.race([
    promessa,
    new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error(`sem resposta em ${ms} ms`)), ms).unref()),
  ]);

/** Roda todas as verificações em paralelo, cada uma com tempo limite, para o /health nunca travar. */
export async function verificarSaude(verificacoes: Record<string, Verificacao>, limiteMs = 2000): Promise<Saude> {
  const nomes = Object.keys(verificacoes);
  const resultados = await Promise.allSettled(
    nomes.map((nome) => comLimite(Promise.resolve().then(() => verificacoes[nome]?.()), limiteMs)),
  );
  const detalhes: Record<string, string> = {};
  resultados.forEach((resultado, i) => {
    detalhes[nomes[i] as string] =
      resultado.status === 'fulfilled' ? 'ok' : String((resultado.reason as Error)?.message ?? resultado.reason);
  });
  return { status: resultados.every((r) => r.status === 'fulfilled') ? 'ok' : 'falha', verificacoes: detalhes };
}

interface Resposta {
  status(codigo: number): { send(corpo: unknown): unknown };
}

/** Handler do GET /health: 200 com tudo respondendo, 503 se alguma dependência falhar. */
export function rotaSaude(verificacoes: Record<string, Verificacao>) {
  return async (_requisicao: unknown, resposta: Resposta) => {
    const saude = await verificarSaude(verificacoes);
    return resposta.status(saude.status === 'ok' ? 200 : 503).send(saude);
  };
}
