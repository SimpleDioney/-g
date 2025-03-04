const { Message, User, Channel, Server, UserServer } = require('../models');
const { redisClient, notificationQueue } = require('../config/redis');
const { getIO } = require('../config/socketio');
const { Op } = require('sequelize');

// Enviar mensagem
exports.sendMessage = async (req, res) => {
  try {
    const { channelId, content, attachments, replyToId, type } = req.body;
    const userId = req.user.id;
    
    // Verificar canal
    const channel = await Channel.findByPk(channelId, {
      include: [{ model: Server }]
    });
    
    if (!channel) {
      return res.status(404).json({
        message: 'Canal não encontrado'
      });
    }
    
    // Verificar tipo de canal
    if (channel.type !== 'text' && channel.type !== 'announcement') {
      return res.status(400).json({
        message: 'Este canal não suporta mensagens de texto'
      });
    }
    
    // Verificar se é membro do servidor
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: channel.Server.id
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não é membro deste servidor'
      });
    }
    
    // Verificar permissões para canais de anúncio
    if (channel.type === 'announcement' && 
        !['owner', 'admin'].includes(userServer.role)) {
      return res.status(403).json({
        message: 'Apenas administradores podem enviar mensagens em canais de anúncio'
      });
    }
    
    // Verificar slow mode
    if (channel.slowMode > 0) {
      const lastMessageKey = `slowmode:${channelId}:${userId}`;
      const lastMessageTime = await redisClient.get(lastMessageKey);
      
      if (lastMessageTime) {
        const elapsedTime = Math.floor(Date.now() / 1000) - parseInt(lastMessageTime);
        
        if (elapsedTime < channel.slowMode) {
          return res.status(429).json({
            message: `Slow mode ativado. Aguarde mais ${channel.slowMode - elapsedTime} segundos.`
          });
        }
      }
      
      // Registrar tempo da mensagem
      await redisClient.set(lastMessageKey, Math.floor(Date.now() / 1000), 'EX', channel.slowMode * 2);
    }
    
    // Verificar se está mutado
    const muteKey = `server:${channel.Server.id}:channel:${channelId}:muted:${userId}`;
    const muteData = await redisClient.get(muteKey);
    
    if (muteData) {
      const muteInfo = JSON.parse(muteData);
      
      return res.status(403).json({
        message: 'Você está silenciado neste canal',
        reason: muteInfo.reason,
        expiration: muteInfo.expiration
      });
    }
    
    // Processar menções (@username)
    const mentionRegex = /@(\w+)/g;
    const mentionMatches = content.match(mentionRegex) || [];
    
    const mentions = [];
    
    if (mentionMatches.length > 0) {
      const usernames = mentionMatches.map(m => m.substring(1));
      
      const mentionedUsers = await User.findAll({
        where: {
          username: {
            [Op.in]: usernames
          }
        },
        attributes: ['id', 'username']
      });
      
      // Verificar se os usuários mencionados são membros do servidor
      const serverMembers = await UserServer.findAll({
        where: {
          serverId: channel.Server.id,
          userId: {
            [Op.in]: mentionedUsers.map(u => u.id)
          }
        },
        attributes: ['userId']
      });
      
      const memberIds = serverMembers.map(m => m.userId);
      
      mentions.push(...mentionedUsers
        .filter(u => memberIds.includes(u.id))
        .map(u => ({ id: u.id, username: u.username })));
    }
    
    // Criar mensagem
    const message = await Message.create({
      channelId,
      userId,
      content,
      attachments: attachments || null,
      replyToId: replyToId || null,
      type: type || 'text',
      mentions: mentions.length > 0 ? mentions : null
    });
    
    // Incluir dados do remetente
    const user = await User.findByPk(userId, {
      attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
    });
    
    const messageData = {
      ...message.toJSON(),
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        avatarType: user.avatarType
      }
    };
    
    // Se for resposta, incluir mensagem original
    if (replyToId) {
      const replyTo = await Message.findByPk(replyToId, {
        include: [
          {
            model: User,
            attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
          }
        ]
      });
      
      if (replyTo) {
        messageData.replyTo = replyTo;
      }
    }
    
    // Enviar para todos no canal
    const io = getIO();
    io.to(`channel:${channelId}`).emit('new_message', messageData);
    
    // Incrementar contagem de mensagens (para XP)
    await redisClient.incr(`user:${userId}:messages`);
    const messageCount = await redisClient.get(`user:${userId}:messages`);
    
    // Atualizar XP a cada 10 mensagens
    if (messageCount % 10 === 0) {
      await User.increment('xpPoints', {
        by: 5,
        where: { id: userId }
      });
      
      // Verificar level up (cada 100 XP)
      const updatedUser = await User.findByPk(userId);
      const newLevel = Math.floor(updatedUser.xpPoints / 100) + 1;
      
      if (newLevel > updatedUser.level) {
        await updatedUser.update({ level: newLevel });
        
        // Notificar level up
        io.to(`user:${userId}`).emit('level_up', {
          level: newLevel,
          xpPoints: updatedUser.xpPoints
        });
      }
    }
    
    // Enviar notificações para menções
    if (mentions.length > 0) {
      mentions.forEach(mention => {
        // Não notificar o próprio remetente
        if (mention.id === userId) return;
        
        // Enviar evento para o usuário mencionado
        io.to(`user:${mention.id}`).emit('mention', {
          message: messageData,
          channel: {
            id: channel.id,
            name: channel.name
          },
          server: {
            id: channel.Server.id,
            name: channel.Server.name
          }
        });
        
        // Adicionar à fila de notificações
        notificationQueue.add('mention', {
          userId: mention.id,
          messageId: message.id,
          channelId,
          serverId: channel.Server.id,
          mentionedBy: user.username
        });
      });
    }
    
    return res.status(201).json({
      message: 'Mensagem enviada com sucesso',
      data: messageData
    });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    return res.status(500).json({
      message: 'Erro ao enviar mensagem',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Editar mensagem
exports.editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.id;
    
    // Buscar mensagem
    const message = await Message.findByPk(id, {
      include: [{ model: Channel }]
    });
    
    if (!message) {
      return res.status(404).json({
        message: 'Mensagem não encontrada'
      });
    }
    
    // Verificar propriedade
    if (message.userId !== userId) {
      return res.status(403).json({
        message: 'Você só pode editar suas próprias mensagens'
      });
    }
    
    // Verificar tempo (permite edição até 15 minutos)
    const messageTime = new Date(message.createdAt).getTime();
    const currentTime = new Date().getTime();
    const diffMinutes = (currentTime - messageTime) / (1000 * 60);
    
    if (diffMinutes > 15) {
      return res.status(400).json({
        message: 'Não é possível editar mensagens com mais de 15 minutos'
      });
    }
    
    // Atualizar mensagem
    await message.update({
      content,
      isEdited: true
    });
    
    // Notificar usuários no canal
    const io = getIO();
    io.to(`channel:${message.channelId}`).emit('message_updated', {
      id: message.id,
      content,
      isEdited: true,
      updatedAt: message.updatedAt
    });
    
    return res.status(200).json({
      message: 'Mensagem atualizada com sucesso',
      data: {
        id: message.id,
        content,
        isEdited: true,
        updatedAt: message.updatedAt
      }
    });
  } catch (error) {
    console.error('Erro ao editar mensagem:', error);
    return res.status(500).json({
      message: 'Erro ao editar mensagem',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Excluir mensagem
exports.deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Buscar mensagem
    const message = await Message.findByPk(id, {
      include: [{ model: Channel }]
    });
    
    if (!message) {
      return res.status(404).json({
        message: 'Mensagem não encontrada'
      });
    }
    
    // Verificar permissões
    let canDelete = false;
    
    // Proprietário da mensagem sempre pode excluir
    if (message.userId === userId) {
      canDelete = true;
    } else {
      // Verificar se é moderador ou admin do servidor
      const channel = await Channel.findByPk(message.channelId);
      
      if (channel) {
        const userServer = await UserServer.findOne({
          where: {
            userId,
            serverId: channel.serverId,
            role: {
              [Op.in]: ['owner', 'admin', 'moderator']
            }
          }
        });
        
        if (userServer) {
          canDelete = true;
        }
      }
    }
    
    if (!canDelete) {
      return res.status(403).json({
        message: 'Você não tem permissão para excluir esta mensagem'
      });
    }
    
    // Armazenar dados para notificação
    const channelId = message.channelId;
    
    // Excluir mensagem
    await message.destroy();
    
    // Notificar usuários no canal
    const io = getIO();
    io.to(`channel:${channelId}`).emit('message_deleted', {
      id
    });
    
    return res.status(200).json({
      message: 'Mensagem excluída com sucesso'
    });
  } catch (error) {
    console.error('Erro ao excluir mensagem:', error);
    return res.status(500).json({
      message: 'Erro ao excluir mensagem',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Reagir a uma mensagem
exports.addReaction = async (req, res) => {
  try {
    const { id } = req.params;
    const { reaction } = req.body;
    const userId = req.user.id;
    
    if (!reaction) {
      return res.status(400).json({
        message: 'Reação não especificada'
      });
    }
    
    // Buscar mensagem
    const message = await Message.findByPk(id, {
      include: [{ model: Channel }]
    });
    
    if (!message) {
      return res.status(404).json({
        message: 'Mensagem não encontrada'
      });
    }
    
    // Verificar se é membro do servidor
    const channel = await Channel.findByPk(message.channelId);
    
    if (!channel) {
      return res.status(404).json({
        message: 'Canal não encontrado'
      });
    }
    
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: channel.serverId
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não é membro deste servidor'
      });
    }
    
    // Adicionar/remover reação
    let reactions = message.reactions || {};
    
    if (!reactions[reaction]) {
      reactions[reaction] = [userId];
    } else if (!reactions[reaction].includes(userId)) {
      reactions[reaction].push(userId);
    } else {
      // Usuário já reagiu, remover reação
      reactions[reaction] = reactions[reaction].filter(id => id !== userId);
      
      // Remover chave se não houver mais reações
      if (reactions[reaction].length === 0) {
        delete reactions[reaction];
      }
    }
    
    // Atualizar mensagem
    await message.update({ reactions });
    
    // Notificar usuários no canal
    const io = getIO();
    io.to(`channel:${message.channelId}`).emit('message_reaction', {
      id: message.id,
      reactions
    });
    
    // Enviar notificação ao autor se não for o próprio usuário
    if (message.userId !== userId && Object.keys(reactions).length > 0) {
      // Notificar em tempo real
      io.to(`user:${message.userId}`).emit('reaction_notification', {
        messageId: message.id,
        channelId: message.channelId,
        reaction,
        byUser: {
          id: userId
        }
      });
      
      // Adicionar à fila de notificações
      notificationQueue.add('messageReaction', {
        userId: message.userId,
        messageId: message.id,
        channelId: message.channelId,
        serverId: channel.serverId,
        reactionBy: userId,
        reaction
      });
    }
    
    return res.status(200).json({
      message: 'Reação processada com sucesso',
      messageId: message.id,
      reactions
    });
  } catch (error) {
    console.error('Erro ao processar reação:', error);
    return res.status(500).json({
      message: 'Erro ao processar reação',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Fixar/desfixar mensagem
exports.pinMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Buscar mensagem
    const message = await Message.findByPk(id, {
      include: [{ model: Channel }]
    });
    
    if (!message) {
      return res.status(404).json({
        message: 'Mensagem não encontrada'
      });
    }
    
    // Verificar permissões (moderador ou admin)
    const channel = await Channel.findByPk(message.channelId);
    
    if (!channel) {
      return res.status(404).json({
        message: 'Canal não encontrado'
      });
    }
    
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: channel.serverId,
        role: {
          [Op.in]: ['owner', 'admin', 'moderator']
        }
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não tem permissão para fixar mensagens'
      });
    }
    
    // Alternar estado de fixação
    await message.update({
      isPinned: !message.isPinned
    });
    
    // Notificar usuários no canal
    const io = getIO();
    io.to(`channel:${message.channelId}`).emit('message_pinned', {
      id: message.id,
      isPinned: message.isPinned
    });
    
    return res.status(200).json({
      message: `Mensagem ${message.isPinned ? 'fixada' : 'desfixada'} com sucesso`,
      messageId: message.id,
      isPinned: message.isPinned
    });
  } catch (error) {
    console.error('Erro ao fixar/desfixar mensagem:', error);
    return res.status(500).json({
      message: 'Erro ao processar solicitação',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Buscar mensagens fixadas
exports.getPinnedMessages = async (req, res) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.id;
    
    // Verificar canal
    const channel = await Channel.findByPk(channelId, {
      include: [{ model: Server }]
    });
    
    if (!channel) {
      return res.status(404).json({
        message: 'Canal não encontrado'
      });
    }
    
    // Verificar se é membro do servidor
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: channel.Server.id
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não é membro deste servidor'
      });
    }
    
    // Buscar mensagens fixadas
    const pinnedMessages = await Message.findAll({
      where: {
        channelId,
        isPinned: true
      },
      include: [
        {
          model: User,
          attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
        }
      ],
      order: [['createdAt', 'ASC']]
    });
    
    return res.status(200).json({
      channelId,
      pinnedMessages
    });
  } catch (error) {
    console.error('Erro ao buscar mensagens fixadas:', error);
    return res.status(500).json({
      message: 'Erro ao buscar mensagens fixadas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Buscar mensagens com filtro
exports.searchMessages = async (req, res) => {
  try {
    const { channelId } = req.params;
    const { query, from, has, before, after, limit = 50 } = req.query;
    const userId = req.user.id;
    
    // Verificar canal
    const channel = await Channel.findByPk(channelId, {
      include: [{ model: Server }]
    });
    
    if (!channel) {
      return res.status(404).json({
        message: 'Canal não encontrado'
      });
    }
    
    // Verificar se é membro do servidor
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: channel.Server.id
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não é membro deste servidor'
      });
    }
    
    // Construir filtro
    const whereClause = {
      channelId
    };
    
    // Busca por conteúdo
    if (query) {
      whereClause.content = {
        [Op.like]: `%${query}%`
      };
    }
    
    // Filtrar por usuário
    if (from) {
      const fromUser = await User.findOne({
        where: { username: from }
      });
      
      if (fromUser) {
        whereClause.userId = fromUser.id;
      }
    }
    
    // Filtrar por conteúdo específico
    if (has) {
      const hasOptions = has.split(',');
      
      if (hasOptions.includes('attachment')) {
        whereClause.attachments = {
          [Op.not]: null
        };
      }
      
      if (hasOptions.includes('mention')) {
        whereClause.mentions = {
          [Op.not]: null
        };
      }
      
      if (hasOptions.includes('reaction')) {
        whereClause.reactions = {
          [Op.not]: {}
        };
      }
    }
    
    // Filtrar por data
    if (before) {
      whereClause.createdAt = {
        ...(whereClause.createdAt || {}),
        [Op.lt]: new Date(before)
      };
    }
    
    if (after) {
      whereClause.createdAt = {
        ...(whereClause.createdAt || {}),
        [Op.gt]: new Date(after)
    };
  }
  
  // Buscar mensagens
  const messages = await Message.findAll({
    where: whereClause,
    include: [
      {
        model: User,
        attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
      }
    ],
    order: [['createdAt', 'DESC']],
    limit: Math.min(parseInt(limit), 100)
  });
  
  return res.status(200).json({
    channelId,
    messages: messages.reverse(),
    count: messages.length
  });
} catch (error) {
  console.error('Erro ao buscar mensagens:', error);
  return res.status(500).json({
    message: 'Erro ao buscar mensagens',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
}
};

// Agendar mensagem
exports.scheduleMessage = async (req, res) => {
try {
  const { channelId } = req.params;
  const { content, scheduledFor, attachments, type } = req.body;
  const userId = req.user.id;
  
  if (!scheduledFor) {
    return res.status(400).json({
      message: 'Data de agendamento é obrigatória'
    });
  }
  
  // Validar data de agendamento
  const scheduleDate = new Date(scheduledFor);
  const now = new Date();
  
  if (isNaN(scheduleDate.getTime()) || scheduleDate <= now) {
    return res.status(400).json({
      message: 'Data de agendamento deve ser no futuro'
    });
  }
  
  // Garantir pelo menos 5 minutos no futuro
  const diffMinutes = (scheduleDate - now) / (1000 * 60);
  
  if (diffMinutes < 5) {
    return res.status(400).json({
      message: 'Mensagens devem ser agendadas com pelo menos 5 minutos de antecedência'
    });
  }
  
  // Verificar canal
  const channel = await Channel.findByPk(channelId, {
    include: [{ model: Server }]
  });
  
  if (!channel) {
    return res.status(404).json({
      message: 'Canal não encontrado'
    });
  }
  
  // Verificar tipo de canal
  if (channel.type !== 'text' && channel.type !== 'announcement') {
    return res.status(400).json({
      message: 'Este canal não suporta mensagens de texto'
    });
  }
  
  // Verificar se é membro do servidor
  const userServer = await UserServer.findOne({
    where: {
      userId,
      serverId: channel.Server.id
    }
  });
  
  if (!userServer) {
    return res.status(403).json({
      message: 'Você não é membro deste servidor'
    });
  }
  
  // Verificar permissões para canais de anúncio
  if (channel.type === 'announcement' && 
      !['owner', 'admin'].includes(userServer.role)) {
    return res.status(403).json({
      message: 'Apenas administradores podem enviar mensagens em canais de anúncio'
    });
  }
  
  // Criar mensagem agendada
  const message = await Message.create({
    channelId,
    userId,
    content,
    attachments: attachments || null,
    type: type || 'text',
    scheduledFor: scheduleDate
  });
  
  // Adicionar à fila de processamento
  const delay = scheduleDate - now;
  await redisClient.set(`scheduled_message:${message.id}`, '1', 'PX', delay);
  
  return res.status(201).json({
    message: 'Mensagem agendada com sucesso',
    data: {
      id: message.id,
      content,
      scheduledFor: message.scheduledFor
    }
  });
} catch (error) {
  console.error('Erro ao agendar mensagem:', error);
  return res.status(500).json({
    message: 'Erro ao agendar mensagem',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
}
};

// Configurar mensagem autodestrutiva
exports.setMessageExpiry = async (req, res) => {
try {
  const { id } = req.params;
  const { expiresIn } = req.body; // expiresIn em segundos
  const userId = req.user.id;
  
  if (!expiresIn || expiresIn < 5 || expiresIn > 86400) {
    return res.status(400).json({
      message: 'Tempo de expiração deve estar entre 5 segundos e 24 horas'
    });
  }
  
  // Buscar mensagem
  const message = await Message.findByPk(id);
  
  if (!message) {
    return res.status(404).json({
      message: 'Mensagem não encontrada'
    });
  }
  
  // Verificar propriedade
  if (message.userId !== userId) {
    return res.status(403).json({
      message: 'Você só pode configurar autodestruction em suas próprias mensagens'
    });
  }
  
  // Calcular data de expiração
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  
  // Atualizar mensagem
  await message.update({ expiresAt });
  
  // Configurar exclusão automática
  await redisClient.set(`expiring_message:${id}`, '1', 'EX', expiresIn);
  
  // Notificar usuários no canal
  const io = getIO();
  io.to(`channel:${message.channelId}`).emit('message_expiry_set', {
    id,
    expiresAt
  });
  
  return res.status(200).json({
    message: 'Expiração configurada com sucesso',
    messageId: id,
    expiresAt
  });
} catch (error) {
  console.error('Erro ao configurar expiração:', error);
  return res.status(500).json({
    message: 'Erro ao configurar expiração da mensagem',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
}
};

// Criar enquete
exports.createPoll = async (req, res) => {
try {
  const { channelId } = req.params;
  const { question, options, expiresIn } = req.body;
  const userId = req.user.id;
  
  // Validar dados
  if (!question || !options || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({
      message: 'Enquete precisa de uma pergunta e pelo menos 2 opções'
    });
  }
  
  // Verificar canal
  const channel = await Channel.findByPk(channelId, {
    include: [{ model: Server }]
  });
  
  if (!channel) {
    return res.status(404).json({
      message: 'Canal não encontrado'
    });
  }
  
  // Verificar se é membro do servidor
  const userServer = await UserServer.findOne({
    where: {
      userId,
      serverId: channel.Server.id
    }
  });
  
  if (!userServer) {
    return res.status(403).json({
      message: 'Você não é membro deste servidor'
    });
  }
  
  // Criar objeto da enquete
  const pollData = {
    question,
    options: options.map(option => ({
      text: option,
      votes: []
    })),
    voters: [],
    createdAt: new Date()
  };
  
  // Definir data de expiração se fornecida
  if (expiresIn && expiresIn > 0) {
    const maxExpiresIn = 7 * 24 * 60 * 60; // 1 semana em segundos
    const validExpiresIn = Math.min(expiresIn, maxExpiresIn);
    
    pollData.expiresAt = new Date(Date.now() + validExpiresIn * 1000);
  }
  
  // Criar mensagem com a enquete
  const message = await Message.create({
    channelId,
    userId,
    content: question,
    type: 'poll',
    attachments: pollData
  });
  
  // Incluir dados do criador
  const user = await User.findByPk(userId, {
    attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
  });
  
  const messageData = {
    ...message.toJSON(),
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      avatarType: user.avatarType
    }
  };
  
  // Enviar para todos no canal
  const io = getIO();
  io.to(`channel:${channelId}`).emit('poll_created', messageData);
  
  // Configurar expiração se necessário
  if (pollData.expiresAt) {
    const timeUntilExpiry = (new Date(pollData.expiresAt) - new Date()) / 1000;
    await redisClient.set(`poll_expiry:${message.id}`, '1', 'EX', timeUntilExpiry);
  }
  
  return res.status(201).json({
    message: 'Enquete criada com sucesso',
    data: messageData
  });
} catch (error) {
  console.error('Erro ao criar enquete:', error);
  return res.status(500).json({
    message: 'Erro ao criar enquete',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
}
};

// Votar em enquete
exports.votePoll = async (req, res) => {
try {
  const { id } = req.params;
  const { optionIndex } = req.body;
  const userId = req.user.id;
  
  if (optionIndex === undefined || isNaN(optionIndex)) {
    return res.status(400).json({
      message: 'Índice da opção é obrigatório'
    });
  }
  
  // Buscar mensagem
  const message = await Message.findByPk(id);
  
  if (!message || message.type !== 'poll') {
    return res.status(404).json({
      message: 'Enquete não encontrada'
    });
  }
  
  const poll = message.attachments;
  
  // Verificar se a enquete expirou
  if (poll.expiresAt && new Date(poll.expiresAt) < new Date()) {
    return res.status(400).json({
      message: 'Esta enquete já expirou'
    });
  }
  
  // Verificar se a opção é válida
  if (optionIndex < 0 || optionIndex >= poll.options.length) {
    return res.status(400).json({
      message: 'Opção inválida'
    });
  }
  
  // Verificar se é membro do servidor
  const channel = await Channel.findByPk(message.channelId);
  
  if (!channel) {
    return res.status(404).json({
      message: 'Canal não encontrado'
    });
  }
  
  const userServer = await UserServer.findOne({
    where: {
      userId,
      serverId: channel.serverId
    }
  });
  
  if (!userServer) {
    return res.status(403).json({
      message: 'Você não é membro deste servidor'
    });
  }
  
  // Verificar se o usuário já votou
  const alreadyVoted = poll.voters.includes(userId);
  
  // Remover voto anterior se existir
  if (alreadyVoted) {
    poll.options.forEach(option => {
      option.votes = option.votes.filter(id => id !== userId);
    });
    
    // Remover da lista de votantes (será adicionado novamente)
    poll.voters = poll.voters.filter(id => id !== userId);
  }
  
  // Adicionar voto
  poll.options[optionIndex].votes.push(userId);
  poll.voters.push(userId);
  
  // Atualizar mensagem
  await message.update({ attachments: poll });
  
  // Preparar dados para envio (sem revelar quem votou em qual opção)
  const pollResults = {
    ...poll,
    options: poll.options.map(option => ({
      text: option.text,
      voteCount: option.votes.length
    }))
  };
  
  // Notificar usuários no canal
  const io = getIO();
  io.to(`channel:${message.channelId}`).emit('poll_updated', {
    id: message.id,
    poll: pollResults
  });
  
  return res.status(200).json({
    message: 'Voto registrado com sucesso',
    messageId: message.id,
    selectedOption: optionIndex,
    poll: pollResults
  });
} catch (error) {
  console.error('Erro ao votar em enquete:', error);
  return res.status(500).json({
    message: 'Erro ao processar voto',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
}
};