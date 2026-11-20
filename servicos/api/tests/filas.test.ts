import {
  ClienteRpc,
  ConsumidorEventos,
  ErroOperacao,
  FILAS,
  OPERACOES_PROFISSIONAIS,
  OPERACOES_PROJETOS,
  PROFISSIONAL_NAO_ENCONTRADO,
  profissionaisDeDemonstracao,
  PublicadorEventos,
  ServidorRpc,
  TempoEsgotadoError,
  TransporteMemoria,
  type CriteriosProfissionais,
  type Evento,
  type MembroDTO,
  type RegistroProjeto,
} from '@cinebridge/comum';
import { describe, expect, it } from 'vitest';
import { AdaptadorFila } from '../src/adaptadores/profissionais/AdaptadorFila';
import { ProfissionalNaoEncontradoError } from '../src/adaptadores/profissionais/AdaptadorProfissional';
import { Avaliacao } from '../src/dominio/Avaliacao';
import { Papel } from '../src/dominio/Papel';
import { construirApp } from '../src/http/app';
import { BarramentoRabbitMQ } from '../src/observadores/BarramentoRabbitMQ';
import { ProjetosEmMemoria, ProjetosViaFila } from '../src/projetos/Projetos';
import { sistemaDeTeste } from './fixtures';

/**
 * A api ligada às filas, sobre o broker em memória. Os outros serviços são dublês que seguem os contratos do
 * pacote comum; os serviços de verdade têm os próprios testes e o e2e junta tudo no docker compose.
 */
async function montar() {
  const transporte = new TransporteMemoria();

  const cadastro = profissionaisDeDemonstracao();
  const pedidosProfissionais: unknown[] = [];
  await new ServidorRpc(transporte, FILAS.consultaProfissionais, {
    [OPERACOES_PROFISSIONAIS.listar]: async (criterios: CriteriosProfissionais) => {
      pedidosProfissionais.push(criterios);
      return cadastro.filter((p) => !criterios?.papeis || criterios.papeis.some((papel) => p.especialidades.includes(papel)));
    },
    [OPERACOES_PROFISSIONAIS.detalhar]: async ({ id }: { id: string }) => {
      const encontrado = cadastro.find((p) => p.id === id);
      if (!encontrado) throw new ErroOperacao(PROFISSIONAL_NAO_ENCONTRADO, 'não existe');
      return encontrado;
    },
    [OPERACOES_PROFISSIONAIS.avaliar]: async () => null,
  }).iniciar();

  const projetos = new ProjetosEmMemoria();
  await new ServidorRpc(transporte, FILAS.consultaProjetos, {
    [OPERACOES_PROJETOS.registrar]: (r: RegistroProjeto) => projetos.registrar(r),
    [OPERACOES_PROJETOS.buscar]: ({ id }: { id: string }) => projetos.buscar(id),
    [OPERACOES_PROJETOS.formarEquipe]: ({ id, equipe }: { id: string; equipe: MembroDTO[] }) => projetos.formarEquipe(id, equipe),
    [OPERACOES_PROJETOS.reabrir]: ({ id, alteracoes }: { id: string; alteracoes: Partial<RegistroProjeto> }) =>
      projetos.reabrir(id, alteracoes),
  }).iniciar();

  const eventos: Evento[] = [];
  await new ConsumidorEventos(transporte, FILAS.eventosRecomendacao).inscrever({ atualizar: (e) => void eventos.push(e) }).iniciar();

  const rpc = await new ClienteRpc(transporte, 500).iniciar();
  const publicador = await new PublicadorEventos(transporte, FILAS.eventosRecomendacao, 'cinebridge-api').iniciar();
  const contexto = sistemaDeTeste({
    adaptadores: { profissional: new AdaptadorFila(rpc) },
    projetos: new ProjetosViaFila(rpc),
    barramento: new BarramentoRabbitMQ(publicador),
    enviarEmail: (email) => void publicador.publicar('convite_enviado', email),
  });
  return { ...contexto, transporte, rpc, projetos, eventos, pedidosProfissionais };
}

