FROM node:26.7.0-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --audit=false --fund=false \
    && npm cache clean --force
COPY server.js launcher.js ./
USER node
CMD ["node","launcher.js"]
