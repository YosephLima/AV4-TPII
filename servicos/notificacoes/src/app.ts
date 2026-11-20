import { rotaSaude, type Verificacao } from '@cinebridge/comum';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Caixa, FiltroNotificacoes } from './Caixa';

export function construirApp(caixa: Caixa, verificacoes: Record<string, Verificacao>, opcoes: FastifyServerOptions = {}) {
  const app = Fastify(opcoes);

  app.get('/health', rotaSaude(verificacoes));

  /** O que já foi enviado, para conferência. */
  app.get<{ Querystring: FiltroNotificacoes }>(
    '/notificacoes',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            destinatario: { type: 'string' },
            projetoId: { type: 'string' },
            canal: { enum: ['email', 'interna'] },
            limite: { type: 'integer', minimum: 1, maximum: 500 },
          },
        },
      },
    },
    async (requisicao) => caixa.listar(requisicao.query),
  );

  return app;
}
