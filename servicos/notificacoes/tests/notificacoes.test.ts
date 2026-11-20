import {
  EVENTOS_PROJETO,
  EVENTOS_RECOMENDACAO as E,
  FILAS,
  PublicadorEventos,
  TransporteMemoria,
  type DadosEventoProjeto,
  type DadosEventoRecomendacao,
  type ResumoProjeto,
} from '@cinebridge/comum';
import { afterAll, describe, expect, it } from 'vitest';
import { construirApp } from '../src/app';
import { CaixaEmMemoria, type Notificacao } from '../src/Caixa';
import { iniciarConsumidores } from '../src/consumidores';
import { Expedicao } from '../src/Expedicao';

const dados: DadosEventoRecomendacao = {
  projetoId: 'proj-1',
  projetoNome: 'Vozes do Sertão',
  tipoProjeto: 'documentario',
  produtor: 'produtora@exemplo.com',
  envolvidos: [
    { profissionalId: 'p01', nome: 'Ana Ribeiro', papel: 'DIRETOR' },
    { profissionalId: 'p07', nome: 'Gabriela Souza', papel: 'SONOPLASTA' },
  ],
};

const projeto: ResumoProjeto = {
  id: 'proj-1',
  tipo: 'documentario',
  nome: 'Vozes do Sertão',
  produtor: 'produtora@exemplo.com',
  orcamento: 60_000,
  prazo: '2027-03-30',
  custoEstimado: 45_000,
  status: 'finalizado',
  equipe: null,
  metricas: { espectadores: 1200 },
  resultados: 'Estreou no festival',
  criadoEm: '2026-11-20T12:00:00.000Z',
  atualizadoEm: '2026-11-20T12:00:00.000Z',
  finalizadoEm: '2026-11-20T12:00:00.000Z',
};

/** O serviço inteiro sobre o broker em memória, com a api e o serviço de projetos fazendo papel de publicadores. */
async function montar() {
  const transporte = new TransporteMemoria();
  const caixa = new CaixaEmMemoria();
  const enviadas: Notificacao[] = [];
  await iniciarConsumidores(transporte, caixa, new Expedicao(caixa, (n) => enviadas.push(n)));
  const api = await new PublicadorEventos(transporte, FILAS.eventosRecomendacao, 'cinebridge-api').iniciar();
  const projetos = await new PublicadorEventos(transporte, FILAS.eventosProjetos, 'cinebridge-projetos').iniciar();
  return { transporte, caixa, enviadas, api, projetos };
}

describe('Observer sobre as filas', () => {
  it('recomendação gerada: mensagem interna para cada profissional e para o produtor', async () => {
    const { transporte, enviadas, api } = await montar();
    await api.publicar(E.recomendacaoGerada, dados);
    await transporte.ocioso();

    expect(enviadas.map((n) => [n.canal, n.destinatario])).toEqual([
      ['interna', 'p01'],
      ['interna', 'p07'],
      ['interna', 'produtora@exemplo.com'],
    ]);
    expect(enviadas[0]).toMatchObject({ assunto: '[recomendacao_gerada] Vozes do Sertão', conteudo: 'Vozes do Sertão: DIRETOR' });
  });

  it('respostas a convites e equipe formada viram e-mail ao produtor, além da mensagem interna', async () => {
    const { transporte, enviadas, api } = await montar();
    await api.publicar(E.conviteAceito, { ...dados, envolvidos: dados.envolvidos.slice(0, 1) });
    await api.publicar(E.equipeFormada, dados);
    await transporte.ocioso();

    const emails = enviadas.filter((n) => n.canal === 'email');
    expect(emails.map((n) => n.conteudo)).toEqual(['Ana Ribeiro aceitou o convite para DIRETOR.', 'Todos confirmaram.']);
    expect(emails.every((n) => n.destinatario === 'produtora@exemplo.com')).toBe(true);
    expect(enviadas.filter((n) => n.canal === 'interna')).toHaveLength(2 + 3);
  });

  it('convite redigido pela api é entregue ao profissional como veio', async () => {
    const { transporte, enviadas, api } = await montar();
    await api.publicar(E.conviteEnviado, {
      para: 'p03',
      assunto: 'Convite: Curta',
      corpo: 'Um produtor tem interesse em você. Técnica: 3d.',
      projetoId: 'proj-2',
    });
    await transporte.ocioso();
    expect(enviadas).toEqual([
      expect.objectContaining({ canal: 'email', destinatario: 'p03', projetoId: 'proj-2', conteudo: 'Um produtor tem interesse em você. Técnica: 3d.' }),
    ]);
  });

  it('eventos de projetos viram e-mail ao produtor, com métricas e resultados na finalização', async () => {
    const { transporte, enviadas, projetos } = await montar();
    const evento = (motivo?: string): DadosEventoProjeto => ({ projeto, ...(motivo ? { motivo } : {}) });
    await projetos.publicar(EVENTOS_PROJETO.criado, evento());
    await projetos.publicar(EVENTOS_PROJETO.atualizado, evento('equipe_formada'));
    await projetos.publicar(EVENTOS_PROJETO.finalizado, evento());
    await transporte.ocioso();

    expect(enviadas.map((n) => n.assunto)).toEqual([
      'Projeto registrado: Vozes do Sertão',
      'Projeto atualizado: Vozes do Sertão',
      'Projeto finalizado: Vozes do Sertão',
    ]);
    expect(enviadas[1]?.conteudo).toBe('A composição final da equipe foi registrada.');
    expect(enviadas[2]?.conteudo).toBe('Estreou no festival\nespectadores: 1200');
  });

  it('o mesmo evento entregue duas vezes não repete os alertas', async () => {
    const { transporte, enviadas, caixa, api } = await montar();
    const evento = await api.publicar(E.equipeFormada, dados);
    await transporte.enviar(FILAS.eventosRecomendacao, evento);
    await transporte.ocioso();
    expect(enviadas).toHaveLength(4);
    expect(await caixa.listar()).toHaveLength(4);
  });

  it('eventos que ninguém trata são confirmados sem gerar alertas', async () => {
    const { transporte, enviadas, api } = await montar();
    await api.publicar('evento_futuro', dados);
    await transporte.ocioso();
    expect(enviadas).toHaveLength(0);
    expect(transporte.descartadas(FILAS.eventosRecomendacao)).toHaveLength(0);
  });
});

describe('HTTP', () => {
  const caixa = new CaixaEmMemoria();
  const app = construirApp(caixa, {});
  afterAll(() => app.close());

  it('consulta filtrando por destinatário e canal', async () => {
    const base = { eventoId: 'e1', tipoEvento: 't', origem: 'o', projetoId: 'proj-1', assunto: 'a', conteudo: 'c' };
    await caixa.guardar([
      { ...base, canal: 'email', destinatario: 'produtora@exemplo.com' },
      { ...base, canal: 'interna', destinatario: 'produtora@exemplo.com' },
      { ...base, canal: 'interna', destinatario: 'p01' },
    ]);
    const resposta = await app.inject({ url: '/notificacoes?destinatario=produtora@exemplo.com&canal=interna' });
    expect(resposta.json()).toHaveLength(1);
    expect((await app.inject({ url: '/notificacoes?projetoId=proj-1' })).json()).toHaveLength(3);
    expect((await app.inject({ url: '/notificacoes?canal=sms' })).statusCode).toBe(400);
  });
});
