# AV4: containerização e decisões de projeto

Este documento complementa o [README](../README.md), que explica como subir e usar a plataforma. Aqui ficam os fundamentos que justificam a containerização, a arquitetura dos serviços, os contratos das filas e as decisões tomadas onde o enunciado deixava espaço.

O diagrama de implantação está em [`diagramas/diagrama-av4.puml`](../diagramas/diagrama-av4.puml). A análise da AV3 continua em [`docs/AV3.md`](AV3.md).

## Fundamentos

### Container ou máquina virtual

| | Máquina virtual | Container |
|---|---|---|
| O que é virtualizado | O hardware: cada VM roda um sistema operacional completo | O sistema operacional: os containers compartilham o kernel do hospedeiro |
| Isolamento | Completo, inclusive de kernel | De processos, sistema de arquivos e rede |
| Partida | Dezenas de segundos | Segundos ou menos |
| Peso | Gigabytes por instância | Megabytes por instância |
| Quando usar | Kernels ou sistemas diferentes, isolamento forte | Vários serviços sobre o mesmo kernel, como aqui |

Os cinco serviços da cinebridge (quatro em Node.js mais o RabbitMQ) e os quatro bancos rodam todos sobre Linux. Não há motivo para pagar o custo de nove sistemas operacionais completos, e a partida rápida permite que o Docker reinicie um serviço caído em poucos segundos, o que a seção de resiliência usa.

### Por que Docker

Docker (e o Moby, a versão aberta, sob licença Apache 2.0) é a escolha por três motivos práticos:

- **Compatibilidade pedida:** o Docker Desktop roda no Windows 10 ou superior com WSL 2, e o Docker Engine com o plugin Compose roda no Ubuntu 24.04. É o mesmo `docker-compose.yml` nos dois.
- **Imagens oficiais:** `postgres:15-alpine` e `rabbitmq:3-management-alpine` vêm prontas do Docker Hub.
- **Saúde e ordem de partida no Compose:** `healthcheck` e `depends_on: condition: service_healthy` resolvem a ordem de subida sem scripts de espera.

As alternativas livres continuam viáveis, porque nada aqui depende de recurso exclusivo do Docker:

| Alternativa | O que muda |
|---|---|
| Podman | Sem daemon, roda sem root. `podman compose` lê o mesmo arquivo |
| containerd com nerdctl | `nerdctl compose up -d` aceita o mesmo arquivo |
| Rancher Desktop | Interface gráfica com containerd e nerdctl, mais um Kubernetes local |

Só o Docker foi testado.

## Arquitetura

| Container | Porta | Banco (porta no host) | Responsabilidade |
|---|---|---|---|
| `cinebridge-api` | 3000 | `recomendacoes-db` (5434) | Recomendação e orquestração (todo o código das AVs 1 a 3); fluxo do produtor |
| `cinebridge-profissionais` | 3001 | `profissionais-db` (5432) | Cadastro de profissionais, competências e avaliações; atende `consulta-profissionais` |
| `cinebridge-projetos` | 3002 | `projetos-db` (5433) | Ciclo de vida dos projetos, fonte de verdade deles; atende `consulta-projetos` e publica `eventos-projetos` |
| `cinebridge-notificacoes` | 3003 | `notificacoes-db` (5435) | E-mails e mensagens internas; consome `eventos-recomendacao` e `eventos-projetos` |
| `cinebridge-mq` | 5672, 15672 | | RabbitMQ: barramento entre os serviços e painel de gerenciamento |

Dentro da rede `cinebridge-net`, cada banco responde em `<nome>:5432`; as portas 5432 a 5435 são só os mapeamentos no host, para inspecionar os bancos de fora.

**Nenhum serviço chama outro por HTTP.** As rotas HTTP dos serviços internos servem para o produtor (finalizar um projeto) e para conferência; a conversa entre eles passa sempre pelo RabbitMQ.

### Organização do código

O repositório é um monorepo com npm workspaces:

```
pacotes/comum/          mensageria (RabbitMQ e versão em memória), RPC, eventos, contratos, /health
servicos/api/           o código da AV3, mais a ponte com as filas
servicos/profissionais/
servicos/projetos/
servicos/notificacoes/
```

Cada serviço declara só as suas dependências e o `pacotes/comum`. Assim a infraestrutura de mensageria existe uma vez só, e um serviço não consegue importar o código de outro por engano: a fronteira entre domínios é imposta pelos `package.json`. Os contratos das filas (formatos e nomes de operação) ficam em `pacotes/comum/src/contratos/`, tipados, e quem publica e quem consome usam o mesmo tipo.

## Filas e contratos

