FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV POOL_BACKEND_ONLY=true

COPY package.json package-lock.json ./
COPY deploy/artifacts/doppler-gpu-0.6.2.tgz /tmp/doppler-gpu-0.6.2.tgz
RUN node --input-type=module -e "import fs from 'node:fs'; import crypto from 'node:crypto'; const pin=JSON.parse(fs.readFileSync('package-lock.json')).packages['node_modules/doppler-gpu']; if ('sha512-'+crypto.createHash('sha512').update(fs.readFileSync('/tmp/doppler-gpu-0.6.2.tgz')).digest('base64')!==pin.integrity) throw Error('Doppler archive integrity mismatch');" \
    && npm cache add /tmp/doppler-gpu-0.6.2.tgz --ignore-scripts \
    && npm ci --prefer-offline --omit=dev --include=optional --ignore-scripts

COPY Dockerfile ./Dockerfile
COPY server ./server
COPY self ./self

EXPOSE 8080
CMD ["node", "server/proxy.js"]
