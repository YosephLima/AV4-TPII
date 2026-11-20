export class VariavelAusenteError extends Error {
  constructor(nome: string) {
    super(`Defina a variável de ambiente ${nome}`);
    this.name = 'VariavelAusenteError';
  }
}

export function exigirVariavel(nome: string, env: Record<string, string | undefined> = process.env): string {
  const valor = env[nome];
  if (!valor) throw new VariavelAusenteError(nome);
  return valor;
}

/**
 * Encerramento limpo no `docker compose stop` (SIGTERM) e no Ctrl+C (SIGINT): fecha HTTP, broker e banco na
 * ordem dada, para não deixar mensagens pela metade.
 */
export function encerrarAoReceberSinal(...etapas: (() => Promise<unknown>)[]): void {
  let encerrando = false;
  const encerrar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    console.log(`${sinal} recebido; encerrando`);
    for (const etapa of etapas) {
      try {
        await etapa();
      } catch (erro) {
        console.error(erro);
      }
    }
    process.exit(0);
  };
  process.once('SIGTERM', () => void encerrar('SIGTERM'));
  process.once('SIGINT', () => void encerrar('SIGINT'));
}
