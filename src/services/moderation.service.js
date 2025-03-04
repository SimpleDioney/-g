const { User, Server, Channel, UserServer, Message } = require('../models');
const { redisClient } = require('../config/redis');
const { getIO } = require('../config/socketio');
const { Op } = require('sequelize');
const natural = require('natural');

// Tokenizer para processamento de texto
const tokenizer = new natural.WordTokenizer();

// Lista de palavras proibidas (exemplo básico)
let forbiddenWords = ['palavrão1', 'palavrão2', 'ofensa1', 'ofensa2'];

// Regex para detecção de padrões sensíveis
const sensitivePatterns = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(\+\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g,
  creditCard: /\b(?:\d{4}[ -]?){3}\d{4}\b/g,
  socialSecurity: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g
};

class ModerationService {
  constructor() {
    // Carregar palavras proibidas na inicialização
    this.loadForbiddenWords();
  }
  
  /**
   * Carregar lista de palavras proibidas do Redis
   */
  async loadForbiddenWords() {
    try {
      const words = await redisClient.get('forbidden_words');
      
      if (words) {
        forbiddenWords = JSON.parse(words);
      } else {
        // Se não existir, salvar a lista padrão
        await redisClient.set('forbidden_words', JSON.stringify(forbiddenWords));
      }
      
      console.log(`Carregadas ${forbiddenWords.length} palavras proibidas`);
    } catch (error) {
      console.error('Erro ao carregar palavras proibidas:', error);
    }
  }
  
  /**
   * Verificar texto em busca de conteúdo proibido
   * @param {string} text - Texto a ser verificado
   * @param {string} serverId - ID do servidor (opcional, para palavras personalizadas)
   * @returns {Promise<Object>} Resultado da verificação
   */
  async checkContent(text, serverId = null) {
    if (!text) return { isClean: true };
    
    // Converter para minúsculas e tokenizar
    const lowerText = text.toLowerCase();
    const tokens = tokenizer.tokenize(lowerText);
    
    // Lista global de palavras proibidas
    let wordList = [...forbiddenWords];
    
    // Adicionar palavras personalizadas do servidor, se fornecido
    if (serverId) {
      const serverWordsKey = `server:${serverId}:forbidden_words`;
      const serverWords = await redisClient.get(serverWordsKey);
      
      if (serverWords) {
        const customWords = JSON.parse(serverWords);
        wordList = [...wordList, ...customWords];
      }
    }
    
    // Verificar palavras proibidas
    const foundWords = wordList.filter(word => 
      tokens.includes(word) || lowerText.includes(word)
    );
    
    // Verificar padrões sensíveis
    const sensitiveMatches = {};
    let hasSensitiveData = false;
    
    Object.entries(sensitivePatterns).forEach(([type, pattern]) => {
      const matches = text.match(pattern);
      
      if (matches && matches.length > 0) {
        sensitiveMatches[type] = matches.length;
        hasSensitiveData = true;
      }
    });
    
    return {
      isClean: foundWords.length === 0 && !hasSensitiveData,
      foundWords,
      hasSensitiveData,
      sensitiveMatches
    };
  }
  
  /**
   * Atualizar lista de palavras proibidas
   * @param {Array} words - Nova lista de palavras
   * @returns {Promise<Object>} Resultado da operação
   */
  async updateForbiddenWords(words) {
    if (!Array.isArray(words)) {
      throw {
        statusCode: 400,
        message: 'Lista de palavras inválida'
      };
    }
    
    // Atualizar lista global
    forbiddenWords = words.map(word => word.toLowerCase());
    
    // Persistir no Redis
    await redisClient.set('forbidden_words', JSON.stringify(forbiddenWords));
    
    return {
      message: 'Lista de palavras proibidas atualizada',
      count: forbiddenWords.length
    };
  }
  
  /**
   * Obter lista de palavras proibidas
   * @returns {Promise<Object>} Lista de palavras proibidas
   */
  async getForbiddenWords() {
    return {
      words: forbiddenWords,
      count: forbiddenWords.length
    };
  }
  
