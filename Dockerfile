# Dockerfile -- realcode engine
# Runs the Node.js engine that processes the dispatch loop.
# The sandbox runner uses Docker-in-Docker (docker.sock mounted) for stage-run isolation.

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY agent-specs/ ./agent-specs/
COPY stage-graph.yaml ./
COPY schemas/ ./schemas/

RUN npm run build

RUN npm prune --omit=dev && rm -rf src node_modules/.cache

RUN mkdir -p /data

ENV REALCODE_DATA_DIR=/data
ENV REALCODE_GRAPH=/app/stage-graph.yaml

CMD ["node", "dist/engine-loop.js"]
