# Co(de)Gedanken Web Hub
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY web-hub/package.json web-hub/
COPY extension/package.json extension/
RUN npm ci --no-audit --no-fund
COPY shared shared
COPY web-hub web-hub
RUN npm run build -w shared && npm run build -w web-hub && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/codegedanken.db
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/web-hub/package.json web-hub/
COPY --from=build /app/web-hub/dist web-hub/dist
COPY --from=build /app/web-hub/public web-hub/public
# Mount a persistent volume at /data (Railway: service → Volumes; Docker: -v cg-data:/data).
# Railway volumes are root-owned, so the process runs as root inside the container.
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "web-hub/dist/server.js"]
