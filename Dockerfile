# Tims Game Library – Node-Backend serviert die statischen Spiele, die REST-API
# (Login, Highscores) und den WebSocket für die Caterpillar-Online-Sessions.
FROM node:22-alpine

WORKDIR /app

# Nur Manifeste kopieren -> Layer-Cache für npm install
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]
