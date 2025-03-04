const { redisClient } = require('../config/redis');
const { User, Server, Channel, UserServer } = require('../models');

module.exports = (io, socket) => {
  // Atualizar atividade do usuário
  const updateActivity = async (data) => {
    try {
      const userId = socket.user.id;
      const { activity } = data;
      
      // Atualizar atividade no Redis
      if (activity) {
        await redisClient.set(`user:${userId}:activity`, JSON.stringify(activity), 'EX', 300); // 5 minutos
      } else {
        await redisClient.del(`user:${userId}:activity`);
      }
      
      // Buscar servidores do usuário
      const userServers = await UserServer.findAll({
        where: { userId },
        attributes: ['serverId']
      });
      
      // Enviar atualização para servidores que o usuário participa
      // Mas apenas se não estiver invisível
      const isInvisible = await redisClient.get(`user:${userId}:invisible`);
      
      if (!isInvisible) {
        const serverIds = userServers.map(us => us.serverId);
        
        serverIds.forEach(serverId => {
          socket.to(`server:${serverId}`).emit('user_activity_changed', {
            userId,
            activity: activity || null
          });
        });
      }
    } catch (error) {
      console.error('Erro ao atualizar atividade:', error);
      socket.emit('error', { message: 'Erro ao atualizar atividade' });
    }
  };
  
  // Obter usuários em um canal de voz
  const getVoiceUsers = async (channelId) => {
    try {
      // Verificar canal
      const channel = await Channel.findByPk(channelId);
      
      if (!channel || channel.type !== 'voice') {
        return socket.emit('error', { message: 'Canal de voz não encontrado' });
      }
      
      // Verificar permissões
      const userServer = await UserServer.findOne({
        where: {
          userId: socket.user.id,
          serverId: channel.serverId
        }
      });
      
      if (!userServer) {
        return socket.emit('error', { message: 'Você não é membro deste servidor' });
      }
      
      // Buscar usuários no canal de voz
      const voiceUsers = await redisClient.smembers(`voice_channel:${channelId}:users`);
      
      if (!voiceUsers || voiceUsers.length === 0) {
        return socket.emit('voice_users', {
          channelId,
          users: []
        });
      }
      
      // Buscar detalhes dos usuários
      const users = await User.findAll({
        where: {
          id: voiceUsers
        },
        attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
      });
      
      // Adicionar status de microfone e auto-falante
      const voiceStatuses = await Promise.all(
        voiceUsers.map(async (userId) => {
          const micMuted = await redisClient.get(`voice_user:${userId}:mute`);
          const speakerMuted = await redisClient.get(`voice_user:${userId}:deaf`);
          return { userId, micMuted: !!micMuted, speakerMuted: !!speakerMuted };
        })
      );
      
      // Combinar dados
      const usersWithStatus = users.map(user => {
        const status = voiceStatuses.find(vs => vs.userId === user.id);
        return {
          ...user.toJSON(),
          micMuted: status ? status.micMuted : false,
          speakerMuted: status ? status.speakerMuted : false
        };
      });
      
      socket.emit('voice_users', {
        channelId,
        users: usersWithStatus
      });
    } catch (error) {
      console.error('Erro ao obter usuários do canal de voz:', error);
      socket.emit('error', { message: 'Erro ao obter usuários do canal de voz' });
    }
  };
  
  // Entrar em canal de voz
  const joinVoiceChannel = async (channelId) => {
    try {
      const userId = socket.user.id;
      
      // Verificar canal
      const channel = await Channel.findByPk(channelId);
      
      if (!channel || channel.type !== 'voice') {
        return socket.emit('error', { message: 'Canal de voz não encontrado' });
      }
      
      // Verificar permissões
      const userServer = await UserServer.findOne({
        where: {
          userId,
          serverId: channel.serverId
        }
      });
      
      if (!userServer) {
        return socket.emit('error', { message: 'Você não é membro deste servidor' });
      }
      
      // Verificar se já está em algum canal de voz
      const currentVoiceChannel = await redisClient.get(`user:${userId}:voice_channel`);
      
      if (currentVoiceChannel) {
        // Sair do canal anterior
        await redisClient.srem(`voice_channel:${currentVoiceChannel}:users`, userId);
        
        // Notificar outros usuários
        socket.to(`voice_channel:${currentVoiceChannel}`).emit('user_left_voice', {
          channelId: currentVoiceChannel,
          userId
        });
        
        // Sair da sala no Socket.IO
        socket.leave(`voice_channel:${currentVoiceChannel}`);
      }
      
      // Entrar no novo canal
      await redisClient.sadd(`voice_channel:${channelId}:users`, userId);
      await redisClient.set(`user:${userId}:voice_channel`, channelId);
      
      // Entrar na sala do Socket.IO
      socket.join(`voice_channel:${channelId}`);
      
      // Buscar usuários no canal
      const voiceUsers = await redisClient.smembers(`voice_channel:${channelId}:users`);
      
      // Buscar detalhes dos usuários
      const users = await User.findAll({
        where: {
          id: voiceUsers
        },
        attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
      });
      
      // Notificar o usuário que entrou com sucesso
      socket.emit('voice_channel_joined', {
        channelId,
        users
      });
      
      // Notificar outros usuários
      socket.to(`voice_channel:${channelId}`).emit('user_joined_voice', {
        channelId,
        user: {
          id: userId,
          username: socket.user.username,
          displayName: socket.user.displayName,
          avatar: socket.user.avatar,
          avatarType: socket.user.avatarType,
          micMuted: false,
          speakerMuted: false
        }
      });
    } catch (error) {
      console.error('Erro ao entrar no canal de voz:', error);
      socket.emit('error', { message: 'Erro ao entrar no canal de voz' });
    }
  };
  
  // Sair do canal de voz
  const leaveVoiceChannel = async () => {
    try {
      const userId = socket.user.id;
      
      // Verificar se está em algum canal de voz
      const currentVoiceChannel = await redisClient.get(`user:${userId}:voice_channel`);
      
      if (!currentVoiceChannel) {
        return socket.emit('voice_channel_left', { success: true });
      }
      
      // Sair do canal
      await redisClient.srem(`voice_channel:${currentVoiceChannel}:users`, userId);
      await redisClient.del(`user:${userId}:voice_channel`);
      await redisClient.del(`voice_user:${userId}:mute`);
      await redisClient.del(`voice_user:${userId}:deaf`);
      
      // Sair da sala no Socket.IO
      socket.leave(`voice_channel:${currentVoiceChannel}`);
      
      // Notificar o usuário que saiu com sucesso
      socket.emit('voice_channel_left', { success: true });
      
      // Notificar outros usuários
      socket.to(`voice_channel:${currentVoiceChannel}`).emit('user_left_voice', {
        channelId: currentVoiceChannel,
        userId
      });
    } catch (error) {
      console.error('Erro ao sair do canal de voz:', error);
      socket.emit('error', { message: 'Erro ao sair do canal de voz' });
    }
  };
  
  // Alternar microfone
  const toggleMute = async (isMuted) => {
    try {
      const userId = socket.user.id;
      
      // Verificar se está em algum canal de voz
      const currentVoiceChannel = await redisClient.get(`user:${userId}:voice_channel`);
      
      if (!currentVoiceChannel) {
        return socket.emit('error', { message: 'Você não está em um canal de voz' });
      }
      
      // Atualizar status do microfone
      if (isMuted) {
        await redisClient.set(`voice_user:${userId}:mute`, '1');
      } else {
        await redisClient.del(`voice_user:${userId}:mute`);
      }
      
      // Notificar todos no canal
      io.to(`voice_channel:${currentVoiceChannel}`).emit('user_mute_changed', {
        channelId: currentVoiceChannel,
        userId,
        isMuted
      });
      
      socket.emit('mute_success', { isMuted });
    } catch (error) {
      console.error('Erro ao alternar microfone:', error);
      socket.emit('error', { message: 'Erro ao alternar microfone' });
    }
  };
  
  // Alternar alto-falante
  const toggleDeafen = async (isDeafened) => {
    try {
      const userId = socket.user.id;
      
      // Verificar se está em algum canal de voz
      const currentVoiceChannel = await redisClient.get(`user:${userId}:voice_channel`);
      
      if (!currentVoiceChannel) {
        return socket.emit('error', { message: 'Você não está em um canal de voz' });
      }
      
      // Atualizar status do alto-falante
      if (isDeafened) {
        await redisClient.set(`voice_user:${userId}:deaf`, '1');
        // Se desativou o som, também deve mutar o microfone
        await redisClient.set(`voice_user:${userId}:mute`, '1');
      } else {
        await redisClient.del(`voice_user:${userId}:deaf`);
        // Não desmuta automaticamente o microfone
      }
      
      // Notificar todos no canal
      io.to(`voice_channel:${currentVoiceChannel}`).emit('user_deafen_changed', {
        channelId: currentVoiceChannel,
        userId,
        isDeafened
      });
      
      // Se desativou o som, também avisar que o microfone foi mutado
      if (isDeafened) {
        io.to(`voice_channel:${currentVoiceChannel}`).emit('user_mute_changed', {
          channelId: currentVoiceChannel,
          userId,
          isMuted: true
        });
      }
      
      socket.emit('deafen_success', { isDeafened });
    } catch (error) {
      console.error('Erro ao alternar alto-falante:', error);
      socket.emit('error', { message: 'Erro ao alternar alto-falante' });
    }
  };
  
  // Registrar handlers
  socket.on('update_activity', updateActivity);
  socket.on('get_voice_users', getVoiceUsers);
  socket.on('join_voice_channel', joinVoiceChannel);
  socket.on('leave_voice_channel', leaveVoiceChannel);
  socket.on('toggle_mute', toggleMute);
  socket.on('toggle_deafen', toggleDeafen);
};