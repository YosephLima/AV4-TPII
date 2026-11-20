import { afterAll, describe, expect, it } from 'vitest';
import { construirApp } from '../src/http/app';
import { ProjetosEmMemoria } from '../src/projetos/Projetos';
import { sistemaDeTeste } from './fixtures';

/**
 * O fluxo do produtor pelas rotas HTTP. Cada requisição recria o projeto a partir do que está guardado (no
 * serviço de projetos e no arquivo de recomendações), como acontece entre containers.
 */
function montar() {
  const projetos = new ProjetosEmMemoria();
  const contexto = sistemaDeTeste({ projetos });
  const app = construirApp(contexto);
  return { ...contexto, projetos, app };
}

const corpo = {
  tipo: 'documentario',
  nome: 'Vozes do Sertão',
  produtor: 'produtora@exemplo.com',
  orcamento: 120_000,
  prazo: '2027-03-30',
  localizacao: 'Recife',
  detalhes: { tema: 'Migração no sertão', entrevistados: ['Dona Socorro'] },
};

interface Membro {
  papel: string;
  confirmado: boolean;
  profissional: { id: string };
}

describe('Fluxo do produtor pela API', () => {
  const { app, projetos, linhasAuditoria } = montar();
  afterAll(() => app.close());

  const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload });
  const membros = (resposta: { json(): unknown }) => (resposta.json() as { equipe: { membros: Membro[] } }).equipe.membros;

  let id = '';
  let papeis: string[] = [];

  it('a recomendação registra o projeto no serviço de projetos, em formação', async () => {
    const resposta = await post('/recomendacoes', corpo);
    expect(resposta.statusCode).toBe(200);
    id = resposta.json<{ projetoId: string }>().projetoId;
    papeis = membros(resposta).map((m) => m.papel);

    const registrado = await projetos.buscar(id);
    expect(registrado).toMatchObject({ status: 'em_formacao', nome: 'Vozes do Sertão', orcamento: 120_000, prazo: '2027-03-30' });
    expect(registrado.solicitacao).toEqual(corpo);
  });

  it('recusa: o papel ganha outro profissional e o restante da equipe fica', async () => {
    const antes = membros(await post(`/projetos/${id}/substituicoes`, { papel: papeis[0] }));
    const recusou = antes.find((m) => m.papel === papeis[1])?.profissional.id;

    const depois = membros(await post(`/projetos/${id}/convites`, { papel: papeis[1], aceito: false }));
    expect(depois.find((m) => m.papel === papeis[1])?.profissional.id).not.toBe(recusou);
    expect(depois.find((m) => m.papel === papeis[0])?.profissional.id).toBe(
      antes.find((m) => m.papel === papeis[0])?.profissional.id,
    );
  });

  it('o estado sobrevive entre requisições: confirmações feitas antes continuam valendo', async () => {
    await post(`/projetos/${id}/convites`, { papel: papeis[0], aceito: true });
    const resposta = await post(`/projetos/${id}/convites`, { papel: papeis[1], aceito: true });
    const confirmados = membros(resposta).filter((m) => m.confirmado).map((m) => m.papel);
    expect(confirmados).toEqual(papeis.slice(0, 2));
  });

  it('com todos confirmados, a composição final vai para o serviço de projetos', async () => {
    let resposta;
    for (const papel of papeis.slice(2)) resposta = await post(`/projetos/${id}/convites`, { papel, aceito: true });

    expect(resposta?.json()).toMatchObject({ equipe: { status: 'formada' } });
    const registrado = await projetos.buscar(id);
    expect(registrado.status).toBe('equipe_formada');
    expect(registrado.equipe?.map((m) => m.papel)).toEqual(papeis);
    expect((await app.inject({ url: `/recomendacoes/${id}` })).json()).toMatchObject({ status: 'formada' });
  });

  it('com a equipe formada, convites e substituições são recusados (409)', async () => {
    const resposta = await post(`/projetos/${id}/convites`, { papel: papeis[0], aceito: false });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json<{ erro: string }>().erro).toContain('peça uma reavaliação');
    expect((await post(`/projetos/${id}/substituicoes`, { papel: papeis[0] })).statusCode).toBe(409);
  });

  it('reavaliação com novo orçamento: nova equipe e o projeto volta a em formação', async () => {
    const resposta = await post(`/projetos/${id}/reavaliacao`, { orcamento: 150_000 });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ orcamento: 150_000, prazo: '2027-03-30', equipe: { status: 'proposta' } });

    const registrado = await projetos.buscar(id);
    expect(registrado).toMatchObject({ status: 'em_formacao', equipe: null, orcamento: 150_000 });
    expect(registrado.solicitacao).toMatchObject({ orcamento: 150_000 });
    expect(linhasAuditoria.map((l) => JSON.parse(l).evento)).toContain('reavaliacao_solicitada');
  });

  it('projeto finalizado não aceita mais mudanças', async () => {
    await projetos.finalizar(id);
    expect((await post(`/projetos/${id}/reavaliacao`)).statusCode).toBe(409);
  });

  it('erros: projeto inexistente (404), papel fora da equipe (422), corpo inválido (400)', async () => {
    const inexistente = '00000000-0000-4000-8000-000000000000';
    expect((await post(`/projetos/${inexistente}/substituicoes`, { papel: 'EDITOR' })).statusCode).toBe(404);
    expect((await post('/projetos/nao-e-uuid/substituicoes', { papel: 'EDITOR' })).statusCode).toBe(400);
    expect((await post(`/projetos/${id}/convites`, { papel: 'EDITOR' })).statusCode).toBe(400);

    const ficcao = await post('/recomendacoes', { tipo: 'ficcao', nome: 'Curta', produtor: 'p@exemplo.com' });
    const papeisFiccao = membros(ficcao).map((m) => m.papel);
    const fora = ['EFEITOS_VISUAIS', 'EDITOR', 'SONOPLASTA'].find((p) => !papeisFiccao.includes(p));
    const outroId = ficcao.json<{ projetoId: string }>().projetoId;
    expect((await post(`/projetos/${outroId}/substituicoes`, { papel: fora })).statusCode).toBe(422);
  });
});
