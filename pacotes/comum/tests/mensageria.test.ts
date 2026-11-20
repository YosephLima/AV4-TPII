import { describe, expect, it, vi } from 'vitest';
import {
  ClienteRpc,
  ConsumidorEventos,
  ErroOperacao,
  PublicadorEventos,
  ServidorRpc,
  TempoEsgotadoError,
  TransporteMemoria,
  type Evento,
} from '../src';

async function rpc(tratadores: ConstructorParameters<typeof ServidorRpc>[2], tempoLimiteMs = 200) {
  const transporte = new TransporteMemoria();
  await new ServidorRpc(transporte, 'consulta', tratadores, () => {}).iniciar();
  const cliente = await new ClienteRpc(transporte, tempoLimiteMs).iniciar();
  return { transporte, cliente };
}

describe('RPC', () => {
  it('devolve ao cliente o resultado do tratador', async () => {
    const { cliente } = await rpc({ somar: async ({ a, b }: { a: number; b: number }) => a + b });
    await expect(cliente.chamar('consulta', 'somar', { a: 2, b: 3 })).resolves.toBe(5);
  });

  it('respostas simultâneas chegam cada uma ao seu pedido, pelo correlationId', async () => {
    const { cliente } = await rpc({
      eco: async ({ valor, atraso }: { valor: number; atraso: number }) => {
        await new Promise((r) => setTimeout(r, atraso));
        return valor;
      },
    });
    const resultados = await Promise.all([
      cliente.chamar('consulta', 'eco', { valor: 1, atraso: 30 }),
      cliente.chamar('consulta', 'eco', { valor: 2, atraso: 0 }),
      cliente.chamar('consulta', 'eco', { valor: 3, atraso: 15 }),
    ]);
    expect(resultados).toEqual([1, 2, 3]);
  });

  it('um erro de negócio chega ao cliente com o mesmo código', async () => {
    const { cliente } = await rpc({
      buscar: async () => {
        throw new ErroOperacao('NAO_ENCONTRADO', 'Não existe');
      },
    });
    const erro = await cliente.chamar('consulta', 'buscar').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroOperacao);
    expect(erro).toMatchObject({ codigo: 'NAO_ENCONTRADO', message: 'Não existe' });
  });

  it('um erro inesperado não vaza detalhes internos', async () => {
    const { cliente } = await rpc({
      quebrar: async () => {
        throw new Error('senha do banco: 123');
      },
    });
    await expect(cliente.chamar('consulta', 'quebrar')).rejects.toMatchObject({
      codigo: 'ERRO_INTERNO',
      message: 'Erro interno no serviço',
    });
  });

  it('operação desconhecida', async () => {
    const { cliente } = await rpc({});
    await expect(cliente.chamar('consulta', 'voar')).rejects.toMatchObject({ codigo: 'OPERACAO_DESCONHECIDA' });
  });

  it('sem resposta no tempo limite, o pedido falha; a resposta atrasada é ignorada', async () => {
    const { cliente, transporte } = await rpc(
      { lento: () => new Promise((r) => setTimeout(() => r('tarde'), 80)) },
      20,
    );
    await expect(cliente.chamar('consulta', 'lento')).rejects.toBeInstanceOf(TempoEsgotadoError);
    await new Promise((r) => setTimeout(r, 100));
    await transporte.ocioso();
  });

  it('sem ninguém consumindo a fila, o pedido espera e expira', async () => {
    const transporte = new TransporteMemoria();
    await transporte.declararFila('consulta');
    const cliente = await new ClienteRpc(transporte, 20).iniciar();
    await expect(cliente.chamar('consulta', 'qualquer')).rejects.toBeInstanceOf(TempoEsgotadoError);
    expect(transporte.pendentes('consulta')[0]?.propriedades.expiracao).toBe(20);
  });

  it('um pedido sem fila de resposta vai para as descartadas', async () => {
    const { transporte } = await rpc({ somar: async () => 1 });
    await transporte.enviar('consulta', { operacao: 'somar' });
    await transporte.ocioso();
    expect(transporte.descartadas('consulta')).toHaveLength(1);
  });
});

describe('Eventos', () => {
  async function barramento() {
    const transporte = new TransporteMemoria();
    const consumidor = new ConsumidorEventos(transporte, 'eventos');
    const publicador = await new PublicadorEventos(transporte, 'eventos', 'teste').iniciar();
    return { transporte, consumidor, publicador };
  }

  it('publica com o envelope padrão', async () => {
    const { publicador } = await barramento();
    const evento = await publicador.publicar('algo_aconteceu', { x: 1 });
    expect(evento).toMatchObject({ tipo: 'algo_aconteceu', origem: 'teste', dados: { x: 1 } });
    expect(evento.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(evento.ocorridoEm).getTime()).not.toBeNaN();
  });

  it('cada observador recebe só os tipos em que se inscreveu', async () => {
    const { transporte, consumidor, publicador } = await barramento();
    const todos: string[] = [];
    const soCriados: string[] = [];
    consumidor.inscrever(
      { atualizar: (e: Evento) => void todos.push(e.tipo) },
      { tipos: ['criado'], atualizar: (e: Evento) => void soCriados.push(e.tipo) },
    );
    await consumidor.iniciar();

    await publicador.publicar('criado', {});
    await publicador.publicar('finalizado', {});
    await transporte.ocioso();

    expect(todos).toEqual(['criado', 'finalizado']);
    expect(soCriados).toEqual(['criado']);
  });

  it('eventos publicados antes de o consumidor subir esperam na fila', async () => {
    const { transporte, consumidor, publicador } = await barramento();
    await publicador.publicar('cedo', {});
    const recebidos: string[] = [];
    await consumidor.inscrever({ atualizar: (e: Evento) => void recebidos.push(e.tipo) }).iniciar();
    await transporte.ocioso();
    expect(recebidos).toEqual(['cedo']);
  });

  it('se um observador falha, os outros recebem e o evento vai para as descartadas', async () => {
    const { transporte, consumidor, publicador } = await barramento();
    const recebeu = vi.fn();
    consumidor.inscrever(
      {
        atualizar: () => {
          throw new Error('caixa de e-mail fora do ar');
        },
      },
      { atualizar: recebeu },
    );
    await consumidor.iniciar();

    await publicador.publicar('criado', {});
    await transporte.ocioso();

    expect(recebeu).toHaveBeenCalledOnce();
    expect(transporte.descartadas('eventos')).toHaveLength(1);
  });

  it('mensagem fora do formato vai para as descartadas sem chegar aos observadores', async () => {
    const { transporte, consumidor } = await barramento();
    const recebeu = vi.fn();
    await consumidor.inscrever({ atualizar: recebeu }).iniciar();
    await transporte.enviar('eventos', { qualquer: 'coisa' });
    await transporte.ocioso();
    expect(recebeu).not.toHaveBeenCalled();
    expect(transporte.descartadas('eventos')).toHaveLength(1);
  });
});
