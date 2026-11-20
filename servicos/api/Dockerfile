# cinebridge-api. Construído a partir da raiz do repositório (npm workspaces):
#   docker build -f servicos/api/Dockerfile .
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
RUN npm ci --omit=dev --workspace=@cinebridge/api --ignore-scripts \
 && npm rebuild @prisma/engines \
 && npm cache clean --force

COPY tsconfig.base.json ./
COPY pacotes/comum pacotes/comum
COPY servicos/api servicos/api
WORKDIR /usr/src/app/servicos/api
RUN npx prisma generate

# Pasta do armazenamento local (ranking comprimido e arquivos), montada como volume pelo compose.
RUN mkdir -p armazenamento && chown node:node armazenamento

ENV PORT=3000
EXPOSE 3000
USER node

# Aplica as migrations do banco do serviço e sobe o servidor.
CMD ["npm", "run", "container"]
