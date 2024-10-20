# Use the official Node.js image for building the application
FROM node:18-alpine AS build

# Set working directory to /app
WORKDIR /app

# Copy both client and server package.json and package-lock.json files
COPY ./client/package*.json ./client/
COPY ./server/package*.json ./server/

# Install dependencies for the frontend
WORKDIR /app/client
RUN npm install

# Install dependencies for the backend
WORKDIR /app/server
RUN npm install

# Copy the frontend and backend source code into the container
COPY ./client /app/client
COPY ./server /app/server

# Build the frontend (Vue.js)
WORKDIR /app/client
RUN npm run build

# Create the final production image using a fresh Node.js base image
FROM node:18-alpine

# Set working directory to /app
WORKDIR /app

# Copy only the server code and the built frontend files from the build stage
COPY --from=build /app/server /app

# Expose the port the app runs on
EXPOSE 3000

# Start the backend, which also serves the frontend from /public
CMD ["npm", "start"]