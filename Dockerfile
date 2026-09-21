FROM node:20-alpine

# Pasang docker-cli dan git agar backend Waguri dapat memanggil Docker API serta Git Checkpoint/Rollback
RUN apk add --no-cache docker-cli git

WORKDIR /app

# Salin package.json dan package-lock.json (jika ada)
COPY package*.json ./

# Pasang dependensi untuk production
RUN npm install --omit=dev

# Salin seluruh kode program
COPY . .

# Waguri port
EXPOSE 3000

CMD ["npm", "start"]
