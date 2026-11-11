# Development image: runs the Vite dev server with the source bind-mounted over /app.
FROM node:24.22.2-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5174

CMD ["npm", "run", "dev"]
