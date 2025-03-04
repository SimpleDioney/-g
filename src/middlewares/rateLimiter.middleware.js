const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { redisClient } = require('../config/redis');

// Configurar limites para diferentes rotas
const generalLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args)
  }),
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requisições por janela
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Muitas requisições, tente novamente mais tarde.'
  }
});

// Limiter mais restritivo para autenticação
const authLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args)
  }),
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10, // 10 tentativas por hora
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Muitas tentativas de login, tente novamente mais tarde.'
  }
});

// Limiter para upload de vídeos
const videoUploadLimiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.call(...args)
  }),
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5, // 5 uploads por hora (para usuários normais)
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Limite de uploads atingido, tente novamente mais tarde.'
  },
  // Bypass para usuários premium
  skip: (req) => {
    return req.user && req.user.isPremium;
  }
});

// Aplicar limitadores conforme a rota
module.exports = (req, res, next) => {
  // Rotas de autenticação
  if (req.path.startsWith('/api/auth/login') || 
      req.path.startsWith('/api/auth/register') ||
      req.path.startsWith('/api/auth/reset-password')) {
    return authLimiter(req, res, next);
  }
  
  // Rotas de upload de vídeo
  if (req.path.startsWith('/api/videos/upload')) {
    return videoUploadLimiter(req, res, next);
  }
  
  // Outras rotas
  return generalLimiter(req, res, next);
};