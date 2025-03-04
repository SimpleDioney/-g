const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const { redisClient } = require('./redis');
const { JWT_SECRET } = require('./jwt');

let io;

// Configurar Socket.IO
function setupSocketIO(server) {
  io = socketIo(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Middleware de autenticação para Socket.IO
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        return next(new Error('Autenticação necessária'));
      }
      
      // Verificar JWT
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded;
      
      // Registrar conexão no Redis para status online
      await redisClient.set(`user:${decoded.id}:status`, 'online');
      await redisClient.set(`user:${decoded.id}:socketId`, socket.id);
      
      next();
    } catch (error) {
      next(new Error('Falha na autenticação'));
    }
  });

  // Gerenciar conexões
  io.on('connection', (socket) => {
    console.log(`👤 Usuário conectado: ${socket.user.id}`);
    
    // Carregar handlers de socket
    require('../sockets/connection')(io, socket);
    require('../sockets/chat.socket')(io, socket);
    require('../sockets/presence.socket')(io, socket);
    
    // Desconexão
    socket.on('disconnect', async () => {
      console.log(`👤 Usuário desconectado: ${socket.user?.id}`);
      if (socket.user) {
        await redisClient.set(`user:${socket.user.id}:status`, 'offline');
        await redisClient.del(`user:${socket.user.id}:socketId`);
      }
    });
  });

  return io;
}

// Obter instância do Socket.IO
function getIO() {
  if (!io) {
    throw new Error('Socket.IO não inicializado');
  }
  return io;
}

module.exports = {
  setupSocketIO,
  getIO
};
