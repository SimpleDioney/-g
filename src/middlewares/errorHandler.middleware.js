const errorHandler = (err, req, res, next) => {
    console.error('Erro não tratado:', err);
    
    // Erros de validação do Sequelize
    if (err.name === 'SequelizeValidationError') {
      const errors = err.errors.map(e => ({
        field: e.path,
        message: e.message
      }));
      
      return res.status(400).json({
        error: 'Erro de validação',
        details: errors
      });
    }
    
    // Erros de chave única do Sequelize
    if (err.name === 'SequelizeUniqueConstraintError') {
      const fields = Object.keys(err.fields).join(', ');
      
      return res.status(409).json({
        error: 'Conflito de dados',
        message: `Já existe um registro com os valores fornecidos para: ${fields}`
      });
    }
    
    // Erros de chave estrangeira do Sequelize
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({
        error: 'Erro de referência',
        message: 'A operação não pode ser concluída porque um registro referenciado não existe'
      });
    }
    
    // Erros de JWT
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Erro de autenticação',
        message: 'Token inválido'
      });
    }
    
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Erro de autenticação',
        message: 'Token expirado'
      });
    }
    
    // Erros de Multer (upload de arquivos)
    if (err.name === 'MulterError') {
      let message = 'Erro ao fazer upload de arquivo';
      
      if (err.code === 'LIMIT_FILE_SIZE') {
        message = 'Arquivo excede o tamanho máximo permitido';
      } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        message = 'Tipo de arquivo não esperado';
      }
      
      return res.status(400).json({
        error: 'Erro de upload',
        message
      });
    }
    
    // Erros de Socket.io
    if (err.name === 'SocketIOError') {
      return res.status(500).json({
        error: 'Erro de comunicação em tempo real',
        message: err.message
      });
    }
    
    // Erros de Redis
    if (err.name === 'RedisError') {
      return res.status(500).json({
        error: 'Erro de cache',
        message: 'Ocorreu um erro no sistema de cache'
      });
    }
    
    // Erros de autenticação OAuth
    if (err.name === 'OAuthError') {
      return res.status(401).json({
        error: 'Erro de autenticação OAuth',
        message: err.message
      });
    }
    
    // Erros de pagamento
    if (err.name === 'StripeError' || err.name === 'MercadoPagoError') {
      return res.status(400).json({
        error: 'Erro de pagamento',
        message: err.message
      });
    }
    
    // Erros de processamento de vídeo
    if (err.name === 'FFmpegError') {
      return res.status(500).json({
        error: 'Erro no processamento de vídeo',
        message: 'Não foi possível processar o vídeo'
      });
    }
    
    // Erros de armazenamento (S3, Cloudinary)
    if (err.name === 'StorageError') {
      return res.status(500).json({
        error: 'Erro de armazenamento',
        message: 'Não foi possível armazenar o arquivo'
      });
    }
    
    // Erros de moderação de conteúdo
    if (err.name === 'ContentModerationError') {
      return res.status(403).json({
        error: 'Conteúdo impróprio',
        message: err.message
      });
    }
    
    // Erros personalizados com status code
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.name || 'Erro',
        message: err.message
      });
    }
    
    // Para erros não tratados
    const isDev = process.env.NODE_ENV === 'development';
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: isDev ? err.message : 'Ocorreu um erro inesperado',
      stack: isDev ? err.stack : undefined
    });
  };
  
  module.exports = errorHandler;
  
  // src/middlewares/rateLimiter.middleware.js
  const rateLimit = require('express-rate-limit');
  const { redisClient } = require('../config/redis');
  
  // Adaptador Redis para rate-limit
  const RedisStore = {
    /**
     * Incrementar contador para um IP
     * @param {string} key - Chave Redis (IP)
     */
    increment: async (key) => {
      const current = await redisClient.get(key);
      
      if (current) {
        await redisClient.incr(key);
        return parseInt(current) + 1;
      } else {
        await redisClient.set(key, 1, 'EX', 60); // 1 minuto
        return 1;
      }
    },
    
    /**
     * Decrementar contador
     * @param {string} key - Chave Redis
     */
    decrement: async (key) => {
      const current = await redisClient.get(key);
      
      if (current && parseInt(current) > 0) {
        await redisClient.decr(key);
        return parseInt(current) - 1;
      }
      
      return 0;
    },
    
    /**
     * Resetar contador
     * @param {string} key - Chave Redis
     */
    resetKey: async (key) => {
      await redisClient.del(key);
    },
    
    /**
     * Resetar todos os contadores
     */
    resetAll: async () => {
      const keys = await redisClient.keys('ratelimit:*');
      
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    }
  };
  
  // Configurações padrão do rate limiter
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Limite de requisições
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `ratelimit:${req.ip}:${req.path}`,
    handler: (req, res) => {
      res.status(429).json({
        error: 'Limite de requisições excedido',
        message: 'Muitas requisições. Por favor, tente novamente mais tarde.'
      });
    }
  };
  
  // Rate limiter para autenticação
  const authLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 10, // 10 tentativas por hora
    keyGenerator: (req) => `ratelimit:auth:${req.ip}`
  });
  
  // Rate limiter para uploads
  const uploadLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 20, // 20 uploads por hora
    keyGenerator: (req) => `ratelimit:upload:${req.user?.id || req.ip}`,
    // Skip para usuários premium
    skip: (req) => req.user && req.user.isPremium
  });
  
  // Rate limiter para mensagens
  const messageLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 60 * 1000, // 1 minuto
    max: 60, // 60 mensagens por minuto
    keyGenerator: (req) => `ratelimit:message:${req.user?.id || req.ip}`,
    // Skip para usuários premium
    skip: (req) => req.user && req.user.isPremium
  });
  
  // Rate limiter para vídeos
  const videoLimiter = rateLimit({
    ...defaultOptions,
    windowMs: 24 * 60 * 60 * 1000, // 24 horas
    max: 10, // 10 vídeos por dia
    keyGenerator: (req) => `ratelimit:video:${req.user?.id || req.ip}`,
    // Skip para usuários premium
    skip: (req) => req.user && req.user.isPremium
  });
  
  // Rate limiter genérico (para outras rotas)
  const genericLimiter = rateLimit({
    ...defaultOptions
  });
  
  // Aplicar limitadores conforme a rota
  module.exports = (req, res, next) => {
    // Rotas de autenticação
    if (req.path.startsWith('/api/auth')) {
      return authLimiter(req, res, next);
    }
    
    // Rotas de upload
    if (req.path.includes('/upload') || req.method === 'POST' && req.path.includes('/avatar')) {
      return uploadLimiter(req, res, next);
    }
    
    // Rotas de mensagens
    if (req.path.includes('/messages') && req.method === 'POST') {
      return messageLimiter(req, res, next);
    }
    
    // Rotas de vídeos
    if (req.path.includes('/videos') && req.method === 'POST') {
      return videoLimiter(req, res, next);
    }
    
    // Outras rotas
    return genericLimiter(req, res, next);
  };