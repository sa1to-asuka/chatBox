FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm server:build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=build /app/dist ./dist
COPY --from=build /app/build ./build
RUN mkdir -p /app/data/attachments && chown -R node:node /app/data
USER node
EXPOSE 3006
CMD ["node", "build/server/index.js"]
