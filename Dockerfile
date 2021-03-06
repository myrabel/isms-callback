FROM node:10
# Create app directory
WORKDIR /usr/app
# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install
RUN npm install pm2 -g
# Bundle app source
COPY . .

EXPOSE 8080
CMD ["pm2-runtime", "process.yml"]