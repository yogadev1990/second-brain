FROM node:20-alpine

# Pasang docker-cli agar backend Waguri dapat memanggil perintah "docker ps", "docker restart", dll.
RUN apk add --no-cache docker-cli

WORKDIR /app

# Salin package.json dan package-lock.json (jika ada)
COPY package*.json ./

# Pasang dependensi untuk production
RUN npm ci --only=production

# Salin seluruh kode program
COPY . .

# Waguri port
EXPOSE 3000

CMD ["npm", "start"]
