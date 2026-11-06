# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

# Native Stockfish for the server's challenge analysis, about twice as fast as
# the WASM build. The official "universal" binary picks the fastest code its
# CPU supports at startup; it needs glibc 2.35+, hence a Debian runtime image.
FROM debian:bookworm-slim AS engine
ADD --checksum=sha256:9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f \
  https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-x86-64-universal.tar.gz /tmp/stockfish.tar.gz
RUN tar -xzf /tmp/stockfish.tar.gz -C /tmp stockfish/stockfish-linux-x86-64-universal stockfish/Copying.txt

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV DATA_DIR=/data
ENV STOCKFISH_PATH=/usr/local/bin/stockfish
COPY --from=engine /tmp/stockfish/stockfish-linux-x86-64-universal /usr/local/bin/stockfish
COPY --from=engine /tmp/stockfish/Copying.txt /usr/local/share/doc/stockfish/Copying.txt
# Fails the build if the engine can't run on this image.
RUN printf 'uci\nquit\n' | stockfish | grep -q uciok
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "server.ts"]
