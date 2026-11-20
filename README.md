# cinebridge: plataforma em microsserviços (AV4)

O produtor descreve um projeto audiovisual (tipo, orçamento, data de entrega e os serviços de que precisa) e a plataforma devolve a equipe recomendada, com um profissional para cada papel técnico e alternativas para cada um. O produtor responde aos convites, troca quem quiser e, com a equipe formada, acompanha o projeto até a finalização. Produtor e profissionais recebem e-mails e mensagens internas a cada passo.

## O que a AV4 acrescentou

- **Quatro microsserviços em containers:** recomendação (a api), profissionais, projetos e notificações, cada um com o seu banco PostgreSQL.
- **Comunicação pelo RabbitMQ:** nenhum serviço chama outro por HTTP. A api consulta profissionais e projetos por filas de pedido e resposta, e os eventos (recomendação gerada, convite aceito, projeto finalizado...) chegam ao serviço de notificações por filas de eventos.
- **Fluxo completo do produtor:** responder convites, substituir um membro e pedir reavaliação, inclusive entre requisições, porque o projeto agora fica guardado no serviço de projetos.
- **Saúde e resiliência:** `/health` em todos os serviços, verificando banco e broker; os serviços se recuperam sozinhos se o RabbitMQ cair.

A arquitetura, os contratos das filas e as decisões em relação ao enunciado estão em [`docs/AV4.md`](docs/AV4.md). O diagrama de implantação está em [`diagramas/diagrama-av4.puml`](diagramas/diagrama-av4.puml).

## Padrões aplicados

| Padrão | Etapa | Para que serve aqui | Onde |
|---|---|---|---|
| Strategy | AV1 | Algoritmos de recomendação intercambiáveis | `servicos/api/src/estrategias/` |
| Template Method | AV1 | Etapas fixas da montagem da equipe | `servicos/api/src/orquestracao/` |
| Observer | AV1, AV4 | Eventos da recomendação; na AV4, os alertas disparados a partir das filas | `servicos/api/src/observadores/`, `servicos/notificacoes/src/` |
| Visitor | AV1 | Validação, compatibilidade e relatório | `servicos/api/src/visitantes/` |
| Prototype | AV2 | Projetos criados a partir de modelos prontos | `servicos/api/src/prototipos/` |
| Factory Method e Abstract Factory | AV2 | Cada tipo de projeto cria a sua família de componentes | `servicos/api/src/fabricas/` |
| Adapter | AV3, AV4 | Provedores externos; na AV4, o serviço de profissionais visto pela fila | `servicos/api/src/adaptadores/` |
| Composite | AV3 | Projeto como árvore de pacotes e serviços | `servicos/api/src/servicos/` |
| Decorator | AV3 | Cache, auditoria e compressão em volta da recomendação | `servicos/api/src/decoradores/` |

## Como executar

Requisitos: **Docker Desktop** no Windows 10 ou superior, ou **Docker Engine com o plugin Compose** no Ubuntu 24.04 ou superior (e derivados). Confira com:

```bash
docker --version
docker compose version
```

Na raiz do repositório:

```bash
docker compose up -d --build     # constrói as imagens e sobe os 9 containers em segundo plano
docker compose ps                # todos devem aparecer como healthy (leva cerca de 1 minuto)
docker compose logs -f           # acompanha os logs (Ctrl+C para sair)
```

Na primeira subida, cada serviço aplica as migrations do seu banco, e o de profissionais cadastra os profissionais de demonstração.

| Endereço | O quê |
|---|---|
| http://localhost:3000 | cinebridge-api (ponto de entrada) |
| http://localhost:3001 | cinebridge-profissionais |
| http://localhost:3002 | cinebridge-projetos |
| http://localhost:3003 | cinebridge-notificacoes |
| http://localhost:15672 | Painel do RabbitMQ (usuário `guest`, senha `guest`): filas, taxas de entrega, mensagens descartadas |
| localhost:5432 a 5435 | Bancos de profissionais, projetos, recomendações e notificações (usuário e senha `cinebridge`) |

Para parar: `docker compose down` (mantém os dados) ou `docker compose down -v` (apaga os bancos e as filas).

### Teste de ponta a ponta

Com a plataforma no ar e o Node.js 24 instalado:

```bash
npm run e2e
```

