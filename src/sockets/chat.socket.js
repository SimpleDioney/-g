const { Message, Channel, User, Server, UserServer } = require('../models');
const { redisClient, notificationQueue } = require('../config/redis');
const { Op } = require('sequelize');

module.exports = (io, socket) => {
  // Enviar mensagem
  const sendMessage = async (data) => {
    try {
      const { channelId, content, attachments, replyToId, type } = data;
      const userId = socket.user.id;
      
      // Verificar canal
      const channel = await Channel.findByPk(channelId, {
        include: [{ model: Server }]
      });
      
      if (!channel) {
        return socket.emit('error', { message: 'Canal não encontrado' });
      }
      
      // Verificar permissões
      const userServer = await UserServer.findOne({
        where: {
          userId,
          serverId: channel.Server.id
        }
      });
      
      if (!userServer) {
        return socket.emit('error', { message: 'Você não é membro deste servidor' });
      }
      
      // Verificar se é canal de anúncios
      if (channel.type === 'announcement' && 
          !['owner', 'admin'].includes(userServer.role)) {
        return socket.emit('error', { 
          message: 'Apenas administradores podem enviar mensagens neste canal' 
        });
      }
      
      // Verificar slow mode
      if (channel.slowMode > 0) {
        const lastMessageKey = `slowmode:${channelId}:${userId}`;
        const lastMessageTime = await redisClient.get(lastMessageKey);
        
        if (lastMessageTime) {
          const elapsedTime = Math.floor(Date.now() / 1000) - parseInt(lastMessageTime);
          
          if (elapsedTime < channel.slowMode) {
            return socket.emit('error', { 
              message: `Slow mode ativado. Aguarde mais ${channel.slowMode - elapsedTime} segundos.`
            });
          }
        }
        
        // Registrar tempo da mensagem
        await redisClient.set(lastMessageKey, Math.floor(Date.now() / 1000), 'EX', channel.slowMode * 2);
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
      
      // Enviar para todos no canal
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
          socket.emit('level_up', {
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
            channelId: channel.id,
            serverId: channel.Server.id,
            mentionedBy: user.username
          });
        });
      }
      
      socket.emit('message_sent', { messageId: message.id });
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      socket.emit('error', { message: 'Erro ao enviar mensagem' });
    }
  };
  
  // Entrar em um canal
  const joinChannel = async (channelId) => {
    try {
      // Verificar se o canal existe
      const channel = await Channel.findByPk(channelId, {
        include: [{ model: Server }]
      });
      
      if (!channel) {
        return socket.emit('error', { message: 'Canal não encontrado' });
      }
      
      // Verificar permissões
      const userServer = await UserServer.findOne({
        where: {
          userId: socket.user.id,
          serverId: channel.Server.id
        }
      });
      
      if (!userServer) {
        return socket.emit('error', { message: 'Você não é membro deste servidor' });
      }
      
      // Verificar permissões para canais privados
      if (channel.isPrivate) {
        // Implementar lógica de verificação de permissões específicas para o canal
        // ...
      }
      
      // Entrar na sala do canal
      socket.join(`channel:${channelId}`);
      
      // Buscar mensagens recentes
      const messages = await Message.findAll({
        where: { channelId },
        limit: 50,
        order: [['createdAt', 'DESC']],
        include: [
          {
            model: User,
            attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
          }
        ]
      });
      
      socket.emit('channel_joined', {
        channelId,
        messages: messages.reverse()
      });
    } catch (error) {
      console.error('Erro ao entrar no canal:', error);
      socket.emit('error', { message: 'Erro ao entrar no canal' });
    }
  };
  
  // Sair de um canal
  const leaveChannel = (channelId) => {
    socket.leave(`channel:${channelId}`);
    socket.emit('channel_left', { channelId });
  };
  
  // Digitar mensagem (typing indicator)
  const startTyping = async (channelId) => {
    try {
      const userId = socket.user.id;
      
      // Adicionar ao Redis com TTL de 5 segundos
      await redisClient.set(`typing:${channelId}:${userId}`, '1', 'EX', 5);
      
      // Avisar outros usuários no canal
      socket.to(`channel:${channelId}`).emit('user_typing', {
        channelId,
        userId,
        username: socket.user.username
      });
    } catch (error) {
      console.error('Erro ao iniciar digitação:', error);
    }
  };
  
  // Parar de digitar
  const stopTyping = async (channelId) => {
    try {
      const userId = socket.user.id;
      
      // Remover do Redis
      await redisClient.del(`typing:${channelId}:${userId}`);
      
      // Avisar outros usuários no canal
      socket.to(`channel:${channelId}`).emit('user_stop_typing', {
        channelId,
        userId
      });
    } catch (error) {
      console.error('Erro ao parar digitação:', error);
    }
  };
  
  // Reagir a uma mensagem
  const addReaction = async (data) => {
    try {
      const { messageId, reaction } = data;
      const userId = socket.user.id;
      
      // Buscar a mensagem
      const message = await Message.findByPk(messageId, {
        include: [{ model: Channel }]
      });
      
      if (!message) {
        return socket.emit('error', { message: 'Mensagem não encontrada' });
      }
      
      // Verificar se o usuário tem acesso ao canal
      const userServer = await UserServer.findOne({
        where: {
          userId,
          serverId: message.Channel.serverId
        }
      });
      
      if (!userServer) {
        return socket.emit('error', { message: 'Você não tem acesso a esta mensagem' });
      }
      
      // Adicionar reação
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
      
      // Enviar para todos no canal
      io.to(`channel:${message.channelId}`).emit('message_reaction', {
        messageId,
        reactions
      });
      
      // Enviar notificação ao autor se não for o próprio usuário
      if (message.userId !== userId && Object.keys(reactions).length > 0) {
        io.to(`user:${message.userId}`).emit('reaction_notification', {
          messageId,
          channelId: message.channelId,
          reaction,
          byUser: {
            id: userId,
            username: socket.user.username
          }
        });
      }
    } catch (error) {
      console.error('Erro ao adicionar reação:', error);
      socket.emit('error', { message: 'Erro ao processar reação' });
    }
  };
  
  // Editar mensagem
  const editMessage = async (data) => {
    try {
      const { messageId, content } = data;
      const userId = socket.user.id;
      
      // Buscar a mensagem
      const message = await Message.findByPk(messageId);
      
      if (!message) {
        return socket.emit('error', { message: 'Mensagem não encontrada' });
      }
      
      // Verificar propriedade da mensagem
      if (message.userId !== userId) {
        return socket.emit('error', { message: 'Você não pode editar esta mensagem' });
      }
      
      // Verificar tempo (permitir edição até 15 minutos)
      const messageTime = new Date(message.createdAt).getTime();
      const currentTime = new Date().getTime();
      const diffMinutes = (currentTime - messageTime) / (1000 * 60);
      
      if (diffMinutes > 15) {
        return socket.emit('error', { 
          message: 'Não é possível editar mensagens com mais de 15 minutos' 
        });
      }
      
      // Atualizar mensagem
      await message.update({
        content,
        isEdited: true
      });
      
      // Enviar para todos no canal
      io.to(`channel:${message.channelId}`).emit('message_updated', {
        messageId,
        content,
        isEdited: true,
        updatedAt: message.updatedAt
      });
      
      socket.emit('message_edit_success', { messageId });
    } catch (error) {
      console.error('Erro ao editar mensagem:', error);
      socket.emit('error', { message: 'Erro ao editar mensagem' });
    }
  };
  
  // Excluir mensagem
  const deleteMessage = async (data) => {
    try {
      const { messageId } = data;
      const userId = socket.user.id;
      
      // Buscar a mensagem
      const message = await Message.findByPk(messageId, {
        include: [{ model: Channel }]
      });
      
      if (!message) {
        return socket.emit('error', { message: 'Mensagem não encontrada' });
      }
      
      // Verificar permissões
      let canDelete = false;
      
      // Proprietário da mensagem sempre pode excluir
      if (message.userId === userId) {
        canDelete = true;
      } else {
        // Moderadores/Admins também podem excluir mensagens
        const userServer = await UserServer.findOne({
          where: {
            userId,
            serverId: message.Channel.serverId
          }
        });
        
        if (userServer && ['owner', 'admin', 'moderator'].includes(userServer.role)) {
          canDelete = true;
        }
      }
      
      if (!canDelete) {
        return socket.emit('error', { 
          message: 'Você não tem permissão para excluir esta mensagem' 
        });
      }
      
      // Armazenar ID para notificação
      const channelId = message.channelId;
      
      // Excluir mensagem
      await message.destroy();
      
      // Enviar para todos no canal
      io.to(`channel:${channelId}`).emit('message_deleted', {
        messageId
      });
      
      socket.emit('message_delete_success', { messageId });
    } catch (error) {
      console.error('Erro ao excluir mensagem:', error);
      socket.emit('error', { message: 'Erro ao excluir mensagem' });
    }
  };
  
  // Fixar mensagem
  const pinMessage = async (data) => {
    try {
      const { messageId } = data;
      const userId = socket.user.id;
      
      // Buscar a mensagem
      const message = await Message.findByPk(messageId, {
        include: [{ model: Channel }]
      });
      
      if (!message) {
        return socket.emit('error', { message: 'Mensagem não encontrada' });
      }
      
      // Verificar permissões
      const userServer = await UserServer.findOne({
        where: {
          userId,
          serverId: message.Channel.serverId
        }
      });
      
      if (!userServer || !['owner', 'admin', 'moderator'].includes(userServer.role)) {
        return socket.emit('error', { 
          message: 'Você não tem permissão para fixar mensagens'
        });
      }
      await message.update({
        isPinned: !message.isPinned
      });
      
      // Enviar para todos no canal
      io.to(`channel:${message.channelId}`).emit('message_pinned', {
        messageId,
        isPinned: message.isPinned
      });
      
      socket.emit('pin_success', { 
        messageId, 
        isPinned: message.isPinned 
      });
    } catch (error) {
      console.error('Erro ao fixar mensagem:', error);
      socket.emit('error', { message: 'Erro ao fixar mensagem' });
    }
  };
  
  // Buscar mensagens
  const fetchMessages = async (data) => {
    try {
      const { channelId, before, limit = 50 } = data;
      
      // Verificar canal
      const channel = await Channel.findByPk(channelId, {
        include: [{ model: Server }]
      });
      
      if (!channel) {
        return socket.emit('error', { message: 'Canal não encontrado' });
      }
      
      // Verificar permissões
      const userServer = await UserServer.findOne({
        where: {
          userId: socket.user.id,
          serverId: channel.Server.id
        }
      });
      
      if (!userServer) {
        return socket.emit('error', { message: 'Você não é membro deste servidor' });
      }
      
      // Construir query
      const query = {
        where: { channelId },
        limit: Math.min(limit, 100), // Limitar a 100 mensagens no máximo
        order: [['createdAt', 'DESC']],
        include: [
          {
            model: User,
            attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
          }
        ]
      };
      
      // Adicionar filtro para paginação
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
      
      socket.emit('messages_fetched', {
        channelId,
        messages: messages.reverse(),
        hasMore: messages.length === limit
      });
    } catch (error) {
      console.error('Erro ao buscar mensagens:', error);
      socket.emit('error', { message: 'Erro ao buscar mensagens' });
    }
  };
  
  // Agendar mensagem
  const scheduleMessage = async (data) => {
    try {
      const { channelId, content, scheduledFor, attachments, type } = data;
      const userId = socket.user.id;
      
      // Verificar canal
      const channel = await Channel.findByPk(channelId, {
        include: [{ model: Server }]
      });
      
      if (!channel) {
        return socket.emit('error', { message: 'Canal não encontrado' });
      }
      
      // Verificar permissões
      const userServer = await UserServer.findOne({
        where: {
          userId,
          serverId: channel.Server.id
        }
      });
      
      if (!userServer) {
        return socket.emit('error', { message: 'Você não é membro deste servidor' });
      }
      
      // Validar data de agendamento (mínimo 5 minutos no futuro)
      const scheduleDate = new Date(scheduledFor);
      const now = new Date();
      
      if (scheduleDate <= now) {
        return socket.emit('error', { message: 'Data de agendamento deve ser no futuro' });
      }
      
      const diffMinutes = (scheduleDate - now) / (1000 * 60);
      
      if (diffMinutes < 5) {
        return socket.emit('error', { 
          message: 'Mensagens devem ser agendadas com pelo menos 5 minutos de antecedência' 
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
      
      // Confirmar agendamento
      socket.emit('message_scheduled', {
        messageId: message.id,
        scheduledFor: message.scheduledFor
      });
      
      // Adicionar à fila de processamento
      const delay = scheduleDate - now;
      await redisClient.set(`scheduled_message:${message.id}`, '1', 'PX', delay);
      
      console.log(`Mensagem ${message.id} agendada para ${scheduleDate}`);
    } catch (error) {
      console.error('Erro ao agendar mensagem:', error);
      socket.emit('error', { message: 'Erro ao agendar mensagem' });
    }
  };
  
  // Configurar mensagem autodestrutiva
  const setMessageExpiry = async (data) => {
    try {
      const { messageId, expiresIn } = data; // expiresIn em segundos
      const userId = socket.user.id;
      
      // Verificar limites (mínimo 5 segundos, máximo 24 horas)
      if (expiresIn < 5 || expiresIn > 86400) {
        return socket.emit('error', { 
          message: 'Tempo de expiração deve estar entre 5 segundos e 24 horas' 
        });
      }
      
      // Buscar a mensagem
      const message = await Message.findByPk(messageId);
      
      if (!message) {
        return socket.emit('error', { message: 'Mensagem não encontrada' });
      }
      
      // Verificar propriedade da mensagem
      if (message.userId !== userId) {
        return socket.emit('error', { 
          message: 'Você só pode configurar autodestruction em suas próprias mensagens' 
        });
      }
      
      // Calcular data de expiração
      const expiresAt = new Date(Date.now() + expiresIn * 1000);
      
      // Atualizar mensagem
      await message.update({ expiresAt });
      
      // Enviar para todos no canal
      io.to(`channel:${message.channelId}`).emit('message_expiry_set', {
        messageId,
        expiresAt
      });
      
      // Configurar exclusão automática
      await redisClient.set(`expiring_message:${messageId}`, '1', 'EX', expiresIn);
      
      socket.emit('expiry_set_success', { messageId, expiresAt });
    } catch (error) {
      console.error('Erro ao configurar expiração:', error);
      socket.emit('error', { message: 'Erro ao configurar expiração da mensagem' });
    }
  };
  
  // Buscar mensagens fixadas
  const fetchPinnedMessages = async (channelId) => {
    try {
      // Verificar canal
      const channel = await Channel.findByPk(channelId, {
        include: [{ model: Server }]
      });
      
      if (!channel) {
        return socket.emit('error', { message: 'Canal não encontrado' });
      }
      
      // Verificar permissões
      const userServer = await UserServer.findOne({
        where: {
          userId: socket.user.id,
          serverId: channel.Server.id
        }
      });
      
      if (!userServer) {
        return socket.emit('error', { message: 'Você não é membro deste servidor' });
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
        order: [['createdAt', 'DESC']]
      });
      
      socket.emit('pinned_messages', {
        channelId,
        messages: pinnedMessages
      });
    } catch (error) {
      console.error('Erro ao buscar mensagens fixadas:', error);
      socket.emit('error', { message: 'Erro ao buscar mensagens fixadas' });
    }
  };
  
  // Criar enquete
  const createPoll = async (data) => {
    try {
      const { channelId, question, options, expiresIn } = data;
      const userId = socket.user.id;
      
      // Validar dados
      if (!question || !options || !Array.isArray(options) || options.length < 2) {
        return socket.emit('error', { 
          message: 'Enquete precisa de uma pergunta e pelo menos 2 opções' 
        });
      }
      
      // Verificar canal
      const channel = await Channel.findByPk(channelId, {
        include: [{ model: Server }]
      });
      
      if (!channel) {
        return socket.emit('error', { message: 'Canal não encontrado' });
      }
      
      // Verificar permissões
      const userServer = await UserServer.findOne({
        where: {
          userId,
          serverId: channel.Server.id
        }
      });
      
      if (!userServer) {
        return socket.emit('error', { message: 'Você não é membro deste servidor' });
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
      io.to(`channel:${channelId}`).emit('poll_created', messageData);
      
      // Configurar expiração se necessário
      if (pollData.expiresAt) {
        const timeUntilExpiry = (new Date(pollData.expiresAt) - new Date()) / 1000;
        await redisClient.set(`poll_expiry:${message.id}`, '1', 'EX', timeUntilExpiry);
      }
      
      socket.emit('poll_create_success', { messageId: message.id });
    } catch (error) {
      console.error('Erro ao criar enquete:', error);
      socket.emit('error', { message: 'Erro ao criar enquete' });
    }
  };
  
  // Votar em enquete
  const votePoll = async (data) => {
    try {
      const { messageId, optionIndex } = data;
      const userId = socket.user.id;
      
      // Buscar a mensagem
      const message = await Message.findByPk(messageId);
      
      if (!message || message.type !== 'poll') {
        return socket.emit('error', { message: 'Enquete não encontrada' });
      }
      
      const poll = message.attachments;
      
      // Verificar se a enquete expirou
      if (poll.expiresAt && new Date(poll.expiresAt) < new Date()) {
        return socket.emit('error', { message: 'Esta enquete já expirou' });
      }
      
      // Verificar se a opção é válida
      if (optionIndex < 0 || optionIndex >= poll.options.length) {
        return socket.emit('error', { message: 'Opção inválida' });
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
      
      // Enviar para todos no canal
      io.to(`channel:${message.channelId}`).emit('poll_updated', {
        messageId,
        poll: pollResults
      });
      
      socket.emit('vote_success', { 
        messageId, 
        selectedOption: optionIndex 
      });
    } catch (error) {
      console.error('Erro ao votar em enquete:', error);
      socket.emit('error', { message: 'Erro ao processar voto' });
    }
  };
  
  // Registrar handlers
  socket.on('send_message', sendMessage);
  socket.on('join_channel', joinChannel);
  socket.on('leave_channel', leaveChannel);
  socket.on('start_typing', startTyping);
  socket.on('stop_typing', stopTyping);
  socket.on('add_reaction', addReaction);
  socket.on('edit_message', editMessage);
  socket.on('delete_message', deleteMessage);
  socket.on('pin_message', pinMessage);
  socket.on('fetch_messages', fetchMessages);
  socket.on('schedule_message', scheduleMessage);
  socket.on('set_message_expiry', setMessageExpiry);
  socket.on('fetch_pinned_messages', fetchPinnedMessages);
  socket.on('create_poll', createPoll);
  socket.on('vote_poll', votePoll);
};
