FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV POOL_BACKEND_ONLY=true

COPY package.json package-lock.json ./
COPY deploy/artifacts/dopplerx-0.1.5.tgz /tmp/dopplerx-0.1.5.tgz
RUN node --input-type=module -e "import fs from 'node:fs'; import crypto from 'node:crypto'; const pin=JSON.parse(fs.readFileSync('package-lock.json')).packages['node_modules/dopplerx']; if ('sha512-'+crypto.createHash('sha512').update(fs.readFileSync('/tmp/dopplerx-0.1.5.tgz')).digest('base64')!==pin.integrity) throw Error('Doppler archive integrity mismatch');" \
    && npm cache add /tmp/dopplerx-0.1.5.tgz --ignore-scripts \
    && npm ci --prefer-offline --omit=dev --include=optional --ignore-scripts

COPY deploy/Dockerfile ./deploy/Dockerfile
COPY server ./server
COPY self ./self
COPY shared ./shared
COPY apps/poolday ./apps/poolday
COPY packages/reploid/package.json ./packages/reploid/package.json
COPY packages/reploid/src ./packages/reploid/src

EXPOSE 8080
CMD ["node", "server/proxy.js"]
