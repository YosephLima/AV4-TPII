import 'dotenv/config';
import { encerrarAoReceberSinal, exigirVariavel, TransporteAmqp } from '@cinebridge/comum';
import { construirApp } from './app';
import { CadastroPostgres } from './CadastroPostgres';
import { servidorConsultas } from './consultas';
import { criarPrisma } from './prisma';

const prisma = criarPrisma(exigirVariavel('DATABASE_URL'));
const cadastro = new CadastroPostgres(prisma);
const transporte = await TransporteAmqp.conectar({ url: exigirVariavel('RABBITMQ_URL') });
await servidorConsultas(transporte, cadastro).iniciar();

const app = construirApp(
  cadastro,
  {
    banco: () => cadastro.verificar(),
    rabbitmq: () => {
      if (!transporte.conectado()) throw new Error('desconectado');
    },
  },
  { logger: true },
);
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3001) });

encerrarAoReceberSinal(
  () => app.close(),
  () => transporte.fechar(),
  () => prisma.$disconnect(),
);
