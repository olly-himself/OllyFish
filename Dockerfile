FROM mcr.microsoft.com/playwright:v1.52.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY scraper.js server.js ./

EXPOSE 3000
CMD ["node", "server.js"]
