import compressao from '@fastify/compress';
import {
  ErroOperacao,
  PROJETO_NAO_ENCONTRADO,
  rotaSaude,
  TempoEsgotadoError,
  TRANSICAO_INVALIDA,
  type Verificacao,
} from '@cinebridge/comum';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import { ArquivoNaoEncontradoError } from '../adaptadores/armazenamento/AdaptadorArmazenamento';
import { descreverPilha } from '../decoradores/DecoradorRecomendacao';
import { DECORADORES, PilhaInvalidaError } from '../decoradores/PoliticaDecoradores';
import type { Equipe } from '../dominio/Equipe';
import { Papel } from '../dominio/Papel';
import type { Projeto } from '../dominio/Projeto';
import { DetalheInvalidoError } from '../fabricas/detalhes';
import { TipoDesconhecidoError } from '../fabricas/RegistroFabricas';
import {
  OperacaoNaoPermitidaError,
  PapelForaDaEquipeError,
  type AjustesReavaliacao,
  type FluxoProdutor,
} from '../fluxo/FluxoProdutor';
import { ESTRATEGIAS, type CorpoRecomendacao } from '../fluxo/solicitacao';
import { ProjetoInvalidoError } from '../orquestracao/OrquestradorEquipe';
import { ModeloDesconhecidoError } from '../prototipos/RegistroPrototipos';
import { ServicoAtomico } from '../servicos/ServicoAtomico';
import { ComposicaoInvalidaError, type ServicoProjeto } from '../servicos/ServicoProjeto';
import { SemCandidatoError, type SistemaRecomendacao } from '../SistemaRecomendacao';

const ERROS_DE_NEGOCIO = [
  ProjetoInvalidoError,
  ModeloDesconhecidoError,
  DetalheInvalidoError,
  TipoDesconhecidoError,
  ComposicaoInvalidaError,
  PilhaInvalidaError,
  PapelForaDaEquipeError,
  SemCandidatoError,
];

/** Erros que vêm dos outros serviços pela fila, com o código do contrato. */
const CODIGOS_REMOTOS: Record<string, number> = { [PROJETO_NAO_ENCONTRADO]: 404, [TRANSICAO_INVALIDA]: 409 };

/** Esquema recursivo: um pacote tem serviços, que podem ser atômicos ou outros pacotes. */
const ESQUEMA_SERVICO = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['nome', 'papel', 'custo', 'prazo'],
      properties: {
        nome: { type: 'string', minLength: 1 },
        papel: { enum: Object.values(Papel) },
        custo: { type: 'number', exclusiveMinimum: 0 },
        prazo: { type: 'string', format: 'date' },
        competencias: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['nome', 'nivel'],
            properties: { nome: { type: 'string' }, nivel: { type: 'number', minimum: 0, maximum: 10 } },
          },
        },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['nome', 'servicos'],
      properties: {
        nome: { type: 'string', minLength: 1 },
        servicos: { type: 'array', minItems: 1, items: { $ref: '#/definitions/servico' } },
      },
    },
  ],
};

/** Os tipos vêm das fábricas registradas, então um tipo novo não mexe na rota. */
function esquemaCorpo(tipos: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['tipo', 'nome', 'produtor'],
    definitions: { servico: ESQUEMA_SERVICO },
    properties: {
      tipo: { enum: tipos },
      modelo: { type: 'string', minLength: 1 },
      nome: { type: 'string', minLength: 1 },
      produtor: { type: 'string', minLength: 1 },
      genero: { type: 'string', minLength: 1 },
      duracao: { type: 'number', exclusiveMinimum: 0 },
      orcamento: { type: 'number', exclusiveMinimum: 0 },
      prazo: { type: 'string', format: 'date' },
      localizacao: { type: 'string' },
      servico: { $ref: '#/definitions/servico' },
      estrategia: { enum: [...ESTRATEGIAS.keys()] },
      decoradores: { type: 'array', uniqueItems: true, items: { enum: [...DECORADORES] } },
      detalhes: { type: 'object' },
    },
  };
}

const papel = { enum: Object.values(Papel) };
const ESQUEMA_ID = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } };

export interface DependenciasHttp {
  sistema: SistemaRecomendacao;
  fluxo: FluxoProdutor;
  /** Banco e broker, para o /health. */
  verificacoes?: Record<string, Verificacao>;
}

/** Respostas abaixo disso vão sem compressão. */
const COMPRIMIR_A_PARTIR_DE = 1_024;

