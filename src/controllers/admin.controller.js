const { User, Server, Channel, Message, Video, Transaction, VideoComment } = require('../models');
const { redisClient } = require('../config/redis');
const { Op } = require('sequelize');
const natural = require('natural');
const { getIO } = require('../config/socketio');

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

// Carregar lista de palavras proibidas do Redis
const loadForbiddenWords = async () => {
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
};

// Carregar na inicialização
loadForbiddenWords();

// Verificar texto em busca de conteúdo proibido
const checkContent = (text) => {
  if (!text) return { isClean: true };
  
  // Converter para minúsculas e tokenizar
  const lowerText = text.toLowerCase();
  const tokens = tokenizer.tokenize(lowerText);
  
  // Verificar palavras proibidas
  const foundWords = forbiddenWords.filter(word => 
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
};

// Middleware para filtrar mensagens (usado pelo controlador de mensagens)
exports.contentFilter = async (req, res, next) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return next();
    }
    
    const checkResult = checkContent(content);
    
    if (!checkResult.isClean) {
      // Verificar configurações do servidor
      const { channelId } = req.body;
      const channel = await Channel.findByPk(channelId, {
        include: [{ model: Server }]
      });
      
      if (channel && channel.Server) {
        // Verificar configuração de moderação do servidor
        const serverSettings = await redisClient.get(`server:${channel.Server.id}:settings`);
        const settings = serverSettings ? JSON.parse(serverSettings) : { autoModeration: 'warn' };
        
        // Registrar violação para logs
        await redisClient.lpush(`server:${channel.Server.id}:mod_logs`, JSON.stringify({
          userId: req.user.id,
          channelId,
          content,
          type: 'content_filter',
          result: checkResult,
          timestamp: new Date().toISOString()
        }));
        
        // Ações com base na configuração
        switch (settings.autoModeration) {
          case 'block':
            return res.status(403).json({
              message: 'Sua mensagem contém conteúdo proibido e foi bloqueada',
              details: checkResult
            });
          
          case 'warn':
            // Permitir, mas enviar aviso
            req.contentWarning = checkResult;
            break;
          
          case 'log':
          default:
            // Apenas registrar nos logs
            break;
        }
      }
    }
    
    next();
  } catch (error) {
    console.error('Erro no filtro de conteúdo:', error);
    next();
  }
};

