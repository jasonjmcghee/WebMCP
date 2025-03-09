FROM node:18-alpine

WORKDIR /app

COPY package*.json .

RUN npm install

COPY . .

RUN npm run build

# Specifically for smithery. If you want to run WebMCP in a docker image,
CMD ["npx", "./build/index.js", "--mcp"]