| Fila | Estilo | Publica | Consome | Origem |
|---|---|---|---|---|
| `consulta-profissionais` | RPC | api | profissionais | Enunciado |
| `consulta-projetos` | RPC | api | projetos | Decisão nossa (lacuna) |
| `eventos-projetos` | Evento | projetos | notificações | Enunciado |
| `eventos-recomendacao` | Evento | api | notificações | Decisão nossa (lacuna) |
| `amq.gen-*` | Respostas | profissionais e projetos | api | Fila exclusiva da api, com nome gerado pelo broker |
| `<fila>.descartadas` | DLQ | o próprio RabbitMQ | ninguém (inspeção no painel) | Mensagens recusadas ou pedidos expirados |

### RPC (pedido e resposta)

```
pedido   { operacao: "listar", dados: { papeis: ["EDITOR"] } }
         propriedades: replyTo = fila de respostas da api, correlationId = uuid, expiration = 5000
resposta { ok: true, dados: [...] }
      ou { ok: false, erro: { codigo: "PROFISSIONAL_NAO_ENCONTRADO", mensagem: "..." } }
```

| Fila | Operações |
|---|---|
| `consulta-profissionais` | `listar` (critérios: papéis, localização), `detalhar` (id), `avaliar` (id e avaliação) |
| `consulta-projetos` | `registrar` (idempotente), `buscar`, `formarEquipe`, `reabrir` |

Erros de negócio atravessam a fila com o código (`PROFISSIONAL_NAO_ENCONTRADO`, `PROJETO_NAO_ENCONTRADO`, `TRANSICAO_INVALIDA`), e a api os traduz em 404, 409 e assim por diante. Um erro inesperado volta como `ERRO_INTERNO`, sem a mensagem original, para não vazar detalhes internos.

### Eventos

```
{ id: uuid, tipo: "projeto_finalizado", origem: "cinebridge-projetos", ocorridoEm: ISO 8601, dados: { ... } }
```

| Fila | Tipos |
|---|---|
| `eventos-projetos` | `projeto_criado`, `projeto_atualizado` (com `motivo`: `dados`, `equipe_formada` ou `reavaliacao`), `projeto_finalizado` |
| `eventos-recomendacao` | Os seis eventos do Observer da AV1 (`recomendacao_gerada`, `membro_substituido`, `convite_aceito`, `convite_recusado`, `reavaliacao_solicitada`, `equipe_formada`) e `convite_enviado` |

O `id` do evento permite descartar uma entrega repetida: o serviço de notificações tem uma chave única por evento, canal e destinatário, e um evento entregue duas vezes não gera alerta repetido.

### Observer no serviço de notificações

Cada fila de eventos tem um `ConsumidorEventos` (o sujeito), com observadores inscritos que declaram os tipos que lhes interessam:

| Observador | Fila | O que envia |
|---|---|---|
| `NotificadorEmail` | `eventos-recomendacao` | E-mail ao produtor: respostas aos convites, equipe formada |
| `NotificadorInterno` | `eventos-recomendacao` | Mensagem interna a cada profissional envolvido e ao produtor |
| `EntregadorConvites` | `eventos-recomendacao` | O convite redigido pela api, ao profissional |
| `NotificadorProjetos` | `eventos-projetos` | E-mail ao produtor sobre o projeto, com métricas e resultados na finalização |

Os dois primeiros vieram da api, onde eram observadores em memória desde a AV1. Um tipo novo de alerta é mais um observador inscrito em `consumidores.ts`. Se um observador falha, os outros recebem o evento mesmo assim, e a mensagem vai para a fila de descartadas, visível no painel.

## Da AV3 para os microsserviços

A AV3 já tinha isolado, atrás de interfaces, exatamente o que agora atravessa a rede. Por isso o `SistemaRecomendacao`, o orquestrador, as estratégias, as fábricas, os decoradores e a árvore de serviços não mudaram para a AV4.

| Peça da AV3 | Na AV4 |
|---|---|
| `AdaptadorProfissional` (Adapter) | Novo `AdaptadorFila`: cada método vira um pedido em `consulta-profissionais` e a resposta é traduzida para o domínio. Escolhido por `PROFISSIONAIS=fila`, ao lado de `interno` e `linkedin` |
| `BarramentoEventos` | Novo `BarramentoRabbitMQ`: publica cada evento em `eventos-recomendacao`. O comentário do barramento já previa essa troca desde a AV1 |
| `NotificadorEmail`, `NotificadorInterno` | Foram para o serviço de notificações. Na api ficou só a auditoria |
| Notificadores das famílias (Abstract Factory da AV2) | Continuam na api, porque o texto depende do tipo do projeto (o tema do documentário, a técnica da animação). O e-mail que eles montam sai como `convite_enviado` |
| Cadastro de profissionais (Prisma, migration, seed) | Foi para o serviço de profissionais, dono do `profissionais-db`. Os dados de demonstração estão no `pacotes/comum`, usados pelo seed e pelo modo em memória da api |
| `ArquivoRecomendacoes` (armazenamento) | Ganhou a interface `Arquivo` e a versão `ArquivoPostgres` (`recomendacoes-db`), com o histórico de cada mudança na equipe |
| Projeto só em memória | O serviço de projetos guarda o projeto; a api o recria a cada requisição (próxima seção) |

