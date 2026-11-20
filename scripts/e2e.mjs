// Teste de ponta a ponta com a plataforma no ar (docker compose up -d). Só usa o Node, então roda igual no
// Windows (PowerShell) e no Ubuntu:  npm run e2e
//
// Percorre o fluxo que o enunciado pede para verificar: a recomendação é processada, os profissionais são
// consultados via RabbitMQ, o projeto é registrado no serviço de projetos e as notificações são enviadas.

import { readFileSync } from 'node:fs';

const API = process.env.API_URL ?? 'http://localhost:3000';
const PROJETOS = process.env.PROJETOS_URL ?? 'http://localhost:3002';
const NOTIFICACOES = process.env.NOTIFICACOES_URL ?? 'http://localhost:3003';
const MQ = process.env.MQ_URL ?? 'http://localhost:15672';
const SERVICOS = { 'cinebridge-api': 3000, 'cinebridge-profissionais': 3001, 'cinebridge-projetos': 3002, 'cinebridge-notificacoes': 3003 };

let falhas = 0;
const ok = (mensagem) => console.log(`  ok    ${mensagem}`);
const falha = (mensagem) => {
  falhas++;
  console.log(`  FALHA ${mensagem}`);
};
const conferir = (condicao, mensagem) => (condicao ? ok(mensagem) : falha(mensagem));
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function json(url, opcoes = {}) {
  const resposta = await fetch(url, {
    ...opcoes,
    headers: { 'content-type': 'application/json', ...opcoes.headers },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });
  const texto = await resposta.text();
  return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null };
}

const post = (url, corpo) => json(url, { method: 'POST', corpo });
const exemplo = (nome) => JSON.parse(readFileSync(new URL(`../exemplos/${nome}.json`, import.meta.url), 'utf8'));
const autorizacaoMq = { authorization: `Basic ${Buffer.from('guest:guest').toString('base64')}` };

/** Os consumidores processam em segundo plano; espera até a condição valer ou o tempo acabar. */
async function ate(condicao, ms = 10_000) {
  const limite = Date.now() + ms;
  for (;;) {
    const valor = await condicao();
    if (valor || Date.now() > limite) return valor;
    await esperar(300);
  }
}

/** Mensagens em cada fila de descartadas, para acusar só as que esta execução gerar. */
async function descartadas() {
  try {
    const { corpo } = await json(`${MQ}/api/queues`, { headers: autorizacaoMq });
    return Object.fromEntries(corpo.filter((f) => f.name.endsWith('.descartadas')).map((f) => [f.name, f.messages]));
  } catch {
    return undefined;
  }
}
const descartadasAntes = (await descartadas()) ?? {};

console.log('1. Saúde dos serviços (banco e RabbitMQ)');
for (const [nome, porta] of Object.entries(SERVICOS)) {
  try {
    const { status, corpo } = await json(`http://localhost:${porta}/health`);
    conferir(status === 200, `${nome}: ${JSON.stringify(corpo)}`);
  } catch {
    falha(`${nome} não responde em localhost:${porta}. A plataforma está no ar? (docker compose up -d)`);
  }
}
if (falhas > 0) process.exit(1);

console.log('2. Recomendação pela api (profissionais consultados pela fila consulta-profissionais)');
const recomendacao = await post(`${API}/recomendacoes`, exemplo('documentario'));
conferir(recomendacao.status === 200, `POST /recomendacoes respondeu ${recomendacao.status}`);
const { projetoId, equipe } = recomendacao.corpo;
const papeis = equipe.membros.map((m) => m.papel);
conferir(papeis.length > 0, `equipe com ${papeis.length} papéis: ${equipe.membros.map((m) => m.profissional.nome).join(', ')}`);

console.log('3. Projeto registrado no serviço de projetos (fila consulta-projetos)');
const registrado = await json(`${PROJETOS}/projetos/${projetoId}`);
conferir(registrado.corpo?.status === 'em_formacao', `cinebridge-projetos conhece o projeto: ${registrado.corpo?.status}`);

console.log('4. Fluxo do produtor: uma recusa e depois todos aceitam');
const recusa = await post(`${API}/projetos/${projetoId}/convites`, { papel: papeis[0], aceito: false });
const substituto = recusa.corpo.equipe.membros.find((m) => m.papel === papeis[0]).profissional;
conferir(substituto.id !== equipe.membros[0].profissional.id, `${papeis[0]} recusado, substituído por ${substituto.nome}`);
let ultima;
for (const papel of papeis) ultima = await post(`${API}/projetos/${projetoId}/convites`, { papel, aceito: true });
conferir(ultima.corpo.equipe.status === 'formada', 'equipe formada');
const formado = await json(`${PROJETOS}/projetos/${projetoId}`);
conferir(formado.corpo.status === 'equipe_formada', `composição final no serviço de projetos (${formado.corpo.equipe?.length} membros)`);

console.log('5. Produtor finaliza o projeto (evento projeto_finalizado em eventos-projetos)');
const finalizado = await post(`${PROJETOS}/projetos/${projetoId}/finalizar`, {
  metricas: { espectadores: 1500, festivais: 2 },
  resultados: 'Estreia em festival',
});
conferir(finalizado.corpo?.status === 'finalizado', `projeto ${finalizado.corpo?.status}`);

console.log('6. Notificações enviadas (filas eventos-recomendacao e eventos-projetos)');
const tipos = await ate(async () => {
  const { corpo } = await json(`${NOTIFICACOES}/notificacoes?projetoId=${projetoId}&limite=500`);
  const encontrados = new Set(corpo.map((n) => n.tipoEvento));
  return encontrados.has('projeto_finalizado') && encontrados.has('equipe_formada') ? encontrados : undefined;
});
for (const tipo of ['recomendacao_gerada', 'convite_enviado', 'convite_recusado', 'convite_aceito', 'equipe_formada', 'projeto_criado', 'projeto_atualizado', 'projeto_finalizado']) {
  conferir(tipos?.has(tipo), `notificação de ${tipo}`);
}

console.log('7. Filas no RabbitMQ (painel em http://localhost:15672)');
try {
  const filas = await ate(async () => {
    const { corpo } = await json(`${MQ}/api/queues`, { headers: autorizacaoMq });
    const pendentes = corpo.filter((f) => !f.exclusive && f.messages > 0 && !f.name.endsWith('.descartadas'));
    return pendentes.length === 0 ? corpo : undefined;
  });
  const duraveis = (filas ?? []).filter((f) => f.durable).map((f) => f.name);
  for (const nome of ['consulta-profissionais', 'consulta-projetos', 'eventos-projetos', 'eventos-recomendacao']) {
    conferir(duraveis.includes(nome), `fila durável ${nome}`);
  }
  // Pedidos que expiraram antes (um serviço fora do ar, por exemplo) ficam lá de propósito; aqui só contam os novos.
  const novas = Object.entries((await descartadas()) ?? {}).filter(([nome, n]) => n > (descartadasAntes[nome] ?? 0));
  conferir(novas.length === 0, `nenhuma mensagem nova nas filas de descartadas${novas.length ? `: ${novas.map(([n]) => n)}` : ''}`);
} catch {
  falha('painel do RabbitMQ indisponível em localhost:15672');
}

console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} verificação(ões) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
