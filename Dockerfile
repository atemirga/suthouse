# syntax=docker/dockerfile:1.7
# ───────────────── deps ─────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ───────────────── builder ─────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma client уже сгенерирован через postinstall на шаге deps,
# но повторим на случай отсутствия — копируем-перегенерируем для текущей платформы.
RUN npx prisma generate
RUN npm run build

# ───────────────── runner: web ─────────────────
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat tzdata && \
    cp /usr/share/zoneinfo/Asia/Almaty /etc/localtime && \
    echo "Asia/Almaty" > /etc/timezone
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000

RUN addgroup -S app && adduser -S app -G app

# standalone build — минимальный набор файлов для Next.js
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=app:app /app/node_modules/@prisma ./node_modules/@prisma

USER app
EXPOSE 3000
CMD ["node", "server.js"]

# ───────────────── runner: cron (отдельный таргет) ─────────────────
FROM node:20-alpine AS cron
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat tzdata && \
    cp /usr/share/zoneinfo/Asia/Almaty /etc/localtime && \
    echo "Asia/Almaty" > /etc/timezone
ENV NODE_ENV=production

# Для cron нужны исходники (tsx запускает .ts напрямую) и зависимости
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate

CMD ["node", "--env-file=.env", "--import", "tsx", "src/lib/cron.ts"]
