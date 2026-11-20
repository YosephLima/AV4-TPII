import 'dotenv/config';
import { encerrarAoReceberSinal, exigirVariavel, FILAS, PublicadorEventos, TransporteAmqp } from '@cinebridge/comum';
import { construirApp } from './app';
import { servidorConsultas } from './consultas';
import { GestaoProjetos } from './GestaoProjetos';
import { criarPrisma } from './prisma';
import { RepositorioPostgres } from './RepositorioPostgres';

const prisma = criarPrisma(exigirVariavel('DATABASE_URL'));
const transporte = await TransporteAmqp.conectar({ url: exigirVariavel('RABBITMQ_URL') });
const eventos = await new PublicadorEventos(transporte, FILAS.eventosProjetos, 'cinebridge-projetos').iniciar();
const gestao = new GestaoProjetos(new RepositorioPostgres(prisma), (tipo, dados) => eventos.publicar(tipo, dados));
await servidorConsultas(transporte, gestao).iniciar();

const app = construirApp(
  gestao,
  {
    banco: () => gestao.verificar(),
    rabbitmq: () => {
      if (!transporte.conectado()) throw new Error('desconectado');
    },
  },
  { logger: true },
);
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3002) });

encerrarAoReceberSinal(
  () => app.close(),
  () => transporte.fechar(),
  () => prisma.$disconnect(),
);
