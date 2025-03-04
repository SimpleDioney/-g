const { Server, Channel, User, UserServer, Message } = require('../models');
const { redisClient } = require('../config/redis');
const { v4: uuidv4 } = require('uuid');
const { getIO } = require('../config/socketio');
const { Op } = require('sequelize');

class ServerService {
  /**
   * Criar um novo servidor
   * @param {Object} data - Dados do servidor
   * @returns {Promise<Object>} Servidor criado
   */
  async createServer(data) {
    const { name, description, isPrivate, userId } = data;
    
    // Gerar código de convite
    const inviteCode = uuidv4().substring(0, 8);
    
    // Criar servidor
    const server = await Server.create({
      name,
      description: description || '',
      ownerId: userId,
      inviteCode,
      isPrivate: isPrivate === true
    });
    
    // Adicionar criador como membro (owner)
    await UserServer.create({
      userId,
      serverId: server.id,
      role: 'owner'
    });
    
    // Criar canais padrão
    const generalChannel = await Channel.create({
      name: 'geral',
      type: 'text',
      serverId: server.id,
      position: 0
    });
    
    const welcomeChannel = await Channel.create({
      name: 'boas-vindas',
      type: 'text',
      serverId: server.id,
      position: 1
    });
    
    const voiceChannel = await Channel.create({
      name: 'Voz',
      type: 'voice',
      serverId: server.id,
      position: 2
    });
    
    // Criar mensagem de boas-vindas
    await Message.create({
      channelId: welcomeChannel.id,
      userId,
      content: `Bem-vindo ao servidor ${name}! Este é o início do servidor.`,
      type: 'system'
    });
    
    // Configurar servidor para notificações
    const settingsKey = `server:${server.id}:settings`;
    await redisClient.set(settingsKey, JSON.stringify({
      autoModeration: 'warn',
      customWords: [],
      notifyModerators: true
    }));
    
    return {
      server,
      channels: [generalChannel, welcomeChannel, voiceChannel]
    };
  }
  
  /**
   * Obter servidores de um usuário
   * @param {string} userId - ID do usuário
   * @returns {Promise<Array>} Servidores do usuário
   */
  async getUserServers(userId) {
    const userServers = await UserServer.findAll({
      where: { userId },
      include: [
        {
          model: Server,
          attributes: ['id', 'name', 'description', 'icon', 'isPrivate', 'memberCount']
        }
      ],
      order: [[Server, 'name', 'ASC']]
    });
    
    // Formatar resposta
    return userServers.map(us => ({
      id: us.Server.id,
      name: us.Server.name,
      description: us.Server.description,
      icon: us.Server.icon,
      isPrivate: us.Server.isPrivate,
      memberCount: us.Server.memberCount,
      role: us.role,
      joinedAt: us.joinedAt
    }));
  }
  
