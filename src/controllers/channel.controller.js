const { Channel, Server, UserServer, Message } = require('../models');
const { redisClient } = require('../config/redis');
const { getIO } = require('../config/socketio');
const { Op } = require('sequelize');

// Obter canais de um servidor
exports.getServerChannels = async (req, res) => {
  try {
    const { serverId } = req.params;
    const userId = req.user.id;
    
    // Verificar se é membro
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não é membro deste servidor'
      });
    }
    
    // Buscar canais
    const channels = await Channel.findAll({
      where: { serverId },
      order: [['position', 'ASC']]
    });
    
    // Formatar canais agrupados por tipo
    const organizedChannels = {
      text: channels.filter(c => c.type === 'text').map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        position: c.position,
        isPrivate: c.isPrivate
      })),
      voice: channels.filter(c => c.type === 'voice').map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        position: c.position,
        isPrivate: c.isPrivate
      })),
      video: channels.filter(c => c.type === 'video').map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        position: c.position,
        isPrivate: c.isPrivate
      })),
      announcement: channels.filter(c => c.type === 'announcement').map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        position: c.position,
        isPrivate: c.isPrivate
      }))
    };
    
    return res.status(200).json({ channels: organizedChannels });
  } catch (error) {
    console.error('Erro ao obter canais:', error);
    return res.status(500).json({
      message: 'Erro ao carregar canais',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter mensagens de um canal
exports.getChannelMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { before, limit = 50 } = req.query;
    const userId = req.user.id;
    
    // Buscar canal
    const channel = await Channel.findByPk(id, {
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
    
    // Construir query
    const query = {
      where: { channelId: id },
      limit: Math.min(parseInt(limit), 100),
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: User,
          attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
        }
      ]
    };
    
    // Paginação
    if (before) {
      const beforeMessage = await Message.findByPk(before);
      if (beforeMessage) {
        query.where.createdAt = {
          [Op.lt]: beforeMessage.createdAt
        };
      }
    }
    
    // Buscar mensagens
    const messages = await Message.findAll(query);
    
    // Inverter para ordem cronológica
    const orderedMessages = messages.reverse();
    
    return res.status(200).json({
      messages: orderedMessages,
      hasMore: messages.length === parseInt(limit)
    });
  } catch (error) {
    console.error('Erro ao obter mensagens:', error);
    return res.status(500).json({
      message: 'Erro ao carregar mensagens',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Atualizar canal
exports.updateChannel = async (req, res) => {
  try {
    const { serverId, channelId } = req.params;
    const { name, slowMode } = req.body;
    const userId = req.user.id;
    
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
      return res.status(403).json({
        message: 'Você não tem permissão para editar canais'
      });
    }
    
    // Buscar canal
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
    
    // Campos a atualizar
    const updateData = {};
    
    if (name) updateData.name = name;
    if (slowMode !== undefined) updateData.slowMode = parseInt(slowMode) || 0;
    
    // Atualizar canal
    await channel.update(updateData);
    
    // Notificar membros
    const io = getIO();
    io.to(`server:${serverId}`).emit('channel_updated', {
      id: channel.id,
      name: channel.name,
      slowMode: channel.slowMode
    });
    
    return res.status(200).json({
      message: 'Canal atualizado com sucesso',
      channel: {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        slowMode: channel.slowMode
      }
    });
  } catch (error) {
    console.error('Erro ao atualizar canal:', error);
    return res.status(500).json({
      message: 'Erro ao atualizar canal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Excluir canal
exports.deleteChannel = async (req, res) => {
  try {
    const { serverId, channelId } = req.params;
    const userId = req.user.id;
    
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
      return res.status(403).json({
        message: 'Você não tem permissão para excluir canais'
      });
    }
    
    // Buscar canal
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
    
    // Verificar se é o único canal
    const channelCount = await Channel.count({
      where: { serverId }
    });
    
    if (channelCount <= 1) {
      return res.status(400).json({
        message: 'Não é possível excluir o único canal do servidor'
      });
    }
    
    // Excluir mensagens
    await Message.destroy({
      where: { channelId }
    });
    
    // Excluir canal
    await channel.destroy();
    
    // Notificar membros
    const io = getIO();
    io.to(`server:${serverId}`).emit('channel_deleted', {
      id: channelId,
      serverId
    });
    
    return res.status(200).json({
      message: 'Canal excluído com sucesso'
    });
  } catch (error) {
    console.error('Erro ao excluir canal:', error);
    return res.status(500).json({
      message: 'Erro ao excluir canal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Atualizar posição do canal
exports.updateChannelPosition = async (req, res) => {
  try {
    const { serverId, channelId } = req.params;
    const { position } = req.body;
    const userId = req.user.id;
    
    if (position === undefined || isNaN(position)) {
      return res.status(400).json({
        message: 'Posição inválida'
      });
    }
    
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
      return res.status(403).json({
        message: 'Você não tem permissão para reorganizar canais'
      });
    }
    
    // Buscar canal
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
    
    // Atualizar posição
    await channel.update({ position: parseInt(position) });
    
    // Notificar membros
    const io = getIO();
    io.to(`server:${serverId}`).emit('channel_position_updated', {
      id: channelId,
      position: parseInt(position)
    });
    
    return res.status(200).json({
      message: 'Posição do canal atualizada com sucesso',
      channel: {
        id: channel.id,
        name: channel.name,
        position: channel.position
      }
    });
  } catch (error) {
    console.error('Erro ao atualizar posição do canal:', error);
    return res.status(500).json({
      message: 'Erro ao atualizar posição do canal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Enviar mensagem para canal
exports.sendMessage = async (req, res) => {
  try {
    const { channelId } = req.params;
    const { content, attachments, replyToId, type } = req.body;
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
