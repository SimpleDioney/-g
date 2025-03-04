const { Channel, Server, UserServer, Message, User } = require('../models');
const { redisClient } = require('../config/redis');
const { getIO } = require('../config/socketio');
const { Op } = require('sequelize');
const notificationService = require('./notification.service');

class ChannelService {
  /**
   * Criar um novo canal
   * @param {Object} data - Dados do canal
   * @returns {Promise<Object>} Canal criado
   */
  async createChannel(data) {
    const { serverId, name, type, isPrivate, userId } = data;
    
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
        message: 'Você não tem permissão para criar canais'
      };
    }
    
    // Verificar limite de canais (20 por tipo em servidores normais, 50 em premium)
    const server = await Server.findByPk(serverId);
    
    if (!server) {
      throw {
        statusCode: 404,
        message: 'Servidor não encontrado'
      };
    }
    
    const channelCount = await Channel.count({
      where: {
        serverId,
        type
      }
    });
    
    const limit = server.isPremium ? 50 : 20;
    
    if (channelCount >= limit) {
      throw {
        statusCode: 400,
        message: `Limite de ${limit} canais do tipo ${type} atingido${!server.isPremium ? '. Faça upgrade para Premium para aumentar o limite.' : ''}`
      };
    }
    
    // Obter posição para o novo canal
    const lastPosition = await Channel.max('position', {
      where: { serverId }
    }) || 0;
    
    // Criar canal
    const channel = await Channel.create({
      name,
      type,
      serverId,
      isPrivate: isPrivate === true,
      position: lastPosition + 1
    });
    
    // Criar mensagem de sistema para canais de texto
    if (type === 'text' || type === 'announcement') {
      await Message.create({
        channelId: channel.id,
        userId, // Criador do canal
        content: `Canal #${name} foi criado.`,
        type: 'system'
      });
    }
    
    // Notificar membros
    const io = getIO();
    io.to(`server:${serverId}`).emit('channel_created', {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      serverId,
      isPrivate: channel.isPrivate,
      position: channel.position,
      createdBy: userId
    });
    
    return channel;
  }
  
  /**
   * Obter canais de um servidor
   * @param {string} serverId - ID do servidor
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Canais do servidor
   */
  async getServerChannels(serverId, userId) {
    // Verificar se é membro
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId
      }
    });
    
    if (!userServer) {
      throw {
        statusCode: 403,
        message: 'Você não é membro deste servidor'
      };
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
    
    return organizedChannels;
  }
  
  /**
   * Atualizar um canal
   * @param {Object} data - Dados do canal
   * @returns {Promise<Object>} Canal atualizado
   */
  async updateChannel(data) {
    const { serverId, channelId, name, slowMode, userId } = data;
    
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
        message: 'Você não tem permissão para editar canais'
      };
    }
    
    // Buscar canal
    const channel = await Channel.findOne({
      where: {
        id: channelId,
        serverId
      }
    });
    
    if (!channel) {
      throw {
        statusCode: 404,
        message: 'Canal não encontrado'
      };
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
    
    return channel;
  }
  
  /**
   * Excluir um canal
   * @param {Object} data - Dados para excluir canal
   * @returns {Promise<Object>} Resultado da operação
   */
  async deleteChannel(data) {
    const { serverId, channelId, userId } = data;
    
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
        message: 'Você não tem permissão para excluir canais'
      };
    }
    
    // Buscar canal
    const channel = await Channel.findOne({
      where: {
        id: channelId,
        serverId
      }
    });
    
    if (!channel) {
      throw {
        statusCode: 404,
        message: 'Canal não encontrado'
      };
    }
    
    // Verificar se é o único canal
    const channelCount = await Channel.count({
      where: { serverId }
    });
    
    if (channelCount <= 1) {
      throw {
        statusCode: 400,
        message: 'Não é possível excluir o único canal do servidor'
      };
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
    
    return { success: true };
  }
  
  /**
   * Obter mensagens de um canal
   * @param {Object} data - Parâmetros de busca
   * @returns {Promise<Object>} Mensagens do canal
   */
  async getChannelMessages(data) {
    const { channelId, userId, before, limit = 50 } = data;
    
    // Buscar canal
    const channel = await Channel.findByPk(channelId, {
      include: [{ model: Server }]
    });
    
    if (!channel) {
      throw {
        statusCode: 404,
        message: 'Canal não encontrado'
      };
    }
    
    // Verificar se é membro do servidor
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: channel.Server.id
      }
    });
    
    if (!userServer) {
      throw {
        statusCode: 403,
        message: 'Você não é membro deste servidor'
      };
    }
    
    // Construir query
    const query = {
      where: { channelId },
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
    
    return {
      messages: orderedMessages,
      hasMore: messages.length === parseInt(limit)
    };
  }
  
  /**
   * Enviar mensagem para um canal
   * @param {Object} data - Dados da mensagem
   * @returns {Promise<Object>} Mensagem enviada
   */
  async sendMessage(data) {
    const { channelId, userId, content, attachments, replyToId, type } = data;
    
    // Verificar canal
    const channel = await Channel.findByPk(channelId, {
      include: [{ model: Server }]
    });
    
    if (!channel) {
      throw {
        statusCode: 404,
        message: 'Canal não encontrado'
      };
    }
    
    // Verificar tipo de canal
    if (channel.type !== 'text' && channel.type !== 'announcement') {
      throw {
        statusCode: 400,
        message: 'Este canal não suporta mensagens de texto'
      };
    }
    
    // Verificar se é membro do servidor
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: channel.Server.id
      }
    });
    
    if (!userServer) {
      throw {
        statusCode: 403,
        message: 'Você não é membro deste servidor'
      };
    }
    
    // Verificar permissões para canais de anúncio
    if (channel.type === 'announcement' && 
        !['owner', 'admin'].includes(userServer.role)) {
      throw {
        statusCode: 403,
        message: 'Apenas administradores podem enviar mensagens em canais de anúncio'
      };
    }
    
    // Verificar slow mode
    if (channel.slowMode > 0) {
      const lastMessageKey = `slowmode:${channelId}:${userId}`;
      const lastMessageTime = await redisClient.get(lastMessageKey);
      
      if (lastMessageTime) {
        const elapsedTime = Math.floor(Date.now() / 1000) - parseInt(lastMessageTime);
        
        if (elapsedTime < channel.slowMode) {
          throw {
            statusCode: 429,
            message: `Slow mode ativado. Aguarde mais ${channel.slowMode - elapsedTime} segundos.`
          };
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
      
      throw {
        statusCode: 403,
        message: 'Você está silenciado neste canal',
        reason: muteInfo.reason,
        expiration: muteInfo.expiration
      };
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
    for (const mention of mentions) {
      // Não notificar o próprio remetente
      if (mention.id === userId) continue;
      
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
      
      // Adicionar notificação
      await notificationService.create({
        userId: mention.id,
        title: `Menção em ${channel.Server.name}`,
        message: `${user.displayName || user.username} mencionou você no canal #${channel.name}`,
        type: 'mention',
        sourceId: message.id,
        sourceType: 'message',
        data: {
          serverId: channel.Server.id,
          channelId,
          mentionedBy: user.username
        }
      });
    }
    
    return messageData;
  }
}

module.exports = new ChannelService();