  /**
   * Obter detalhes de um servidor
   * @param {string} serverId - ID do servidor
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Detalhes do servidor
   */
  async getServer(serverId, userId) {
    // Verificar se o usuário é membro
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
    
    // Buscar servidor
    const server = await Server.findByPk(serverId, {
      include: [
        {
          model: Channel,
          order: [['position', 'ASC']]
        },
        {
          model: User,
          as: 'owner',
          attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
        }
      ]
    });
    
    if (!server) {
      throw {
        statusCode: 404,
        message: 'Servidor não encontrado'
      };
    }
    
    // Buscar membros
    const members = await UserServer.findAll({
      where: { serverId },
      include: [
        {
          model: User,
          attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
        }
      ],
      order: [
        ['role', 'DESC'], // owner, admin, moderator, member
        [User, 'username', 'ASC']
      ]
    });
    
    // Formatar canais agrupados por tipo
    const organizedChannels = {
      text: server.Channels.filter(c => c.type === 'text').map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        position: c.position,
        isPrivate: c.isPrivate
      })),
      voice: server.Channels.filter(c => c.type === 'voice').map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        position: c.position,
        isPrivate: c.isPrivate
      })),
      announcement: server.Channels.filter(c => c.type === 'announcement').map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        position: c.position,
        isPrivate: c.isPrivate
      }))
    };
    
    // Obter status online dos membros
    const memberIds = members.map(m => m.User.id);
    const pipeline = redisClient.pipeline();
    
    memberIds.forEach(id => {
      pipeline.get(`user:${id}:status`);
      pipeline.get(`user:${id}:invisible`);
    });
    
    const results = await pipeline.exec();
    
    // Formatar resposta com status online
    const formattedMembers = members.map((m, index) => {
      const status = results[index * 2][1] || 'offline';
      const isInvisible = results[index * 2 + 1][1];
      
      return {
        id: m.User.id,
        username: m.User.username,
        displayName: m.User.displayName,
        avatar: m.User.avatar,
        avatarType: m.User.avatarType,
        role: m.role,
        joinedAt: m.joinedAt,
        status: isInvisible ? 'offline' : status
      };
    });
    
    return {
      server: {
        id: server.id,
        name: server.name,
        description: server.description,
        icon: server.icon,
        inviteCode: server.inviteCode,
        isPrivate: server.isPrivate,
        memberCount: server.memberCount,
        isPremium: server.isPremium,
        premiumTier: server.premiumTier,
        createdAt: server.createdAt,
        owner: server.owner,
        channels: organizedChannels,
        userRole: userServer.role
      },
      members: formattedMembers
    };
  }
  
  /**
   * Atualizar um servidor
   * @param {string} serverId - ID do servidor
   * @param {Object} data - Dados para atualização
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Servidor atualizado
   */
  async updateServer(serverId, data, userId) {
    const { name, description, isPrivate } = data;
    
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
        message: 'Você não tem permissão para editar este servidor'
      };
    }
    
    // Buscar servidor
    const server = await Server.findByPk(serverId);
    
    if (!server) {
      throw {
        statusCode: 404,
        message: 'Servidor não encontrado'
      };
    }
    
    // Campos a atualizar
    const updateData = {};
    
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    
    // Apenas o dono pode alterar privacidade do servidor
    if (isPrivate !== undefined && userServer.role === 'owner') {
      updateData.isPrivate = isPrivate;
    }
    
    // Atualizar servidor
    await server.update(updateData);
    
    return server;
  }
  
  /**
   * Gerar novo código de convite
   * @param {string} serverId - ID do servidor
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Novo código de convite
   */
  async generateInvite(serverId, userId) {
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
        message: 'Você não tem permissão para gerar códigos de convite'
      };
    }
    
    // Buscar servidor
    const server = await Server.findByPk(serverId);
    
    if (!server) {
      throw {
        statusCode: 404,
        message: 'Servidor não encontrado'
      };
    }
    
    // Gerar novo código
    const inviteCode = uuidv4().substring(0, 8);
    
    // Atualizar servidor
    await server.update({ inviteCode });
    
    return { inviteCode };
  }
  
  /**
   * Entrar em um servidor via convite
   * @param {Object} data - Dados para entrar no servidor
   * @returns {Promise<Object>} Resultado da operação
   */
  async joinServer(data) {
    const { inviteCode, userId } = data;
    
    // Buscar servidor pelo código
    const server = await Server.findOne({
      where: { inviteCode }
    });
    
    if (!server) {
      throw {
        statusCode: 404,
        message: 'Código de convite inválido ou expirado'
      };
    }
    
    // Verificar se já é membro
    const existingMember = await UserServer.findOne({
      where: {
        userId,
        serverId: server.id
      }
    });
    
    if (existingMember) {
      throw {
        statusCode: 400,
        message: 'Você já é membro deste servidor'
      };
    }
    
    // Verificar se está banido
    const banKey = `server:${server.id}:banned:${userId}`;
    const isBanned = await redisClient.get(banKey);
    
    if (isBanned) {
      throw {
        statusCode: 403,
        message: 'Você está banido deste servidor'
      };
    }
    
    // Adicionar ao servidor
    await UserServer.create({
      userId,
      serverId: server.id,
      role: 'member'
    });
    
    // Incrementar contador de membros
    await server.increment('memberCount', { by: 1 });
    
    // Enviar mensagem de boas-vindas
    const generalChannel = await Channel.findOne({
      where: {
        serverId: server.id,
        name: 'geral'
      }
    });
    
    if (generalChannel) {
      const user = await User.findByPk(userId, {
        attributes: ['username', 'displayName']
      });
      
      await Message.create({
        channelId: generalChannel.id,
        userId: server.ownerId, // Sistema envia como dono do servidor
        content: `${user.displayName || user.username} entrou no servidor!`,
        type: 'system'
      });
      
      // Notificar membros
      const io = getIO();
      io.to(`channel:${generalChannel.id}`).emit('user_joined', {
        serverId: server.id,
        userId,
        username: user.username,
        displayName: user.displayName
      });
    }
    
    return { success: true, server };
  }
  
  /**
   * Sair de um servidor
   * @param {string} serverId - ID do servidor
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Resultado da operação
   */
  async leaveServer(serverId, userId) {
    // Verificar se é membro
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId
      }
    });
    
    if (!userServer) {
      throw {
        statusCode: 404,
        message: 'Você não é membro deste servidor'
      };
    }
    
    // Verificar se é o dono
    const server = await Server.findByPk(serverId);
    
    if (server.ownerId === userId) {
      throw {
        statusCode: 400,
        message: 'O dono não pode sair do servidor. Transfira a propriedade ou exclua o servidor.'
      };
    }
    
    // Remover do servidor
    await userServer.destroy();
    
    // Decrementar contador de membros
    if (server.memberCount > 0) {
      await server.decrement('memberCount', { by: 1 });
    }
    
    // Enviar mensagem de saída
    const generalChannel = await Channel.findOne({
      where: {
        serverId,
        name: 'geral'
      }
    });
    
    if (generalChannel) {
      const user = await User.findByPk(userId, {
        attributes: ['username', 'displayName']
      });
      
      await Message.create({
        channelId: generalChannel.id,
        userId: server.ownerId, // Sistema envia como dono do servidor
        content: `${user.displayName || user.username} saiu do servidor.`,
        type: 'system'
      });
      
      // Notificar membros
      const io = getIO();
      io.to(`channel:${generalChannel.id}`).emit('user_left', {
        serverId,
        userId,
        username: user.username,
        displayName: user.displayName
      });
    }
    
    return { success: true };
  }
  
  /**
   * Excluir um servidor
   * @param {string} serverId - ID do servidor
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Resultado da operação
   */
  async deleteServer(serverId, userId) {
    // Verificar se é o dono
    const server = await Server.findOne({
      where: {
        id: serverId,
        ownerId: userId
      }
    });
    
    if (!server) {
      throw {
        statusCode: 403,
        message: 'Apenas o dono pode excluir o servidor'
      };
    }
    
    // Buscar canais para exclusão
    const channels = await Channel.findAll({
      where: { serverId }
    });
    
    // Buscar membros para notificação
    const members = await UserServer.findAll({
      where: { serverId },
      attributes: ['userId']
    });
    
    const memberIds = members.map(m => m.userId);
    
    // Excluir mensagens, canais, membros e servidor
    for (const channel of channels) {
      await Message.destroy({
        where: { channelId: channel.id }
      });
    }
    
    await Channel.destroy({
      where: { serverId }
    });
    
    await UserServer.destroy({
      where: { serverId }
    });
    
    // Remover configurações do Redis
    await redisClient.del(`server:${serverId}:settings`);
    await redisClient.del(`server:${serverId}:forbidden_words`);
    
    // Remover ícone do Cloudinary se existir
    if (server.icon && server.icon.includes('cloudinary')) {
      const publicId = server.icon.split('/').pop().split('.')[0];
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (error) {
        console.error('Erro ao remover ícone do Cloudinary:', error);
      }
    }
    
    // Excluir servidor
    await server.destroy();
    
    // Notificar membros
    const io = getIO();
    memberIds.forEach(memberId => {
      io.to(`user:${memberId}`).emit('server_deleted', {
        serverId,
        serverName: server.name
      });
    });
    
    return { success: true };
  }
}

module.exports = new ServerService();