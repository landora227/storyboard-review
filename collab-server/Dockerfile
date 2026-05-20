FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.cjs ./
ENV NODE_ENV=production
EXPOSE 2345
CMD ["node", "server.cjs"]