### O fluxo do produtor entre requisições

Desde a AV2 estavam pendentes as rotas de convite, substituição e reavaliação, porque elas exigem guardar o projeto. Na AV4:

1. `POST /recomendacoes` recomenda e, só então, registra o projeto em `consulta-projetos`, com o pedido original (`solicitacao`). Um pedido recusado na validação (422) não deixa projeto órfão.
2. Nas rotas do produtor, o `FluxoProdutor` busca o projeto no serviço de projetos e o recria pela fábrica do tipo, com o mesmo id e a mesma árvore de serviços (Prototype e Composite). A equipe volta do `recomendacoes-db`, com confirmações, pagamentos, alternativas e substituídos.
3. Com todos os convites aceitos, a composição final vai para o serviço de projetos (`formarEquipe`), como a AV1 já previa: "após a formação consensual da equipe, o microsserviço deve registrar a composição final e disparar eventos para outros microsserviços, como o de gerenciamento de projetos".

O `FluxoProdutor` é uma classe nova, em vez de mais métodos no `SistemaRecomendacao`, para não reabrir o problema de Blob apontado na análise da AV3.

### Ciclo de vida do projeto

```
em_formacao ──(todos aceitaram)──> equipe_formada ──(POST /projetos/:id/finalizar)──> finalizado
     ^                                   │
     └────────(reavaliação)──────────────┘
```

| Transição | Quem provoca | Evento |
|---|---|---|
| Registro | api, ao recomendar | `projeto_criado` |
| Equipe formada | api, quando o último convite é aceito | `projeto_atualizado` (`equipe_formada`) |
| Reavaliação | produtor, `POST /projetos/:id/reavaliacao` na api | `projeto_atualizado` (`reavaliacao`) |
| Finalização | produtor, `POST /projetos/:id/finalizar` no serviço de projetos, com métricas e resultados | `projeto_finalizado` |

"Finalizado" não acontece quando a equipe é formada: o enunciado diz que o serviço de projetos guarda o projeto "até o armazenamento de suas métricas e resultados", e isso só existe depois da produção. Com a equipe formada, convites e substituições são recusados (409) e a api sugere a reavaliação. Um projeto finalizado não aceita mais mudanças.

## Resiliência

| Situação | O que acontece |
|---|---|
| RabbitMQ ainda subindo | Cada serviço tenta conectar até 30 vezes, a cada 2 s. O compose também só sobe os serviços com o broker saudável |
| RabbitMQ cai com tudo rodando | O serviço encerra (`process.exit(1)`), o Docker o reinicia (`restart: unless-stopped`) e ele volta com conexão, filas e consumidores refeitos. Testado com `docker restart cinebridge-mq`: os quatro serviços reiniciaram uma vez e voltaram saudáveis em cerca de 20 s |
| Serviço de notificações parado | Os eventos esperam na fila (durável, mensagens persistentes) e são entregues quando ele volta. Testado parando o container durante uma recomendação |
| Serviço de profissionais parado | A api espera 5 s (`RPC_TEMPO_LIMITE_MS`) e responde 503, sem travar. O pedido expira e vai para `consulta-profissionais.descartadas`, onde o painel mostra o motivo `expired` |
| Mensagem que sempre falha | `nack` sem devolver à fila: vai para a fila de descartadas em vez de voltar sem fim |
| Mensagem repetida | `registrar` e `formarEquipe` são idempotentes, e as notificações têm chave única por evento |
| Publicação | Canal com confirmação do broker (publisher confirms): o envio só é dado como feito quando o RabbitMQ confirma |
| Consumo | Ack manual depois do processamento, com `prefetch` 10 |

Os health checks (`GET /health`) de cada serviço verificam o banco (`SELECT 1`) e a conexão com o RabbitMQ, cada um com tempo limite de 2 s, e respondem 503 apontando o que falhou. O compose os chama com `curl -f`, e os bancos com `pg_isready`.

## Decisões em relação ao enunciado