export function construirApp({ sistema, fluxo, verificacoes = {} }: DependenciasHttp, opcoes: FastifyServerOptions = {}) {
  const app = Fastify(opcoes);
  // Gzip ou brotli na resposta, se o cliente aceitar (Accept-Encoding).
  app.register(compressao, { threshold: COMPRIMIR_A_PARTIR_DE });
  const tipos = sistema.catalogo().map((c) => c.tipo);

  app.setErrorHandler<FastifyError>((erro, requisicao, resposta) => {
    if (ERROS_DE_NEGOCIO.some((classe) => erro instanceof classe)) {
      const motivos = erro instanceof ProjetoInvalidoError ? erro.motivos : [];
      return resposta.status(422).send({ erro: erro.message, motivos });
    }
    if (erro instanceof ArquivoNaoEncontradoError) {
      return resposta.status(404).send({ erro: 'Recomendação não encontrada' });
    }
    if (erro instanceof OperacaoNaoPermitidaError) return resposta.status(409).send({ erro: erro.message });
    const remoto = erro instanceof ErroOperacao ? CODIGOS_REMOTOS[erro.codigo] : undefined;
    if (remoto) return resposta.status(remoto).send({ erro: erro.message });
    // Outro serviço não respondeu a tempo: indisponibilidade temporária, não erro do pedido.
    if (erro instanceof TempoEsgotadoError) return resposta.status(503).send({ erro: 'Serviço temporariamente indisponível' });
    const status = erro.statusCode ?? 500;
    if (status === 500) requisicao.log.error(erro);
    return resposta.status(status).send({ erro: status === 500 ? 'Erro interno' : erro.message });
  });

  // As rotas ficam num plugin registrado depois da compressão, para que o gancho dela valha para todas.
  app.register(async (api) => {
    api.get('/health', rotaSaude(verificacoes));

    api.get('/profissionais', async () =>
      (await sistema.adaptadores.profissional.listarProfissionais()).map((p) => ({
        id: p.id,
        nome: p.nome,
        especialidades: p.especialidades,
        precoMedio: p.precoMedio,
        notaMedia: Number(p.notaMedia().toFixed(2)),
        localizacao: p.localizacao,
      })),
    );

    api.get('/modelos', async () => sistema.catalogo());

    const esquema = { body: esquemaCorpo(tipos) };
    api.post<{ Body: CorpoRecomendacao }>('/recomendacoes', { schema: esquema }, async (requisicao) => {
      const { projeto, equipe } = await fluxo.recomendar(requisicao.body);
      const avaliacao = sistema.avaliar(projeto);
      return {
        projetoId: projeto.id,
        tipo: projeto.tipo,
        estrategia: sistema.estrategiaPara(projeto).nome,
        pilha: descreverPilha(sistema.estrategiaPara(projeto)),
        equipe: serializarEquipe(equipe),
        custoEstimado: projeto.calcularCustoTotal(),
        servicos: serializarServico(projeto.servicoPrincipal, equipe),
        compatibilidade: Number(avaliacao.compatibilidade.toFixed(3)),
        consistente: avaliacao.consistente,
        erros: avaliacao.erros,
        relatorio: avaliacao.relatorio,
      };
    });

    api.get<{ Params: { id: string } }>('/recomendacoes/:id', { schema: { params: ESQUEMA_ID } }, async (requisicao) =>
      sistema.consultarRecomendacao(requisicao.params.id),
    );

    // Fluxo do produtor, sobre um projeto já recomendado.

    api.post<{ Params: { id: string }; Body: { papel: Papel; aceito: boolean } }>(
      '/projetos/:id/convites',
      {
        schema: {
          params: ESQUEMA_ID,
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['papel', 'aceito'],
            properties: { papel, aceito: { type: 'boolean' } },
          },
        },
      },
      async (requisicao) =>
        situacao(await fluxo.responderConvite(requisicao.params.id, requisicao.body.papel, requisicao.body.aceito)),
    );

    api.post<{ Params: { id: string }; Body: { papel: Papel } }>(
      '/projetos/:id/substituicoes',
      {
        schema: {
          params: ESQUEMA_ID,
          body: { type: 'object', additionalProperties: false, required: ['papel'], properties: { papel } },
        },
      },
      async (requisicao) => situacao(await fluxo.substituir(requisicao.params.id, requisicao.body.papel)),
    );

    api.post<{ Params: { id: string }; Body: AjustesReavaliacao | undefined }>(
      '/projetos/:id/reavaliacao',
      {
        schema: {
          params: ESQUEMA_ID,
          body: {
            type: 'object',
            additionalProperties: false,
            properties: { orcamento: { type: 'number', exclusiveMinimum: 0 }, prazo: { type: 'string', format: 'date' } },
          },
        },
      },
      async (requisicao) => situacao(await fluxo.reavaliar(requisicao.params.id, requisicao.body ?? {})),
    );
  });

  return app;
}

/** A equipe depois de uma operação do produtor. */
function situacao(projeto: Projeto) {
  const equipe = projeto.equipe as Equipe;
  return {
    projetoId: projeto.id,
    orcamento: projeto.orcamento,
    prazo: projeto.prazo.toISOString().slice(0, 10),
    equipe: serializarEquipe(equipe),
  };
}

function serializarEquipe(equipe: Equipe) {
  return {
    id: equipe.id,
    status: equipe.status,
    custoTotal: equipe.custoTotal(),
    membros: equipe.membros.map((m) => ({
      papel: m.papel,
      confirmado: m.confirmado,
      profissional: { id: m.profissional.id, nome: m.profissional.nome, precoMedio: m.profissional.precoMedio },
      alternativas: (equipe.ranking.get(m.papel) ?? [])
        .filter((p) => p.id !== m.profissional.id)
        .map((p) => ({ id: p.id, nome: p.nome })),
    })),
  };
}

/** A árvore com custo e prazo de cada nó; nas folhas, quem foi escalado para o papel. */
function serializarServico(servico: ServicoProjeto, equipe: Equipe): unknown {
  const comum = {
    nome: servico.nome,
    custo: servico.calcularCusto(),
    prazo: servico.obterPrazo().toISOString().slice(0, 10),
  };
  if (servico instanceof ServicoAtomico) {
    const membro = equipe.membro(servico.papelNecessario);
    return { ...comum, papel: servico.papelNecessario, responsavel: membro?.profissional.nome ?? null };
  }
  return { ...comum, servicos: servico.listarSubservicos().map((s) => serializarServico(s, equipe)) };
}
