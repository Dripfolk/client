FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src/ ./src/
COPY public/ ./public/

EXPOSE 8090

CMD ["npx", "vite", "--host", "0.0.0.0"]