// Atualizar lista de palavras proibidas
exports.updateForbiddenWords = async (req, res) => {
  try {
    const { words } = req.body;
    
    if (!Array.isArray(words)) {
      return res.status(400).json({
        message: 'Lista de palavras inválida'
      });
    }
    
    // Atualizar lista global
    forbiddenWords = words.map(word => word.toLowerCase());
    
    // Persistir no Redis
    await redisClient.set('forbidden_words', JSON.stringify(forbiddenWords));
    
    return res.status(200).json({
      message: 'Lista de palavras proibidas atualizada',
      count: forbiddenWords.length
    });
  } catch (error) {
    console.error('Erro ao atualizar palavras proibidas:', error);
    return res.status(500).json({
      message: 'Erro ao atualizar lista de palavras proibidas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter lista de palavras proibidas
exports.getForbiddenWords = async (req, res) => {
  try {
    return res.status(200).json({
      words: forbiddenWords,
      count: forbiddenWords.length
    });
  } catch (error) {
    console.error('Erro ao obter palavras proibidas:', error);
    return res.status(500).json({
      message: 'Erro ao obter lista de palavras proibidas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Configurar moderação de servidor
exports.updateServerModeration = async (req, res) => {
  try {
    const { serverId } = req.params;
    const { autoModeration, customWords = [], notifyModerators = true } = req.body;
    
    // Verificar permissões
    const userServer = await UserServer.findOne({
      where: {
        userId: req.user.id,
        serverId,
        role: {
          [Op.in]: ['owner', 'admin']
        }
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não tem permissão para configurar moderação neste servidor'
      });
    }
    
    // Validar modo de moderação
    const validModes = ['off', 'log', 'warn', 'block'];
    
    if (!validModes.includes(autoModeration)) {
      return res.status(400).json({
        message: 'Modo de moderação inválido',
        validModes
      });
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
    
    return res.status(200).json({
      message: 'Configurações de moderação atualizadas',
      settings
    });
  } catch (error) {
    console.error('Erro ao configurar moderação de servidor:', error);
    return res.status(500).json({
      message: 'Erro ao atualizar configurações de moderação',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter configurações de moderação do servidor
exports.getServerModeration = async (req, res) => {
  try {
    const { serverId } = req.params;
    
    // Verificar permissões
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
    
    // Verificar se tem permissão para ver configurações
    const canViewSettings = ['owner', 'admin', 'moderator'].includes(userServer.role);
    
    if (!canViewSettings) {
      return res.status(403).json({
        message: 'Você não tem permissão para ver configurações de moderação'
      });
    }
    
    // Obter configurações
    const settingsKey = `server:${serverId}:settings`;
    const settingsStr = await redisClient.get(settingsKey);
    const settings = settingsStr ? JSON.parse(settingsStr) : {
      autoModeration: 'warn',
      customWords: [],
      notifyModerators: true
    };
    
    // Obter palavras personalizadas do servidor
    const serverWordsKey = `server:${serverId}:forbidden_words`;
    const serverWordsStr = await redisClient.get(serverWordsKey);
    const customWords = serverWordsStr ? JSON.parse(serverWordsStr) : [];
    
    settings.customWords = customWords;
    
    return res.status(200).json({ settings });
  } catch (error) {
    console.error('Erro ao obter configurações de moderação:', error);
    return res.status(500).json({
      message: 'Erro ao obter configurações de moderação',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter logs de moderação do servidor
exports.getServerModLogs = async (req, res) => {
  try {
    const { serverId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    // Verificar permissões
    const userServer = await UserServer.findOne({
      where: {
        userId: req.user.id,
        serverId,
        role: {
          [Op.in]: ['owner', 'admin', 'moderator']
        }
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não tem permissão para acessar logs de moderação'
      });
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
    
    return res.status(200).json({
      logs,
      totalLogs,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalLogs / limit),
      hasMore: endIndex < totalLogs - 1
    });
  } catch (error) {
    console.error('Erro ao obter logs de moderação:', error);
    return res.status(500).json({
      message: 'Erro ao obter logs de moderação',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Banir usuário de um servidor
exports.banUser = async (req, res) => {
  try {
    const { serverId, userId } = req.params;
    const { reason, deleteMessages = false, duration } = req.body;
    const moderatorId = req.user.id;
    
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
      return res.status(403).json({
        message: 'Você não tem permissão para banir usuários'
      });
    }
    
    // Verificar se o usuário a ser banido existe no servidor
    const targetServer = await UserServer.findOne({
      where: {
        userId,
        serverId
      },
      include: [{ model: User }]
    });
    
    if (!targetServer) {
      return res.status(404).json({
        message: 'Usuário não encontrado no servidor'
      });
    }
    
    // Verificar hierarquia de roles
    const roles = { owner: 3, admin: 2, moderator: 1, member: 0 };
    
    if (roles[targetServer.role] >= roles[moderatorServer.role]) {
      return res.status(403).json({
        message: 'Você não pode banir um usuário com cargo igual ou superior ao seu'
      });
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
    
    return res.status(200).json({
      message: `Usuário ${targetServer.User.username} banido com sucesso`,
      duration: duration ? `${duration} horas` : 'Permanente'
    });
  } catch (error) {
    console.error('Erro ao banir usuário:', error);
    return res.status(500).json({
      message: 'Erro ao banir usuário',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Remover banimento
exports.unbanUser = async (req, res) => {
  try {
    const { serverId, userId } = req.params;
    const moderatorId = req.user.id;
    
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
      return res.status(403).json({
        message: 'Você não tem permissão para gerenciar banimentos'
      });
    }
    
    // Verificar se o usuário está banido
    const banKey = `server:${serverId}:banned:${userId}`;
    const banData = await redisClient.get(banKey);
    
    if (!banData) {
      return res.status(404).json({
        message: 'Usuário não está banido deste servidor'
      });
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
    
    return res.status(200).json({
      message: `Banimento de ${user?.username || userId} removido com sucesso do servidor ${server?.name || serverId}`
    });
  } catch (error) {
    console.error('Erro ao remover banimento:', error);
    return res.status(500).json({
      message: 'Erro ao remover banimento',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Listar usuários banidos
exports.getBannedUsers = async (req, res) => {
  try {
    const { serverId } = req.params;
    
    // Verificar permissões
    const userServer = await UserServer.findOne({
      where: {
        userId: req.user.id,
        serverId,
        role: {
          [Op.in]: ['owner', 'admin', 'moderator']
        }
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não tem permissão para ver a lista de banidos'
      });
    }
    
    // Buscar lista de banidos
    const bannedPattern = `server:${serverId}:banned:*`;
    const banKeys = await redisClient.keys(bannedPattern);
    
    if (!banKeys.length) {
      return res.status(200).json({
        bannedUsers: []
      });
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
    
    return res.status(200).json({
      bannedUsers
    });
  } catch (error) {
    console.error('Erro ao buscar usuários banidos:', error);
    return res.status(500).json({
      message: 'Erro ao obter lista de usuários banidos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Mutar usuário em um canal
exports.muteUser = async (req, res) => {
  try {
    const { serverId, channelId, userId } = req.params;
    const { duration, reason } = req.body;
    const moderatorId = req.user.id;
    
    // Verificar se os IDs são válidos
    if (!serverId || !channelId || !userId || !duration) {
      return res.status(400).json({
        message: 'Parâmetros inválidos'
      });
    }
    
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
      return res.status(403).json({
        message: 'Você não tem permissão para silenciar usuários'
      });
    }
    
    // Verificar se o usuário a ser silenciado existe no servidor
    const targetServer = await UserServer.findOne({
      where: {
        userId,
        serverId
      },
      include: [{ model: User }]
    });
    
    if (!targetServer) {
      return res.status(404).json({
        message: 'Usuário não encontrado no servidor'
      });
    }
    
    // Verificar hierarquia de roles
    const roles = { owner: 3, admin: 2, moderator: 1, member: 0 };
    
    if (roles[targetServer.role] >= roles[moderatorServer.role]) {
      return res.status(403).json({
        message: 'Você não pode silenciar um usuário com cargo igual ou superior ao seu'
      });
    }
    
    // Verificar se o canal existe
    const channel = await Channel.findOne({
      where: {
        id: channelId,
        serverId
      }
    });
    
    if (!channel) {
      return res.status(404).json({
        message: 'Canal não encontrado'
      });
    }
    
    // Definir chave para o mute
    const muteKey = `server:${serverId}:channel:${channelId}:muted:${userId}`;
    
    // Definir expiração (em horas)
    const expirationDate = new Date();
    expirationDate.setHours(expirationDate.getHours() + parseInt(duration));
    const expiration = expirationDate.toISOString();
    
    // Armazenar no Redis
    await redisClient.set(muteKey, JSON.stringify({
      reason: reason || 'Silenciado por violar as regras',
      moderatorId,
      timestamp: new Date().toISOString(),
      expiration
    }), 'EX', parseInt(duration) * 60 * 60);
    
    // Registrar ação nos logs
    await redisClient.lpush(`server:${serverId}:mod_logs`, JSON.stringify({
      type: 'mute',
      userId,
      moderatorId,
      channelId,
      reason: reason || 'Silenciado por violar as regras',
      duration: `${duration} horas`,
      timestamp: new Date().toISOString()
    }));
    
    // Notificar usuário
    const io = getIO();
    io.to(`user:${userId}`).emit('channel_mute', {
      serverId,
      serverName: channel.Server?.name || 'Servidor',
      channelId,
      channelName: channel.name,
      reason: reason || 'Silenciado por violar as regras',
      duration: `${duration} horas`,
      expiration
    });
    
    return res.status(200).json({
      message: `Usuário ${targetServer.User.username} silenciado no canal #${channel.name} por ${duration} horas`,
      expiration
    });
  } catch (error) {
    console.error('Erro ao silenciar usuário:', error);
    return res.status(500).json({
      message: 'Erro ao silenciar usuário',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Desmutar usuário
exports.unmuteUser = async (req, res) => {
  try {
    const { serverId, channelId, userId } = req.params;
    const moderatorId = req.user.id;
    
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
      return res.status(403).json({
        message: 'Você não tem permissão para gerenciar silenciamentos'
      });
    }
    
    // Verificar se o usuário está silenciado
    const muteKey = `server:${serverId}:channel:${channelId}:muted:${userId}`;
    const muteData = await redisClient.get(muteKey);
    
    if (!muteData) {
      return res.status(404).json({
        message: 'Usuário não está silenciado neste canal'
      });
    }
    
    // Remover silenciamento
    await redisClient.del(muteKey);
    
    // Registrar nos logs
    await redisClient.lpush(`server:${serverId}:mod_logs`, JSON.stringify({
      type: 'unmute',
      userId,
      moderatorId,
      channelId,
      timestamp: new Date().toISOString()
    }));
    
    // Buscar informações do usuário e canal
    const [user, channel] = await Promise.all([
      User.findByPk(userId, { attributes: ['username'] }),
      Channel.findByPk(channelId, { attributes: ['name'] })
    ]);
    
    // Notificar usuário
    const io = getIO();
    io.to(`user:${userId}`).emit('channel_unmute', {
      serverId,
      channelId,
      channelName: channel?.name
    });
    
    return res.status(200).json({
      message: `Silenciamento de ${user?.username || userId} removido do canal #${channel?.name || channelId}`
    });
  } catch (error) {
    console.error('Erro ao remover silenciamento:', error);
    return res.status(500).json({
      message: 'Erro ao remover silenciamento',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verificar se usuário está mutado (usado como middleware)
exports.checkUserMute = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { channelId } = req.body;
    
    if (!channelId) {
      return next();
    }
    
    // Buscar canal
    const channel = await Channel.findByPk(channelId, {
      attributes: ['serverId']
    });
    
    if (!channel) {
      return next();
    }
    
    // Verificar se está mutado
    const muteKey = `server:${channel.serverId}:channel:${channelId}:muted:${userId}`;
    const muteData = await redisClient.get(muteKey);
    
    if (muteData) {
      const muteInfo = JSON.parse(muteData);
      
      return res.status(403).json({
        message: 'Você está silenciado neste canal',
        reason: muteInfo.reason,
        expiration: muteInfo.expiration
      });
    }
    
    next();
  } catch (error) {
    console.error('Erro ao verificar silenciamento:', error);
    next();
  }
};

// Gerenciar roles de usuário
exports.updateUserRole = async (req, res) => {
  try {
    const { serverId, userId } = req.params;
    const { role } = req.body;
    const adminId = req.user.id;
    
    // Validar role
    const validRoles = ['member', 'moderator', 'admin'];
    
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        message: 'Cargo inválido',
        validRoles
      });
    }
    
    // Verificar permissões
    const adminServer = await UserServer.findOne({
      where: {
        userId: adminId,
        serverId
      }
    });
    
    if (!adminServer || adminServer.role === 'member' || 
        (adminServer.role === 'moderator' && role !== 'member')) {
      return res.status(403).json({
        message: 'Você não tem permissão para gerenciar cargos'
      });
    }
    
    // Não permitir que administradores alterem o cargo do dono
    const server = await Server.findByPk(serverId);
    
    if (!server) {
      return res.status(404).json({
        message: 'Servidor não encontrado'
      });
    }
    
    if (userId === server.ownerId) {
      return res.status(403).json({
        message: 'Não é possível alterar o cargo do dono do servidor'
      });
    }
    
    // Verificar se o usuário existe no servidor
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId
      },
      include: [{ model: User }]
    });
    
    if (!userServer) {
      return res.status(404).json({
        message: 'Usuário não encontrado no servidor'
      });
    }
    
    // Verificar hierarquia
    if (adminServer.role === 'admin' && userServer.role === 'admin' && adminId !== server.ownerId) {
      return res.status(403).json({
        message: 'Administradores não podem alterar o cargo de outros administradores'
      });
    }
    
    // Atualizar role
    await userServer.update({ role });
    
    // Registrar nos logs
    await redisClient.lpush(`server:${serverId}:mod_logs`, JSON.stringify({
      type: 'role_update',
      userId,
      adminId,
      oldRole: userServer.role,
      newRole: role,
      timestamp: new Date().toISOString()
    }));
    
    // Notificar usuário
    const io = getIO();
    io.to(`user:${userId}`).emit('role_update', {
      serverId,
      serverName: server.name,
      role
    });
    
    return res.status(200).json({
      message: `Cargo de ${userServer.User.username} atualizado para ${role}`,
      user: {
        id: userId,
        username: userServer.User.username,
        role
      }
    });
  } catch (error) {
    console.error('Erro ao atualizar cargo:', error);
    return res.status(500).json({
      message: 'Erro ao atualizar cargo do usuário',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verificar se usuário está banido (middleware)
exports.checkBan = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { serverId } = req.params || req.body;
    
    if (!serverId) {
      return next();
    }
    
    // Verificar se está banido
    const banKey = `server:${serverId}:banned:${userId}`;
    const banData = await redisClient.get(banKey);
    
    if (banData) {
      const banInfo = JSON.parse(banData);
      
      return res.status(403).json({
        message: 'Você está banido deste servidor',
        reason: banInfo.reason,
        expiration: banInfo.expiration
      });
    }
    
    next();
  } catch (error) {
    console.error('Erro ao verificar banimento:', error);
    next();
  }
};