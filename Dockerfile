FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
ARG APP_UID=1000
ARG APP_GID=1000
ENV NODE_ENV=production PORT=3000 CACHE_DB_PATH=/data/previews.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
RUN case "$APP_UID" in ''|*[!0-9]*) exit 1;; esac \
    && case "$APP_GID" in ''|*[!0-9]*) exit 1;; esac \
    && mkdir /data && chown "$APP_UID:$APP_GID" /data
COPY --from=build /app/dist ./dist
COPY public ./public
USER ${APP_UID}:${APP_GID}
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
