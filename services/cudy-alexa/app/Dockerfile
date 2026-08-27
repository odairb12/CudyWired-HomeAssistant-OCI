FROM node:24-alpine
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev --ignore-scripts
COPY server.js .
USER node
CMD ["node","server.js"]