| Enunciado | O que foi feito | Por quê |
|---|---|---|
| Imagem `node:18-alpine` | `node:24-alpine` | O Node 18 está sem suporte desde abril de 2025, e a base das AVs anteriores não roda nele: o Prisma 7 exige Node 20.19 ou superior, o Fastify 5 exige Node 20 e o Vitest 5 exige 22.12. Seguir à risca obrigaria a voltar para versões antigas dessas bibliotecas |
| `postgres:15-alpine`, `rabbitmq:3-management-alpine` | Como pedido | |
| `npm install`, `npm start` ou `node dist/main.js` | `npm ci` (instalação reproduzível pelo lock) e `npm start` com tsx | O `npm ci` é a forma indicada para builds. Compilar para `dist/` obrigaria a reescrever todos os imports das AVs anteriores com extensão `.js` |
| Copiar `package.json` e `package-lock.json` do serviço | O lock é um só, na raiz do monorepo; o Dockerfile copia o lock e os manifestos e instala só as dependências do serviço (`npm ci --workspace`) | É como o npm organiza um monorepo; a imagem continua com as dependências de um serviço só |
| `.env` para cada serviço | `servicos/<serviço>/.env` (configuração do serviço) e `banco.env` (usuário e senha do banco dele), lidos pelo `env_file` do compose e versionados | As credenciais são só de desenvolvimento, e versionar os arquivos faz o `docker compose up` funcionar logo depois do clone. Em produção, viriam de um cofre de segredos |
| Fila de retorno "pode ser nomeada dinamicamente para cada requisição" | Uma fila de respostas exclusiva por processo da api, com o `correlationId` ligando cada resposta ao seu pedido | É a forma recomendada pela documentação do RabbitMQ e evita criar e apagar uma fila a cada consulta. O enunciado deixa a escolha em aberto ("pode ser") |
| Rede `cinebridge-net` interna, do tipo bridge | Bridge comum, sem `internal: true` | `internal: true` impediria o acesso à api e ao painel a partir do host. O isolamento vem de só a rede do compose enxergar os nomes dos serviços |
| `docker-compose up -d` | `docker compose up -d` (Compose v2) | O `docker-compose` v1 foi descontinuado; o v2 vem com o Docker Desktop e com o plugin do Docker Engine |
| Credenciais `guest/guest` | Como pedido, no painel e nas conexões AMQP | Ambiente de desenvolvimento; em produção, um usuário próprio em `RABBITMQ_URL` |
| Endpoint `/health` | Em todos os serviços; o `/saude` da AV3 foi substituído | |
| Seta tracejada api para projetos, sem fila definida | Fila RPC `consulta-projetos` | O diagrama diz "consulta", e a api precisa ler o projeto de volta. Com eventos sem resposta, a api teria que guardar o projeto também, duplicando a fonte de verdade |
| Notificações "acionadas sempre que eventos relevantes ocorrem, como a geração de uma recomendação ou a aceitação de um convite" | Fila `eventos-recomendacao`, da api para notificações | Os dois exemplos do texto nascem na api, não no serviço de projetos. Passar por ele o obrigaria a entender eventos que não são do seu domínio |
| Formato das mensagens | Envelopes acima, tipados no `pacotes/comum` | Não especificado |

## Limitações conhecidas

- **Gravar e publicar não são atômicos.** O serviço de projetos grava e depois publica; se o broker cair exatamente entre os dois, o evento se perde. A solução completa seria o padrão outbox (gravar o evento na mesma transação e publicar depois), que ficou fora do escopo.
- **Publicação de eventos da api sem espera.** A interface `BarramentoEventos` é síncrona desde a AV1; o `BarramentoRabbitMQ` publica e registra no log uma eventual falha de confirmação, sem refazer a operação do produtor.
- **Provedores simulados em memória.** Como na AV3, S3, Google Cloud, Stripe, PagSeguro e LinkedIn são simulados dentro da api; os pagamentos simulados não sobrevivem a um reinício dela.
- **Windows não testado.** Os scripts não dependem de shell (o e2e é Node puro), o fim de linha é fixado em LF e o compose não usa caminhos absolutos, mas os testes foram feitos só no Ubuntu.

## Testes

| Pacote | Testes | O que cobrem |
|---|---|---|
| `pacotes/comum` | 18 | RPC (respostas cruzadas, erros, tempo limite, expiração), eventos e Observer, fila de descartadas, /health |
| `servicos/api` | 154 | Os testes das AVs 1 a 3, o fluxo do produtor pelas rotas e a api ligada às filas (com dublês que seguem os contratos) |
| `servicos/profissionais` | 6, mais 2 com banco | Fila `consulta-profissionais`, rotas e, com `DATABASE_URL`, o cadastro no PostgreSQL |
| `servicos/projetos` | 7 | Ciclo de vida, idempotência, transições inválidas, eventos publicados, rotas |
| `servicos/notificacoes` | 7 | Cada observador, entrega repetida, eventos desconhecidos, rotas |

Os testes rodam sobre o `TransporteMemoria`, um broker em memória que reproduz o que importa do RabbitMQ (fila inexistente perde a mensagem, fila sem consumidor acumula, falha vai para as descartadas). O `npm run e2e` junta tudo com a plataforma no ar: saúde dos quatro serviços, recomendação, recusa e aceite de convites, projeto registrado e finalizado, as oito notificações esperadas e o estado das filas no RabbitMQ.
