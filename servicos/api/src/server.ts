import 'dotenv/config';
import {
  ClienteRpc,
  encerrarAoReceberSinal,
  EVENTOS_RECOMENDACAO,
  FILAS,
  PublicadorEventos,
  TransporteAmqp,
  type Verificacao,
} from '@cinebridge/comum';
import { adaptadoresDoAmbiente } from './adaptadores/doAmbiente';
import { criarSistema, type Dependencias } from './composicao';
import { profissionaisIniciais } from './dados/profissionais';
import { pilhaDoTexto } from './decoradores/PoliticaDecoradores';
import { construirApp } from './http/app';
import { BarramentoRabbitMQ } from './observadores/BarramentoRabbitMQ';
import { ArquivoPostgres } from './persistencia/ArquivoPostgres';
import { criarPrisma } from './persistencia/prisma';
import { ProjetosViaFila } from './projetos/Projetos';
import { RepositorioProfissionaisMemoria } from './repositorio/RepositorioProfissionais';

const env = process.env;
const verificacoes: Record<string, Verificacao> = {};
const encerrar: (() => Promise<unknown>)[] = [];
const dependencias: Dependencias = {
  decoradores: pilhaDoTexto(env.DECORADORES ?? 'auditoria,cache,compressao'),
  nivelCompressao: Number(env.NIVEL_COMPRESSAO ?? 6),
};

// Com o broker: profissionais e projetos pelas filas RPC, eventos para o serviço de notificações.
// Sem ele, a api roda sozinha, como na AV3 (útil para desenvolver e para os testes).
let rpc: ClienteRpc | undefined;
if (env.RABBITMQ_URL) {
  const transporte = await TransporteAmqp.conectar({ url: env.RABBITMQ_URL });
  rpc = await new ClienteRpc(transporte, Number(env.RPC_TEMPO_LIMITE_MS ?? 5000)).iniciar();
  const eventos = await new PublicadorEventos(transporte, FILAS.eventosRecomendacao, 'cinebridge-api').iniciar();
  dependencias.barramento = new BarramentoRabbitMQ(eventos);
  dependencias.projetos = new ProjetosViaFila(rpc);
  dependencias.enviarEmail = (email) =>
    void eventos.publicar(EVENTOS_RECOMENDACAO.conviteEnviado, email).catch((erro: unknown) => console.error(erro));
  verificacoes.rabbitmq = () => {
    if (!transporte.conectado()) throw new Error('desconectado');
  };
  encerrar.push(() => transporte.fechar());
} else {
  console.warn('RABBITMQ_URL não definida: api rodando sozinha, com profissionais e projetos em memória.');
}

if (env.DATABASE_URL) {
  const prisma = criarPrisma(env.DATABASE_URL);
  const arquivo = new ArquivoPostgres(prisma);
  dependencias.arquivo = arquivo;
  verificacoes.banco = () => arquivo.verificar();
  encerrar.push(() => prisma.$disconnect());
}

const repositorio = new RepositorioProfissionaisMemoria(profissionaisIniciais());
const { sistema, fluxo } = criarSistema({
  ...dependencias,
  repositorio,
  adaptadores: adaptadoresDoAmbiente({ repositorio, rpc }, env),
});
const app = construirApp({ sistema, fluxo, verificacoes }, { logger: true });

await app.listen({ host: '0.0.0.0', port: Number(env.PORT ?? 3000) });
encerrarAoReceberSinal(() => app.close(), ...encerrar);