describe('Adapter sobre a fila consulta-profissionais', () => {
  it('o orquestrador pede só os papéis do projeto e recebe profissionais do domínio', async () => {
    const { sistema, pedidosProfissionais } = await montar();
    const { equipe } = await sistema.recomendar({ tipo: 'ficcao', nome: 'Curta', produtor: 'p@exemplo.com' });
    expect(equipe.membros.length).toBeGreaterThan(0);
    expect(equipe.membros[0]?.profissional.notaMedia()).toBeGreaterThan(0);
    expect(pedidosProfissionais).toHaveLength(1);
    expect((pedidosProfissionais[0] as CriteriosProfissionais).papeis).toEqual(equipe.membros.map((m) => m.papel));
  });

  it('id desconhecido vira o mesmo erro dos outros adaptadores', async () => {
    const { rpc } = await montar();
    const adaptador = new AdaptadorFila(rpc);
    await expect(adaptador.detalharProfissional('p99')).rejects.toBeInstanceOf(ProfissionalNaoEncontradoError);
    await expect(adaptador.registrarAvaliacao('p01', new Avaliacao(5, 'ok', new Date()))).resolves.toBeUndefined();
  });

  it('serviço de profissionais fora do ar: a api responde 503 em vez de travar', async () => {
    const transporte = new TransporteMemoria();
    await transporte.declararFila(FILAS.consultaProfissionais);
    const rpc = await new ClienteRpc(transporte, 30).iniciar();
    const contexto = sistemaDeTeste({ adaptadores: { profissional: new AdaptadorFila(rpc) } });
    const app = construirApp(contexto);
    const resposta = await app.inject({ method: 'POST', url: '/recomendacoes', payload: { tipo: 'ficcao', nome: 'C', produtor: 'p' } });
    expect(resposta.statusCode).toBe(503);
    await expect(new AdaptadorFila(rpc).listarProfissionais()).rejects.toBeInstanceOf(TempoEsgotadoError);
    await app.close();
  });
});

describe('Projeto registrado e eventos publicados pelas filas', () => {
  it('recomendação completa: projeto no serviço de projetos, eventos e convites na fila eventos-recomendacao', async () => {
    const { fluxo, transporte, projetos, eventos, linhasAuditoria } = await montar();
    const { projeto, equipe } = await fluxo.recomendar({
      tipo: 'documentario',
      nome: 'Vozes do Sertão',
      produtor: 'produtora@exemplo.com',
      detalhes: { tema: 'Migração', entrevistados: ['Dona Socorro'] },
    });
    await transporte.ocioso();

    expect((await projetos.buscar(projeto.id)).status).toBe('em_formacao');

    const recomendacao = eventos.find((e) => e.tipo === 'recomendacao_gerada');
    expect(recomendacao).toMatchObject({
      origem: 'cinebridge-api',
      dados: { projetoId: projeto.id, tipoProjeto: 'documentario', produtor: 'produtora@exemplo.com' },
    });
    const convites = eventos.filter((e) => e.tipo === 'convite_enviado');
    expect(convites).toHaveLength(equipe.membros.length);
    // O texto do convite vem do notificador da família (documentário), com o tema.
    expect((convites[0]?.dados as { corpo: string }).corpo).toContain('Migração');
    // A auditoria continua na api, em memória.
    expect(linhasAuditoria.map((l) => JSON.parse(l).evento)).toEqual(['recomendacao_gerada']);
  });

  it('equipe formada pelas filas: o serviço de projetos recebe a composição final', async () => {
    const { fluxo, transporte, projetos, eventos } = await montar();
    const { projeto, equipe } = await fluxo.recomendar({ tipo: 'ficcao', nome: 'Curta', produtor: 'p@exemplo.com' });
    for (const m of equipe.membros) await fluxo.responderConvite(projeto.id, m.papel, true);
    await transporte.ocioso();

    const registrado = await projetos.buscar(projeto.id);
    expect(registrado.status).toBe('equipe_formada');
    expect(registrado.equipe).toHaveLength(equipe.membros.length);
    expect(eventos.filter((e) => e.tipo === 'convite_aceito')).toHaveLength(equipe.membros.length);
    expect(eventos.at(-1)?.tipo).toBe('equipe_formada');
  });

  it('serviço de projetos responde que não conhece o projeto: 404', async () => {
    const contexto = await montar();
    const app = construirApp(contexto);
    const resposta = await app.inject({
      method: 'POST',
      url: '/projetos/00000000-0000-4000-8000-000000000000/convites',
      payload: { papel: Papel.EDITOR, aceito: true },
    });
    expect(resposta.statusCode).toBe(404);
    await app.close();
  });
});
