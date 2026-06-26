FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
# Ensure schema sql is copied to matching location for initialization queries
COPY --from=builder /app/src/db/schema.sql ./dist/db/schema.sql

EXPOSE 5005
ENV PORT=5005
CMD ["npm", "start"]
