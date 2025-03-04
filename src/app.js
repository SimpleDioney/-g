require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const { setupSocketIO } = require('./config/socketio');
const { initRedis } = require('./config/redis');
const { initDatabase } = require('./config/database');
const errorHandler = require('./middlewares/errorHandler.middleware');
const rateLimit = require('./middlewares/rateLimiter.middleware');

// Importar rotas
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const serverRoutes = require('./routes/server.routes');
const channelRoutes = require('./routes/channel.routes');
const messageRoutes = require('./routes/message.routes');
const videoRoutes = require('./routes/video.routes');
const paymentRoutes = require('./routes/payment.routes');

// Inicializar app
const app = express();
const server = http.createServer(app);

// Configurar middlewares
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting global
app.use(rateLimit);

// Rotas da API
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/payments', paymentRoutes);

// Middleware de tratamento de erros
app.use(errorHandler);

// Inicializar serviços
async function initServices() {
  try {
    // Inicializar banco de dados
    await initDatabase();
    console.log('✅ Banco de dados SQLite conectado');
    
    // Inicializar Redis
    await initRedis();
    console.log('✅ Redis conectado');
    
    // Configurar Socket.IO
    setupSocketIO(server);
    console.log('✅ Socket.IO configurado');

    // Iniciar servidor
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Erro ao inicializar serviços:', error);
    process.exit(1);
  }
}

initServices();

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
  process.exit(1);
});
