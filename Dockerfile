FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine AS app
ENV NODE_ENV=production
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force
COPY server/server.js ./server/server.js
COPY --from=client-build /app/client/dist ./client/dist
EXPOSE 5002
CMD ["node", "server/server.js"]
