const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { JWT_SECRET } = require('../config/jwt');
const { redisClient } = require('../config/redis');

// Middleware de autenticação
exports.authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        message: 'Token de acesso não fornecido'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verificar blacklist de tokens revogados
    const isRevoked = await redisClient.get(`revoked_token:${token}`);
    
    if (isRevoked) {
      return res.status(401).json({
        message: 'Token revogado'
      });
    }
    
    // Verificar JWT
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        message: 'Token inválido ou expirado'
      });
    }
    
    // Verificar se o usuário existe
    const user = await User.findByPk(decoded.id);
    
    if (!user) {
      return res.status(404).json({
        message: 'Usuário não encontrado'
      });
    }
    
    // Anexar usuário à requisição
    req.user = decoded;
    
    next();
  } catch (error) {
    console.error('Erro na autenticação:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao autenticar o usuário',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verificar roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: 'Não autorizado'
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Acesso proibido'
      });
    }
    
    next();
  };
};

// Verificar permissões em um servidor
exports.checkServerPermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          message: 'Não autorizado'
        });
      }
      
      const serverId = req.params.serverId || req.body.serverId;
      
      if (!serverId) {
        return res.status(400).json({
          message: 'ID do servidor não fornecido'
        });
      }
      
      // Buscar relação do usuário com o servidor
      const userServer = await UserServer.findOne({
        where: {
          userId: req.user.id,
          serverId
        }
      });
      
      if (!userServer) {
        return res.status(403).json({
          message: 'Você não é membro deste servidor'
        });
      }
      
      // Verificar permissão baseado no role
      let hasPermission = false;
      
      switch (userServer.role) {
        case 'owner':
          hasPermission = true;
          break;
        case 'admin':
          hasPermission = permission !== 'delete_server';
          break;
        case 'moderator':
          hasPermission = ['view', 'post_message', 'delete_message', 'kick_member'].includes(permission);
          break;
        case 'member':
          hasPermission = ['view', 'post_message'].includes(permission);
          break;
        default:
          hasPermission = false;
      }
      
      if (!hasPermission) {
        return res.status(403).json({
          message: 'Você não tem permissão para realizar esta ação'
        });
      }
      
      // Anexar informações adicionais
      req.userServer = userServer;
      
      next();
    } catch (error) {
      console.error('Erro ao verificar permissão de servidor:', error);
      return res.status(500).json({
        message: 'Ocorreu um erro ao verificar permissões',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  };
};
