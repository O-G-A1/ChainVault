# Simple Dockerfile for running the Node Express app
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy source
COPY . ./

# Expose the port the app listens on
EXPOSE 3000

# Use an explicit command to run the server
CMD ["node", "server.js"]
