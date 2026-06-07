/**
 * local server entry file, for local development
 */
import http from 'http'
import { WebSocketServer } from 'ws'
import app from './app.js'
import { handleConnection } from './websocket/messageHandler.js'

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001 // WebSocket + HTTP server port

const server = http.createServer(app)

const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (ws) => {
  handleConnection(ws)
})

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request)
  })
})

server.listen(PORT, () => {
  console.log(`Server ready on port ${PORT}`)
})

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;