Ele confere a saúde dos quatro serviços e percorre o fluxo inteiro: recomendação, recusa e aceite dos convites, projeto registrado e finalizado no serviço de projetos, as notificações de cada etapa e o estado das filas no RabbitMQ. Sem o npm, `node scripts/e2e.mjs` faz o mesmo.

## Endpoints

### cinebridge-api (3000)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Saúde: banco e RabbitMQ |
| GET | `/profissionais` | Profissionais da fonte configurada (por padrão, o serviço de profissionais) |
| GET | `/modelos` | Tipos de projeto e modelos disponíveis em cada um |
| POST | `/recomendacoes` | Cria o projeto, devolve a equipe recomendada e registra o projeto no serviço de projetos |
| GET | `/recomendacoes/:id` | Situação atual da recomendação de um projeto |
| POST | `/projetos/:id/convites` | Resposta de um profissional ao convite: `{ "papel": "EDITOR", "aceito": true }`. Uma recusa já escolhe outro profissional |
| POST | `/projetos/:id/substituicoes` | Troca o profissional de um papel: `{ "papel": "EDITOR" }` |
| POST | `/projetos/:id/reavaliacao` | Refaz a equipe inteira, opcionalmente com `{ "orcamento": 150000, "prazo": "2027-06-30" }` |

### Outros serviços

| Serviço | Método | Rota | Descrição |
|---|---|---|---|
| profissionais (3001) | GET | `/profissionais?papel=EDITOR&localizacao=São Paulo` | Cadastro, com filtros opcionais |
| profissionais (3001) | GET | `/profissionais/:id` | Um profissional, com competências e avaliações |
| projetos (3002) | GET | `/projetos?status=equipe_formada&produtor=...` | Projetos, com filtros opcionais |
| projetos (3002) | GET | `/projetos/:id` | Um projeto, com a situação e a composição final da equipe |
| projetos (3002) | POST | `/projetos/:id/finalizar` | Encerra a produção: `{ "metricas": { "espectadores": 1500 }, "resultados": "..." }`. Exige equipe formada |
| notificações (3003) | GET | `/notificacoes?projetoId=...&destinatario=...&canal=email` | Alertas já enviados |

Todos têm `GET /health`.

### O que enviar em `POST /recomendacoes`

Só `tipo`, `nome` e `produtor` são obrigatórios. O resto vem de um modelo pronto do tipo (`modelo`, padrão `padrao`; veja `GET /modelos`) e pode ser ajustado:

- **`orcamento`, `prazo`, `localizacao`, `genero`, `duracao`:** ajustes do projeto.
- **`detalhes`:** o que é próprio do tipo (tema e entrevistados no documentário, técnica e quadros por segundo na animação, cliente e veiculação na publicidade).
- **`servico`:** a árvore de serviços do projeto, se você não quiser a do modelo. Um pacote tem `servicos`; um serviço tem `papel`, `custo`, `prazo` e, se quiser, `competencias`.
- **`estrategia`:** outro algoritmo de recomendação (`cosseno`, `colaborativa` ou `orcamento`).
- **`decoradores`:** os recursos que o produtor quer só para este projeto, como `["auditoria", "cache"]`.

Se o projeto não atender às regras do seu tipo, a resposta é `422`, com a lista de `motivos`.

### Um fluxo completo com curl

No Linux, ou com `curl.exe` no PowerShell:

```bash
curl -X POST http://localhost:3000/recomendacoes -H "content-type: application/json" -d @exemplos/documentario.json
# guarde o projetoId da resposta e os papéis da equipe
curl -X POST http://localhost:3000/projetos/<projetoId>/convites -H "content-type: application/json" -d "{\"papel\":\"EDITOR\",\"aceito\":false}"
curl -X POST http://localhost:3000/projetos/<projetoId>/convites -H "content-type: application/json" -d "{\"papel\":\"EDITOR\",\"aceito\":true}"
# ... aceite os demais papéis; com todos aceitos, a equipe é formada
curl http://localhost:3002/projetos/<projetoId>
curl -X POST http://localhost:3002/projetos/<projetoId>/finalizar -H "content-type: application/json" -d "{\"resultados\":\"Estreia em festival\"}"
curl "http://localhost:3003/notificacoes?projetoId=<projetoId>"
```

Outros pedidos prontos estão em `exemplos/` (`animacao.json`, `ficcao-pilha.json`, `publicitario-modelo.json`).

