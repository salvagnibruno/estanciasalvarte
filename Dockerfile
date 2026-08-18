FROM node:20-slim

# better-sqlite3 compila um binário nativo na instalação — build-essential e
# python3 garantem que isso funcione mesmo sem um binário pré-compilado para
# esta imagem específica.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
