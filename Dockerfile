FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV POOL_BACKEND_ONLY=true

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --include=optional --ignore-scripts

COPY Dockerfile ./Dockerfile
COPY server ./server
COPY self ./self

EXPOSE 8080
CMD ["node", "server/proxy.js"]
