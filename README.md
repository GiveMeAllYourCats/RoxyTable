# RoxyTable

`npm install pm2 -g`

`pm2 start table.js`


make sure to have redis-server installed and running


create `.env` file in project root before starting server

```
WEB_PORT=80
SESSION_SECRET=SOMERANDOMBIGSTREAMOFSTRINGDATAHEREDONOTUSETHIS
ACCOUNTSFILE=accounts.json
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
NODE_ENV=production
```
