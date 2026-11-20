import { ErroOperacao, PROFISSIONAL_NAO_ENCONTRADO, rotaSaude, type Verificacao } from '@cinebridge/comum';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import type { Cadastro } from './Cadastro';

/** Consulta direta ao cadastro, para conferência. Os outros serviços usam a fila, nunca estas rotas. */
export function construirApp(
  cadastro: Cadastro,
  verificacoes: Record<string, Verificacao>,
  opcoes: FastifyServerOptions = {},
) {
  const app = Fastify(opcoes);

  app.setErrorHandler<FastifyError>((erro, _requisicao, resposta) => {
    if (erro instanceof ErroOperacao && erro.codigo === PROFISSIONAL_NAO_ENCONTRADO) {
      return resposta.status(404).send({ erro: erro.message });
    }
    const status = erro.statusCode ?? 500;
    return resposta.status(status).send({ erro: status === 500 ? 'Erro interno' : erro.message });
  });

  app.get('/health', rotaSaude(verificacoes));

  app.get<{ Querystring: { papel?: string; localizacao?: string } }>('/profissionais', async (requisicao) => {
    const { papel, localizacao } = requisicao.query;
    return cadastro.listar({ papeis: papel ? [papel] : undefined, localizacao });
  });

  app.get<{ Params: { id: string } }>('/profissionais/:id', async (requisicao) => cadastro.detalhar(requisicao.params.id));

  return app;
}
