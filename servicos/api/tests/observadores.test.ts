import { describe, expect, it, vi } from 'vitest';
import { Papel } from '../src/dominio/Papel';
import { AuditoriaRecomendacao } from '../src/observadores/AuditoriaRecomendacao';
import { BarramentoEmMemoria } from '../src/observadores/BarramentoEventos';
import { EventoRecomendacao, type TipoEvento } from '../src/observadores/EventoRecomendacao';
import { NotificadorConvite } from '../src/observadores/NotificadorConvite';
import type { Email } from '../src/observadores/Email';
import type { Observador } from '../src/observadores/Observador';
import { criarProjeto } from './fixtures';

const projeto = criarProjeto({ id: 'proj-1' });

/** Guarda os tipos que recebeu, no lugar dos notificadores que foram para o serviço de notificações. */
const ouvinte = () => {
  const recebidos: string[] = [];
  const observador: Observador = { atualizar: (e) => void recebidos.push(`${e.tipo}:${e.dados.envolvidos.length}`) };
  return { recebidos, observador };
};

const evento = (tipo: TipoEvento) =>
  new EventoRecomendacao(
    tipo,
    projeto,
    [
      { profissionalId: 'p01', nome: 'Ana Ribeiro', papel: Papel.DIRETOR },
      { profissionalId: 'p07', nome: 'Gabriela Souza', papel: Papel.SONOPLASTA },
    ],
    'teste',
  );

describe('Observer', () => {
  it('cada observador reage ao mesmo evento do seu jeito', () => {
    const emails: Email[] = [];
    const linhas: string[] = [];
    const barramento = new BarramentoEmMemoria();
    const convite = new NotificadorConvite((e) => emails.push(e));
    const outro = ouvinte();
    const auditoria = new AuditoriaRecomendacao((l) => linhas.push(l));
    for (const o of [convite, outro.observador, auditoria]) barramento.inscrever((e) => o.atualizar(e));

    barramento.publicar(evento('recomendacao_gerada'));

    expect(emails.map((e) => e.para)).toEqual(['p01', 'p07']);
    expect(outro.recebidos).toEqual(['recomendacao_gerada:2']);
    expect(JSON.parse(linhas[0] ?? '')).toMatchObject({
      evento: 'recomendacao_gerada',
      projetoId: 'proj-1',
      profissionais: ['p01', 'p07'],
    });
  });

  it('a falha de um observador não impede os outros de serem notificados', () => {
    const aoFalhar = vi.fn();
    const barramento = new BarramentoEmMemoria(aoFalhar);
    const outro = ouvinte();
    barramento.inscrever(() => {
      throw new Error('servidor de e-mail fora do ar');
    });
    barramento.inscrever((e) => outro.observador.atualizar(e));

    barramento.publicar(evento('recomendacao_gerada'));

    expect(aoFalhar).toHaveBeenCalledOnce();
    expect(outro.recebidos).toHaveLength(1);
  });

  it('convites só saem quando há profissionais a convidar', () => {
    const emails: Email[] = [];
    const convite = new NotificadorConvite((e) => emails.push(e));

    convite.atualizar(evento('membro_substituido'));
    convite.atualizar(evento('convite_aceito'));
    convite.atualizar(evento('equipe_formada'));

    expect(emails).toHaveLength(2);
    expect(emails[0]?.corpo).toBe('Um produtor tem interesse em você como DIRETOR no projeto Vozes do Sertão.');
  });

  it('a auditoria guarda todos os registros em ordem', () => {
    const auditoria = new AuditoriaRecomendacao(() => {});
    auditoria.atualizar(evento('recomendacao_gerada'));
    auditoria.atualizar(evento('convite_aceito'));
    expect(auditoria.registros.map((r) => r.evento)).toEqual(['recomendacao_gerada', 'convite_aceito']);
  });
});
