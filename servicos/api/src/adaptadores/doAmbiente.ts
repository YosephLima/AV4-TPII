import type { ClienteRpc } from '@cinebridge/comum';
import { GoogleCloudStorageSimulado } from '../externos/GoogleCloudStorageSimulado';
import { LinkedInSimulado } from '../externos/LinkedInSimulado';
import { PagSeguroSimulado } from '../externos/PagSeguroSimulado';
import { S3Simulado } from '../externos/S3Simulado';
import { StripeSimulado } from '../externos/StripeSimulado';
import type { RepositorioProfissionais } from '../repositorio/RepositorioProfissionais';
import type { Adaptadores } from '../SistemaRecomendacao';
import type { AdaptadorArmazenamento } from './armazenamento/AdaptadorArmazenamento';
import { AdaptadorGoogleCloud } from './armazenamento/AdaptadorGoogleCloud';
import { AdaptadorLocal } from './armazenamento/AdaptadorLocal';
import { AdaptadorS3 } from './armazenamento/AdaptadorS3';
import type { AdaptadorPagamento } from './pagamento/AdaptadorPagamento';
import { AdaptadorPagSeguro } from './pagamento/AdaptadorPagSeguro';
import { AdaptadorStripe } from './pagamento/AdaptadorStripe';
import type { AdaptadorProfissional } from './profissionais/AdaptadorProfissional';
import { AdaptadorFila } from './profissionais/AdaptadorFila';
import { AdaptadorInterno } from './profissionais/AdaptadorInterno';
import { AdaptadorLinkedIn } from './profissionais/AdaptadorLinkedIn';

type Ambiente = Record<string, string | undefined>;

export class ConfiguracaoInvalidaError extends Error {
  constructor(variavel: string, valor: string, aceitos: string[]) {
    super(`${variavel}=${valor} não é válido. Use um destes: ${aceitos.join(', ')}`);
    this.name = 'ConfiguracaoInvalidaError';
  }
}

const ARMAZENAMENTO: Record<string, (env: Ambiente) => AdaptadorArmazenamento> = {
  local: (env) => new AdaptadorLocal(env.ARMAZENAMENTO_DIR ?? 'armazenamento'),
  s3: (env) => new AdaptadorS3(new S3Simulado(), env.ARMAZENAMENTO_BUCKET ?? 'cinebridge'),
  gcs: (env) => new AdaptadorGoogleCloud(new GoogleCloudStorageSimulado(), env.ARMAZENAMENTO_BUCKET ?? 'cinebridge'),
};

const PAGAMENTO: Record<string, () => AdaptadorPagamento> = {
  stripe: () => new AdaptadorStripe(new StripeSimulado()),
  pagseguro: () => new AdaptadorPagSeguro(new PagSeguroSimulado()),
};

/** De onde vêm os profissionais: do serviço cinebridge-profissionais (pela fila), da memória ou do LinkedIn. */
export interface FontesProfissionais {
  repositorio: RepositorioProfissionais;
  /** Presente quando a api roda com o broker. */
  rpc?: ClienteRpc;
}

const PROFISSIONAIS: Record<string, (fontes: FontesProfissionais) => AdaptadorProfissional> = {
  fila: ({ rpc }) => {
    if (!rpc) throw new Error('PROFISSIONAIS=fila precisa do RabbitMQ (defina RABBITMQ_URL)');
    return new AdaptadorFila(rpc);
  },
  interno: ({ repositorio }) => new AdaptadorInterno(repositorio),
  linkedin: () => new AdaptadorLinkedIn(new LinkedInSimulado()),
};

function escolher<T>(opcoes: Record<string, T>, variavel: string, padrao: string, env: Ambiente): T {
  const valor = env[variavel] ?? padrao;
  const escolhido = opcoes[valor];
  if (!escolhido) throw new ConfiguracaoInvalidaError(variavel, valor, Object.keys(opcoes));
  return escolhido;
}

/** Escolhe cada provedor por uma variável de ambiente. Trocar de provedor não muda nenhuma outra linha. */
export function adaptadoresDoAmbiente(fontes: FontesProfissionais, env: Ambiente = process.env): Adaptadores {
  return {
    armazenamento: escolher(ARMAZENAMENTO, 'ARMAZENAMENTO', 'local', env)(env),
    pagamento: escolher(PAGAMENTO, 'PAGAMENTO', 'stripe', env)(),
    // Com o broker, o padrão é o serviço de profissionais; sem ele, o cadastro em memória.
    profissional: escolher(PROFISSIONAIS, 'PROFISSIONAIS', fontes.rpc ? 'fila' : 'interno', env)(fontes),
  };
}