### Com Postman, Insomnia ou Thunder Client

O arquivo `exemplos/cinebridge.postman_collection.json` traz todas as requisições, dos quatro serviços, inclusive o fluxo do produtor e dois exemplos de erro. No Postman, cada recomendação guarda o `projetoId` e o primeiro papel da equipe (`papel`), que as requisições seguintes usam; nas outras ferramentas, preencha essas variáveis à mão.

| Ferramenta | Como importar |
|---|---|
| Postman | botão **Import** e escolher o arquivo |
| Insomnia | **Import** na tela do projeto, opção de arquivo, e escolher o arquivo |
| Thunder Client (VS Code) | aba **Collections**, menu da aba, **Import** e escolher o arquivo |

## Configuração

Cada serviço lê o seu `servicos/<serviço>/.env`, e cada banco o seu `servicos/<serviço>/banco.env`. Os nomes de host (`cinebridge-mq`, `profissionais-db`...) são os serviços do compose, resolvidos na rede `cinebridge-net`.

| Variável | Serviços | Uso |
|---|---|---|
| `PORT` | todos | Porta HTTP |
| `DATABASE_URL` | todos | Banco do serviço |
| `RABBITMQ_URL` | todos | Conexão AMQP, por exemplo `amqp://guest:guest@cinebridge-mq:5672` |
| `RPC_TEMPO_LIMITE_MS` | api | Quanto esperar a resposta de outro serviço antes de responder 503 (padrão 5000) |
| `PROFISSIONAIS` | api | `fila` (o serviço de profissionais, padrão com broker), `interno` (memória) ou `linkedin` (simulado) |
| `ARMAZENAMENTO`, `ARMAZENAMENTO_DIR` | api | Onde guardar o ranking comprimido: `local` (volume `api-arquivos`), `s3` ou `gcs` (simulados) |
| `PAGAMENTO` | api | `stripe` ou `pagseguro` (simulados) |
| `DECORADORES`, `NIVEL_COMPRESSAO` | api | Pilha de decoradores, de fora para dentro, e nível do gzip |

Um valor inválido impede o serviço de subir, com uma mensagem dizendo os valores aceitos. Depois de mudar um `.env`, recrie o container: `docker compose up -d`.

## Desenvolvimento

Com o Node.js 24 ou superior:

```bash
npm install          # instala todos os pacotes do monorepo e gera os clientes do Prisma
npm test             # testes de todos os pacotes (não precisam de Docker)
npm run typecheck
```

Sem `RABBITMQ_URL` e `DATABASE_URL`, a api roda sozinha, como na AV3, com profissionais e projetos em memória:

```bash
cd servicos/api
RABBITMQ_URL= DATABASE_URL= PROFISSIONAIS=interno npm start
```

No PowerShell: `$env:RABBITMQ_URL=''; $env:DATABASE_URL=''; $env:PROFISSIONAIS='interno'; npm start`.

## Compatibilidade

- **Com Docker,** todos os serviços rodam no mesmo ambiente Linux em qualquer sistema. No Windows 10 ou superior, basta o Docker Desktop (com WSL 2).
- **Sem Docker,** só os testes e a api sozinha, com o Node.js 24 ou superior. Os scripts não usam sintaxe exclusiva de um shell (o e2e é Node puro), o fim de linha é fixado em LF e os caminhos funcionam igual no Windows e no Linux.
- Testado no Ubuntu. No Windows não foi testado.

## Estrutura

```
pacotes/comum/              mensageria (RabbitMQ e versão em memória), RPC, eventos, contratos das filas, /health
servicos/api/               cinebridge-api: o código das AVs 1 a 3, o fluxo do produtor e a ponte com as filas
servicos/profissionais/     cinebridge-profissionais
servicos/projetos/          cinebridge-projetos
servicos/notificacoes/      cinebridge-notificacoes
  cada serviço: src/, tests/, prisma/ (schema e migrations), Dockerfile, .env, banco.env
docker-compose.yml          os 9 containers, a rede cinebridge-net e os volumes
scripts/e2e.mjs             teste de ponta a ponta
docs/                       decisões de projeto (AV3 e AV4)
diagramas/                  diagramas de classes (AV2, AV3) e de implantação (AV4)
exemplos/                   pedidos prontos e coleção do Postman
```
