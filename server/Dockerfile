# The relay, and only the relay (docs/game-design.md 15.4).
#
# The game itself is a static site and is not in here — this image is a post
# box for two browsers, so it carries one dependency and no game code. That is
# also why it doesn't need to be redeployed when the game changes.
FROM node:22-alpine

WORKDIR /app

# Just enough to install ws. Copying the whole project would drag React and
# the map data into an image that has no use for either.
COPY server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY server/relay.mjs ./relay.mjs

# Hosting platforms hand the port over in the environment; 8787 is only the
# local default.
ENV NODE_ENV=production
EXPOSE 8787

# Not root, for the usual reason.
USER node

CMD ["node", "relay.mjs"]
