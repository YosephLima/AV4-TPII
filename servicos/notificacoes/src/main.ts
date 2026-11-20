import 'dotenv/config';
import { encerrarAoReceberSinal, exigirVariavel, TransporteAmqp } from '@cinebridge/comum';
import { construirApp } from './app';
import { CaixaPostgres } from './CaixaPostgres';
import { iniciarConsumidores } from './consumidores';
import { criarPrisma } from './prisma';

const prisma = criarPrisma(exigirVariavel('DATABASE_URL'));
const caixa = new CaixaPostgres(prisma);
const transporte = await TransporteAmqp.conectar({ url: exigirVariavel('RABBITMQ_URL') });
await iniciarConsumidores(transporte, caixa);

const app = construirApp(
  caixa,
  {
    banco: () => caixa.verificar(),
    rabbitmq: () => {
      if (!transporte.conectado()) throw new Error('desconectado');
    },
  },
  { logger: true },
);
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3003) });

encerrarAoReceberSinal(
  () => app.close(),
  () => transporte.fechar(),
  () => prisma.$disconnect(),
);