  /**
   * Configurar moderação de servidor
   * @param {Object} data - Dados de configuração
   * @returns {Promise<Object>} Configurações atualizadas
   */
  async updateServerModeration(data) {
    const { serverId, userId, autoModeration, customWords = [], notifyModerators = true } = data;
    
    // Verificar permissões (owner ou admin)
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId,
        role: {
          [Op.in]: ['owner', 'admin']
        }
      }
    });
    
    if (!userServer) {
      throw {
        statusCode: 403,
        message: 'Você não tem permissão para configurar moderação neste servidor'
      };
    }
    
    // Validar modo de moderação
    const validModes = ['off', 'log', 'warn', 'block'];
    
    if (!validModes.includes(autoModeration)) {
      throw {
        statusCode: 400,
        message: 'Modo de moderação inválido',
        validModes
      };
    }
    
    // Obter configurações atuais
    const settingsKey = `server:${serverId}:settings`;
    const currentSettingsStr = await redisClient.get(settingsKey);
    const currentSettings = currentSettingsStr ? JSON.parse(currentSettingsStr) : {};
    
    // Atualizar configurações
    const settings = {
      ...currentSettings,
      autoModeration,
      customWords: customWords.map(word => word.toLowerCase()),
      notifyModerators
    };
    
    // Salvar no Redis
    await redisClient.set(settingsKey, JSON.stringify(settings));
    
    // Salvar palavras personalizadas do servidor
    const serverWordsKey = `server:${serverId}:forbidden_words`;
    await redisClient.set(serverWordsKey, JSON.stringify(customWords));
    
    return {
      message: 'Configurações de moderação atualizadas',
      settings
    };
  }
  
  /**
   * Obter logs de moderação do servidor
   * @param {Object} data - Parâmetros de busca
   * @returns {Promise<Object>} Logs de moderação
   */
  async getServerModLogs(data) {
    const { serverId, userId, page = 1, limit = 50 } = data;
    
    // Verificar permissões
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId,
        role: {
          [Op.in]: ['owner', 'admin', 'moderator']
        }
      }
    });
    
    if (!userServer) {
      throw {
        statusCode: 403,
        message: 'Você não tem permissão para acessar logs de moderação'
      };
    }
    
    // Obter logs do Redis
    const logsKey = `server:${serverId}:mod_logs`;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit - 1;
    
    const logItems = await redisClient.lrange(logsKey, startIndex, endIndex);
    const totalLogs = await redisClient.llen(logsKey);
    
    // Converter para objetos
    const logs = logItems.map(item => JSON.parse(item));
    
    // Adicionar informações de usuários
    const userIds = logs.map(log => log.userId).filter(Boolean);
    
    if (userIds.length > 0) {
      const users = await User.findAll({
        where: {
          id: {
            [Op.in]: userIds
          }
        },
        attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
      });
      
      // Adicionar informações de usuário a cada log
      logs.forEach(log => {
        if (log.userId) {
          const user = users.find(u => u.id === log.userId);
          if (user) {
            log.user = {
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              avatar: user.avatar,
              avatarType: user.avatarType
            };
          }
        }
      });
    }
    
    return {
      logs,
      totalLogs,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalLogs / limit),
      hasMore: endIndex < totalLogs - 1
    };
  }
  
  /**
   * Banir usuário de um servidor
   * @param {Object} data - Dados do banimento
   * @returns {Promise<Object>} Resultado da operação
   */
  async banUser(data) {
    const { serverId, userId, moderatorId, reason, deleteMessages = false, duration } = data;
    
    // Verificar permissões
    const moderatorServer = await UserServer.findOne({
      where: {
        userId: moderatorId,
        serverId,
        role: {
          [Op.in]: ['owner', 'admin', 'moderator']
        }
      }
    });
    
    if (!moderatorServer) {
      throw {
        statusCode: 403,
        message: 'Você não tem permissão para banir usuários'
      };
    }
    
    // Verificar se o usuário a ser banido existe no servidor
    const targetServer = await UserServer.findOne({
      where: {
        userId,
        serverId
      },
      include: [{ model: User }, { model: Server }]
    });
    
    if (!targetServer) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado no servidor'
      };
    }
    
    // Verificar hierarquia de roles
    const roles = { owner: 3, admin: 2, moderator: 1, member: 0 };
    
    if (roles[targetServer.role] >= roles[moderatorServer.role]) {
      throw {
        statusCode: 403,
        message: 'Você não pode banir um usuário com cargo igual ou superior ao seu'
      };
    }
    
    // Remover do servidor
    await targetServer.destroy();
    
    // Adicionar à lista de banidos
    const banKey = `server:${serverId}:banned:${userId}`;
    
    // Calcular expiração se fornecida
    let expiration = null;
    
    if (duration) {
      // Duração em horas
      const expirationDate = new Date();
      expirationDate.setHours(expirationDate.getHours() + parseInt(duration));
      expiration = expirationDate.toISOString();
      
      // Definir expiração no Redis
      await redisClient.set(banKey, JSON.stringify({
        reason: reason || 'Banido por violar as regras',
        moderatorId,
        timestamp: new Date().toISOString(),
        expiration
      }), 'EX', parseInt(duration) * 60 * 60);
    } else {
      // Ban permanente
      await redisClient.set(banKey, JSON.stringify({
        reason: reason || 'Banido por violar as regras',
        moderatorId,
        timestamp: new Date().toISOString()
      }));
    }
    
    // Excluir mensagens se solicitado
    if (deleteMessages) {
      // Obter canais do servidor
      const channels = await Channel.findAll({
        where: { serverId },
        attributes: ['id']
      });
      
      if (channels.length > 0) {
        const channelIds = channels.map(c => c.id);
        
        // Excluir mensagens recentes (últimas 24h)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        await Message.destroy({
          where: {
            userId,
            channelId: {
              [Op.in]: channelIds
            },
            createdAt: {
              [Op.gte]: yesterday
            }
          }
        });
      }
    }
    
    // Registrar ação nos logs
    await redisClient.lpush(`server:${serverId}:mod_logs`, JSON.stringify({
      type: 'ban',
      userId,
      moderatorId,
      reason: reason || 'Banido por violar as regras',
      duration: duration ? `${duration} horas` : 'Permanente',
      deleteMessages,
      timestamp: new Date().toISOString()
    }));
    
    // Notificar usuário
    const io = getIO();
    io.to(`user:${userId}`).emit('server_ban', {
      serverId,
      serverName: targetServer.Server?.name || 'Servidor',
      reason: reason || 'Banido por violar as regras',
      duration: duration ? `${duration} horas` : 'Permanente'
    });
    
    return {
      message: `Usuário ${targetServer.User.username} banido com sucesso`,
      duration: duration ? `${duration} horas` : 'Permanente'
    };
  }
  
  /**
   * Remover banimento de usuário
   * @param {Object} data - Dados para remover banimento
   * @returns {Promise<Object>} Resultado da operação
   */
  async unbanUser(data) {
    const { serverId, userId, moderatorId } = data;
    
    // Verificar permissões
    const moderatorServer = await UserServer.findOne({
      where: {
        userId: moderatorId,
        serverId,
        role: {
          [Op.in]: ['owner', 'admin', 'moderator']
        }
      }
    });
    
    if (!moderatorServer) {
      throw {
        statusCode: 403,
        message: 'Você não tem permissão para gerenciar banimentos'
      };
    }
    
    // Verificar se o usuário está banido
    const banKey = `server:${serverId}:banned:${userId}`;
    const banData = await redisClient.get(banKey);
    
    if (!banData) {
      throw {
        statusCode: 404,
        message: 'Usuário não está banido deste servidor'
      };
    }
    
    // Remover da lista de banidos
    await redisClient.del(banKey);
    
    // Registrar nos logs
    await redisClient.lpush(`server:${serverId}:mod_logs`, JSON.stringify({
      type: 'unban',
      userId,
      moderatorId,
      timestamp: new Date().toISOString()
    }));
    
    // Buscar informações do usuário
    const user = await User.findByPk(userId, {
      attributes: ['username', 'email']
    });
    
    // Buscar informações do servidor
    const server = await Server.findByPk(serverId, {
      attributes: ['name']
    });
    
    return {
      message: `Banimento de ${user?.username || userId} removido com sucesso do servidor ${server?.name || serverId}`
    };
  }
  
  /**
   * Obter lista de usuários banidos de um servidor
   * @param {Object} data - Parâmetros de busca
   * @returns {Promise<Object>} Lista de banidos
   */
  async getBannedUsers(data) {
    const { serverId, userId } = data;
    
    // Verificar permissões
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId,
        role: {
          [Op.in]: ['owner', 'admin', 'moderator']
        }
      }
    });
    
    if (!userServer) {
      throw {
        statusCode: 403,
        message: 'Você não tem permissão para ver a lista de banidos'
      };
    }
    
    // Buscar lista de banidos
    const bannedPattern = `server:${serverId}:banned:*`;
    const banKeys = await redisClient.keys(bannedPattern);
    
    if (!banKeys.length) {
      return { bannedUsers: [] };
    }
    
    // Extrair IDs de usuário
    const userIds = banKeys.map(key => key.split(':').pop());
    
    // Buscar detalhes de cada banimento
    const pipeline = redisClient.pipeline();
    banKeys.forEach(key => {
      pipeline.get(key);
    });
    
    const banResults = await pipeline.exec();
    
    // Buscar detalhes dos usuários
    const users = await User.findAll({
      where: {
        id: {
          [Op.in]: userIds
        }
      },
      attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType', 'email']
    });
    
    // Combinar dados
    const bannedUsers = userIds.map((userId, index) => {
      const banDataStr = banResults[index][1];
      const banData = banDataStr ? JSON.parse(banDataStr) : {};
      const user = users.find(u => u.id === userId);
      
      return {
        userId,
        username: user?.username,
        displayName: user?.displayName,
        avatar: user?.avatar,
        avatarType: user?.avatarType,
        email: user?.email,
        reason: banData.reason,
        timestamp: banData.timestamp,
        expiration: banData.expiration,
        isPermanent: !banData.expiration,
        moderatorId: banData.moderatorId
      };
    });
    
    // Adicionar informações sobre moderadores
    const moderatorIds = bannedUsers
      .map(user => user.moderatorId)
      .filter(Boolean)
      .filter((id, index, self) => self.indexOf(id) === index); // Unique
    
    if (moderatorIds.length > 0) {
      const moderators = await User.findAll({
        where: {
          id: {
            [Op.in]: moderatorIds
          }
        },
        attributes: ['id', 'username', 'displayName']
      });
      
      bannedUsers.forEach(user => {
        if (user.moderatorId) {
          const moderator = moderators.find(m => m.id === user.moderatorId);
          if (moderator) {
            user.moderator = {
              id: moderator.id,
              username: moderator.username,
              displayName: moderator.displayName
            };
          }
        }
      });
    }
    
    return { bannedUsers };
  }
}

module.exports = new ModerationService();