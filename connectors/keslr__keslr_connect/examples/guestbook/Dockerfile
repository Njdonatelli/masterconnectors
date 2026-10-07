# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages ./packages
COPY examples/guestbook ./examples/guestbook
RUN npm ci
RUN npm run build --workspaces --if-present

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/examples/guestbook/dist ./dist
COPY --from=build /app/examples/guestbook/package.json ./package.json

# Don't run as root.
USER node

EXPOSE 8080
CMD ["node", "dist/server.js"]
