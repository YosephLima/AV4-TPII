import {
  ErroOperacao,
  PROJETO_NAO_ENCONTRADO,
  rotaSaude,
  STATUS_PROJETO,
  TRANSICAO_INVALIDA,
  type Finalizacao,
  type StatusProjeto,
  type Verificacao,
} from '@cinebridge/comum';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import type { GestaoProjetos } from './GestaoProjetos';

const CODIGOS: Record<string, number> = { [PROJETO_NAO_ENCONTRADO]: 404, [TRANSICAO_INVALIDA]: 409 };

const ESQUEMA_FINALIZACAO = {
  type: 'object',
  additionalProperties: false,
  properties: {
    metricas: { type: 'object', additionalProperties: { type: 'number' } },
    resultados: { type: 'string' },
  },
};

export function construirApp(
  gestao: GestaoProjetos,
  verificacoes: Record<string, Verificacao>,
  opcoes: FastifyServerOptions = {},
) {
  const app = Fastify(opcoes);

  app.setErrorHandler<FastifyError>((erro, _requisicao, resposta) => {
    const codigo = erro instanceof ErroOperacao ? CODIGOS[erro.codigo] : undefined;
    if (codigo) return resposta.status(codigo).send({ erro: erro.message });
    const status = erro.statusCode ?? 500;
    return resposta.status(status).send({ erro: status === 500 ? 'Erro interno' : erro.message });
  });

  app.get('/health', rotaSaude(verificacoes));

  app.get<{ Querystring: { status?: StatusProjeto; produtor?: string } }>(
    '/projetos',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { status: { enum: [...STATUS_PROJETO] }, produtor: { type: 'string' } },
        },
      },
    },
    async (requisicao) => gestao.listar(requisicao.query),
  );

  app.get<{ Params: { id: string } }>('/projetos/:id', async (requisicao) => gestao.buscar(requisicao.params.id));

  /** O produtor encerra a produção e informa como foi. */
  app.post<{ Params: { id: string }; Body: Finalizacao | undefined }>(
    '/projetos/:id/finalizar',
    { schema: { body: ESQUEMA_FINALIZACAO } },
    async (requisicao) => gestao.finalizar(requisicao.params.id, requisicao.body ?? {}),
  );

  return app;
}
