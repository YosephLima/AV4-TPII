# cinebridge-projetos. Construído a partir da raiz do repositório (npm workspaces):
#   docker build -f servicos/projetos/Dockerfile .
# Node 24 em vez do 18 do enunciado: o 18 não tem mais suporte e o Prisma 7 e o Fastify 5 não rodam nele (docs/AV4.md).
FROM node:24-alpine

# curl para o healthcheck do docker compose.
RUN apk add --no-cache curl

WORKDIR /usr/src/app

# Primeiro só os manifestos: enquanto as dependências não mudam, o Docker reaproveita a camada do npm ci.
COPY package.json package-lock.json ./
COPY pacotes/comum/package.json pacotes/comum/
COPY servicos/api/package.json servicos/api/
COPY servicos/profissionais/package.json servicos/profissionais/
COPY servicos/projetos/package.json servicos/projetos/
COPY servicos/notificacoes/package.json servicos/notificacoes/
# Só as dependências deste serviço e do pacote comum, sem as de desenvolvimento. O motor de migrations do
# Prisma é baixado aqui, no build, e não na partida do container.
RUN npm ci --omit=dev --workspace=@cinebridge/projetos --ignore-scripts \
 && npm rebuild @prisma/engines \
 && npm cache clean --force

COPY tsconfig.base.json ./
COPY pacotes/comum pacotes/comum
COPY servicos/projetos servicos/projetos
WORKDIR /usr/src/app/servicos/projetos
RUN npx prisma generate

ENV PORT=3002
EXPOSE 3002
USER node

# Aplica as migrations do banco do serviço e sobe o servidor.
CMD ["npm", "run", "container"]
