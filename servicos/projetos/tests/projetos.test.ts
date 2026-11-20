import {
  ClienteRpc,
  ConsumidorEventos,
  FILAS,
  OPERACOES_PROJETOS as OP,
  PublicadorEventos,
  TransporteMemoria,
  type DadosEventoProjeto,
  type Evento,
  type ProjetoDTO,
  type RegistroProjeto,
} from '@cinebridge/comum';
import { describe, expect, it } from 'vitest';
import { construirApp } from '../src/app';
import { servidorConsultas } from '../src/consultas';
import { GestaoProjetos } from '../src/GestaoProjetos';
import { RepositorioEmMemoria } from '../src/Repositorio';

const registro: RegistroProjeto = {
  id: '6b1f3c2e-0000-4000-8000-000000000001',
  tipo: 'documentario',
  nome: 'Vozes do Sertão',
  produtor: 'produtora@exemplo.com',
  orcamento: 60_000,
  prazo: '2027-03-30',
  custoEstimado: 45_000,
  solicitacao: { tipo: 'documentario', nome: 'Vozes do Sertão', produtor: 'produtora@exemplo.com' },
};

const equipe = [{ papel: 'DIRETOR', profissionalId: 'p02', nome: 'Bruno Tavares', precoMedio: 12_000 }];

/** Monta o serviço inteiro sobre o broker em memória, com um ouvinte no lugar do serviço de notificações. */
async function montar() {
  const transporte = new TransporteMemoria();
  const publicador = await new PublicadorEventos(transporte, FILAS.eventosProjetos, 'cinebridge-projetos').iniciar();
  const gestao = new GestaoProjetos(new RepositorioEmMemoria(), (tipo, dados) => publicador.publicar(tipo, dados));
  await servidorConsultas(transporte, gestao).iniciar();

  const eventos: Evento<DadosEventoProjeto>[] = [];
  await new ConsumidorEventos(transporte, FILAS.eventosProjetos)
    .inscrever({ atualizar: (e) => void eventos.push(e as Evento<DadosEventoProjeto>) })
    .iniciar();

  const cliente = await new ClienteRpc(transporte, 500).iniciar();
  const chamar = async <T = ProjetoDTO>(operacao: string, dados: unknown) => {
    const resultado = await cliente.chamar<T>(FILAS.consultaProjetos, operacao, dados);
    await transporte.ocioso();
    return resultado;
  };
  return { gestao, chamar, eventos };
}

describe('fila consulta-projetos e eventos-projetos', () => {
  it('registrar cria o projeto em formação e publica projeto_criado, sem a solicitação', async () => {
    const { chamar, eventos } = await montar();
    const projeto = await chamar(OP.registrar, registro);

    expect(projeto).toMatchObject({ status: 'em_formacao', equipe: null, solicitacao: registro.solicitacao });
    expect(eventos.map((e) => e.tipo)).toEqual(['projeto_criado']);
    expect(eventos[0]?.origem).toBe('cinebridge-projetos');
    expect(eventos[0]?.dados.projeto).not.toHaveProperty('solicitacao');
  });

  it('registrar de novo o mesmo id atualiza em vez de duplicar', async () => {
    const { chamar, eventos, gestao } = await montar();
    await chamar(OP.registrar, registro);
    await chamar(OP.registrar, { ...registro, orcamento: 70_000 });

    expect(await gestao.listar()).toHaveLength(1);
    expect((await gestao.buscar(registro.id)).orcamento).toBe(70_000);
    expect(eventos.map((e) => [e.tipo, e.dados.motivo])).toEqual([
      ['projeto_criado', undefined],
      ['projeto_atualizado', 'dados'],
    ]);
  });

  it('ciclo completo: formar equipe, finalizar com métricas', async () => {
    const { chamar, eventos, gestao } = await montar();
    await chamar(OP.registrar, registro);
    const formado = await chamar(OP.formarEquipe, { id: registro.id, equipe });
    expect(formado).toMatchObject({ status: 'equipe_formada', equipe });

    const finalizado = await gestao.finalizar(registro.id, { metricas: { espectadores: 1200 }, resultados: 'Estreou' });
    expect(finalizado).toMatchObject({ status: 'finalizado', metricas: { espectadores: 1200 }, resultados: 'Estreou' });
    expect(finalizado.finalizadoEm).not.toBeNull();

    expect(eventos.map((e) => e.tipo)).toEqual(['projeto_criado', 'projeto_atualizado', 'projeto_finalizado']);
    expect(eventos[1]?.dados.motivo).toBe('equipe_formada');
  });

  it('formar a mesma equipe duas vezes não publica de novo', async () => {
    const { chamar, eventos } = await montar();
    await chamar(OP.registrar, registro);
    await chamar(OP.formarEquipe, { id: registro.id, equipe });
    await chamar(OP.formarEquipe, { id: registro.id, equipe });
    expect(eventos).toHaveLength(2);
  });

  it('reabrir devolve o projeto a em_formacao, sem equipe e com o novo orçamento', async () => {
    const { chamar } = await montar();
    await chamar(OP.registrar, registro);
    await chamar(OP.formarEquipe, { id: registro.id, equipe });
    const reaberto = await chamar(OP.reabrir, { id: registro.id, alteracoes: { orcamento: 90_000 } });
    expect(reaberto).toMatchObject({ status: 'em_formacao', equipe: null, orcamento: 90_000 });
  });

  it('transições inválidas e projeto inexistente voltam como erro de negócio', async () => {
    const { chamar, gestao } = await montar();
    await expect(chamar(OP.buscar, { id: 'nao-existe' })).rejects.toMatchObject({ codigo: 'PROJETO_NAO_ENCONTRADO' });

    await chamar(OP.registrar, registro);
    await expect(gestao.finalizar(registro.id)).rejects.toMatchObject({ codigo: 'TRANSICAO_INVALIDA' });

    await chamar(OP.formarEquipe, { id: registro.id, equipe });
    await gestao.finalizar(registro.id);
    await expect(chamar(OP.reabrir, { id: registro.id })).rejects.toMatchObject({ codigo: 'TRANSICAO_INVALIDA' });
    await expect(chamar(OP.registrar, registro)).rejects.toMatchObject({ codigo: 'TRANSICAO_INVALIDA' });
  });
});

describe('HTTP', () => {
  it('lista, consulta e finaliza, com 404 e 409 nos erros', async () => {
    const { chamar, gestao } = await montar();
    const app = construirApp(gestao, {});
    await chamar(OP.registrar, registro);

    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/projetos?status=em_formacao' })).json()).toHaveLength(1);
    expect((await app.inject({ url: '/projetos?status=finalizado' })).json()).toHaveLength(0);
    expect((await app.inject({ url: '/projetos?status=qualquer' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/projetos/nao-existe' })).statusCode).toBe(404);

    const cedo = await app.inject({ method: 'POST', url: `/projetos/${registro.id}/finalizar`, payload: {} });
    expect(cedo.statusCode).toBe(409);

    await chamar(OP.formarEquipe, { id: registro.id, equipe });
    const finalizado = await app.inject({
      method: 'POST',
      url: `/projetos/${registro.id}/finalizar`,
      payload: { metricas: { festivais: 3 }, resultados: 'Selecionado em festivais' },
    });
    expect(finalizado.statusCode).toBe(200);
    expect(finalizado.json()).toMatchObject({ status: 'finalizado', metricas: { festivais: 3 } });
    await app.close();
  });
});
