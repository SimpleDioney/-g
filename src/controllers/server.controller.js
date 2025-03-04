const { Server, Channel, User, UserServer, Message } = require('../models');
const { redisClient } = require('../config/redis');
const { getIO } = require('../config/socketio');
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Configurar upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/servers');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);
    cb(null, `${uuidv4()}${extension}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não suportado. Use JPG, PNG, GIF ou WebP.'), false);
  }
};

exports.upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Criar servidor
exports.createServer = async (req, res) => {
  try {
    const { name, description, isPrivate } = req.body;
    const userId = req.user.id;
    
    if (!name) {
      return res.status(400).json({ message: 'Nome do servidor é obrigatório' });
    }
    
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
    
    return res.status(201).json({
      message: 'Servidor criado com sucesso',
      server: {
        id: server.id,
        name: server.name,
        description: server.description,
        inviteCode: server.inviteCode,
        isPrivate: server.isPrivate,
        channels: [
          {
            id: generalChannel.id,
            name: generalChannel.name,
            type: generalChannel.type
          },
          {
            id: welcomeChannel.id,
            name: welcomeChannel.name,
            type: welcomeChannel.type
          },
          {
            id: voiceChannel.id,
            name: voiceChannel.name,
            type: voiceChannel.type
          }
        ]
      }
    });
  } catch (error) {
    console.error('Erro ao criar servidor:', error);
    return res.status(500).json({
      message: 'Erro ao criar servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter servidores do usuário
exports.getUserServers = async (req, res) => {
  try {
    const userId = req.user.id;
    
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
    const servers = userServers.map(us => ({
      id: us.Server.id,
      name: us.Server.name,
      description: us.Server.description,
      icon: us.Server.icon,
      isPrivate: us.Server.isPrivate,
      memberCount: us.Server.memberCount,
      role: us.role,
      joinedAt: us.joinedAt
    }));
    
    return res.status(200).json({ servers });
  } catch (error) {
    console.error('Erro ao obter servidores:', error);
    return res.status(500).json({
      message: 'Erro ao carregar servidores',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter detalhes de um servidor
exports.getServer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Verificar se o usuário é membro
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: id
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não é membro deste servidor'
      });
    }
    
    // Buscar servidor
    const server = await Server.findByPk(id, {
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
      return res.status(404).json({
        message: 'Servidor não encontrado'
      });
    }
    
    // Buscar membros
    const members = await UserServer.findAll({
      where: { serverId: id },
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
    
    return res.status(200).json({
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
    });
  } catch (error) {
    console.error('Erro ao obter servidor:', error);
    return res.status(500).json({
      message: 'Erro ao carregar detalhes do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Atualizar servidor
exports.updateServer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isPrivate } = req.body;
    const userId = req.user.id;
    
    // Verificar permissões (owner ou admin)
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: id,
        role: {
          [Op.in]: ['owner', 'admin']
        }
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não tem permissão para editar este servidor'
      });
    }
    
    // Buscar servidor
    const server = await Server.findByPk(id);
    
    if (!server) {
      return res.status(404).json({
        message: 'Servidor não encontrado'
      });
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
    
    return res.status(200).json({
      message: 'Servidor atualizado com sucesso',
      server: {
        id: server.id,
        name: server.name,
        description: server.description,
        icon: server.icon,
        isPrivate: server.isPrivate
      }
    });
  } catch (error) {
    console.error('Erro ao atualizar servidor:', error);
    return res.status(500).json({
      message: 'Erro ao atualizar servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Upload de ícone do servidor
exports.uploadIcon = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo enviado' });
    }
    
    const { id } = req.params;
    const userId = req.user.id;
    
    // Verificar permissões (owner ou admin)
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: id,
        role: {
          [Op.in]: ['owner', 'admin']
        }
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não tem permissão para editar este servidor'
      });
    }
    
    // Buscar servidor
    const server = await Server.findByPk(id);
    
    if (!server) {
      return res.status(404).json({
        message: 'Servidor não encontrado'
      });
    }
    
    // Upload para Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'servers',
      transformation: [
        { width: 128, height: 128, crop: 'fill' }
      ]
    });
    
    // Remover ícone antigo do Cloudinary se existir
    if (server.icon && server.icon.includes('cloudinary')) {
      const publicId = server.icon.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(publicId);
    }
    
    // Atualizar no banco de dados
    await server.update({
      icon: result.secure_url
    });
    
    // Remover arquivo temporário
    fs.unlinkSync(req.file.path);
    
    return res.status(200).json({
      message: 'Ícone atualizado com sucesso',
      icon: result.secure_url
    });
  } catch (error) {
    console.error('Erro ao atualizar ícone do servidor:', error);
    
    // Remover arquivo temporário em caso de erro
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    return res.status(500).json({
      message: 'Erro ao atualizar ícone do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Excluir servidor
exports.deleteServer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Verificar se é o dono
    const server = await Server.findOne({
      where: {
        id,
        ownerId: userId
      }
    });
    
    if (!server) {
      return res.status(403).json({
        message: 'Apenas o dono pode excluir o servidor'
      });
    }
    
    // Buscar canais para exclusão
    const channels = await Channel.findAll({
      where: { serverId: id }
    });
    
    // Buscar membros para notificação
    const members = await UserServer.findAll({
      where: { serverId: id },
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
      where: { serverId: id }
    });
    
    await UserServer.destroy({
      where: { serverId: id }
    });
    
    // Remover configurações do Redis
    await redisClient.del(`server:${id}:settings`);
    await redisClient.del(`server:${id}:forbidden_words`);
    
    // Remover ícone do Cloudinary se existir
    if (server.icon && server.icon.includes('cloudinary')) {
      const publicId = server.icon.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(publicId);
    }
    
    // Excluir servidor
    await server.destroy();
    
    // Notificar membros
    const io = getIO();
    memberIds.forEach(memberId => {
      io.to(`user:${memberId}`).emit('server_deleted', {
        serverId: id,
        serverName: server.name
      });
    });
    
    return res.status(200).json({
      message: 'Servidor excluído com sucesso'
    });
  } catch (error) {
    console.error('Erro ao excluir servidor:', error);
    return res.status(500).json({
      message: 'Erro ao excluir servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Gerar novo código de convite
exports.generateInvite = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Verificar permissões (owner ou admin)
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: id,
        role: {
          [Op.in]: ['owner', 'admin']
        }
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não tem permissão para gerar códigos de convite'
      });
    }
    
    // Buscar servidor
    const server = await Server.findByPk(id);
    
    if (!server) {
      return res.status(404).json({
        message: 'Servidor não encontrado'
      });
    }
    
    // Gerar novo código
    const inviteCode = uuidv4().substring(0, 8);
    
    // Atualizar servidor
    await server.update({ inviteCode });
    
    return res.status(200).json({
      message: 'Novo código de convite gerado',
      inviteCode
    });
  } catch (error) {
    console.error('Erro ao gerar código de convite:', error);
    return res.status(500).json({
      message: 'Erro ao gerar código de convite',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Entrar em um servidor via convite
exports.joinServer = async (req, res) => {
  try {
    const { inviteCode } = req.body;
    const userId = req.user.id;
    
    if (!inviteCode) {
      return res.status(400).json({
        message: 'Código de convite é obrigatório'
      });
    }
    
    // Buscar servidor pelo código
    const server = await Server.findOne({
      where: { inviteCode }
    });
    
    if (!server) {
      return res.status(404).json({
        message: 'Código de convite inválido ou expirado'
      });
    }
    
    // Verificar se já é membro
    const existingMember = await UserServer.findOne({
      where: {
        userId,
        serverId: server.id
      }
    });
    
    if (existingMember) {
      return res.status(400).json({
        message: 'Você já é membro deste servidor'
      });
    }
    
    // Verificar se está banido
    const banKey = `server:${server.id}:banned:${userId}`;
    const isBanned = await redisClient.get(banKey);
    
    if (isBanned) {
      return res.status(403).json({
        message: 'Você está banido deste servidor'
      });
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
    
    return res.status(200).json({
      message: 'Você entrou no servidor com sucesso',
      server: {
        id: server.id,
        name: server.name,
        description: server.description,
        icon: server.icon
      }
    });
  } catch (error) {
    console.error('Erro ao entrar no servidor:', error);
    return res.status(500).json({
      message: 'Erro ao entrar no servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Sair de um servidor
exports.leaveServer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Verificar se é membro
    const userServer = await UserServer.findOne({
      where: {
        userId,
        serverId: id
      }
    });
    
    if (!userServer) {
      return res.status(404).json({
        message: 'Você não é membro deste servidor'
      });
    }
    
    // Verificar se é o dono
    const server = await Server.findByPk(id);
    
    if (server.ownerId === userId) {
      return res.status(400).json({
        message: 'O dono não pode sair do servidor. Transfira a propriedade ou exclua o servidor.'
      });
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
        serverId: id,
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
        serverId: id,
        userId,
        username: user.username,
        displayName: user.displayName
      });
    }
    
    return res.status(200).json({
      message: 'Você saiu do servidor com sucesso'
    });
  } catch (error) {
    console.error('Erro ao sair do servidor:', error);
    return res.status(500).json({
      message: 'Erro ao sair do servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Criar canal
exports.createChannel = async (req, res) => {
  try {
    const { serverId } = req.params;
    const { name, type, isPrivate } = req.body;
    const userId = req.user.id;
    
    if (!name || !type) {
      return res.status(400).json({
        message: 'Nome e tipo são obrigatórios'
      });
    }
    
    // Verificar tipo válido
    const validTypes = ['text', 'voice', 'video', 'announcement'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        message: 'Tipo de canal inválido',
        validTypes
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
        message: 'Você não tem permissão para criar canais'
      });
    }
    
    // Verificar limite de canais (20 por tipo em servidores normais, 50 em premium)
    const server = await Server.findByPk(serverId);
    
    if (!server) {
      return res.status(404).json({
        message: 'Servidor não encontrado'
      });
    }
    
    const channelCount = await Channel.count({
      where: {
        serverId,
        type
      }
    });
    
    const limit = server.isPremium ? 50 : 20;
    
    if (channelCount >= limit) {
      return res.status(400).json({
        message: `Limite de ${limit} canais do tipo ${type} atingido${!server.isPremium ? '. Faça upgrade para Premium para aumentar o limite.' : ''}`
      });
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
    
    return res.status(201).json({
      message: 'Canal criado com sucesso',
      channel: {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        serverId,
        isPrivate: channel.isPrivate,
        position: channel.position
      }
    });
  } catch (error) {
    console.error('Erro ao criar canal:', error);
    return res.status(500).json({
      message: 'Erro ao criar canal',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};