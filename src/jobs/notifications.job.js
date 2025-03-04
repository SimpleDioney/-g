const { notificationQueue } = require('../config/redis');
const { Notification, User, Message, Channel, Server, Video, VideoComment } = require('../models');
const { getIO } = require('../config/socketio');

// Processar notificação de menção
notificationQueue.process('mention', async (job) => {
  const { userId, messageId, channelId, serverId, mentionedBy } = job.data;
  
  try {
    // Verificar preferências do usuário
    const prefsData = await redisClient.get(`user:${userId}:notification_prefs`);
    const prefs = prefsData ? JSON.parse(prefsData) : { mentions: true };
    
    if (!prefs.mentions) {
      return { skipped: true, reason: 'User disabled mention notifications' };
    }
    
    // Buscar informações adicionais
    const [channel, server, mentioner] = await Promise.all([
      Channel.findByPk(channelId, { attributes: ['name'] }),
      Server.findByPk(serverId, { attributes: ['name'] }),
      User.findOne({ where: { username: mentionedBy }, attributes: ['username', 'displayName'] })
    ]);
    
    if (!channel || !server || !mentioner) {
      throw new Error('Dados incompletos para notificação de menção');
    }
    
    // Criar notificação
    const notification = await Notification.create({
      userId,
      title: `Menção em ${server.name}`,
      message: `${mentioner.displayName || mentioner.username} mencionou você no canal #${channel.name}`,
      type: 'mention',
      sourceId: messageId,
      sourceType: 'message',
      data: {
        serverId,
        channelId,
        mentionedBy: mentionedBy
      }
    });
    
    // Enviar notificação em tempo real
    const io = getIO();
    io.to(`user:${userId}`).emit('new_notification', notification);
    
    return { success: true, notificationId: notification.id };
  } catch (error) {
    console.error('Erro ao processar notificação de menção:', error);
    throw error;
  }
});

// Processar notificação de curtida em vídeo
notificationQueue.process('videoLike', async (job) => {
  const { userId, likedBy, videoId } = job.data;
  
  try {
    // Verificar preferências do usuário
    const prefsData = await redisClient.get(`user:${userId}:notification_prefs`);
    const prefs = prefsData ? JSON.parse(prefsData) : { videoLikes: true };
    
    if (!prefs.videoLikes) {
      return { skipped: true, reason: 'User disabled video like notifications' };
    }
    
    // Buscar informações adicionais
    const [video, liker] = await Promise.all([
      Video.findByPk(videoId, { attributes: ['title'] }),
      User.findByPk(likedBy, { attributes: ['username', 'displayName'] })
    ]);
    
    if (!video || !liker) {
      throw new Error('Dados incompletos para notificação de curtida');
    }
    
    // Criar notificação
    const notification = await Notification.create({
      userId,
      title: 'Novo like em seu vídeo',
      message: `${liker.displayName || liker.username} curtiu seu vídeo "${video.title}"`,
      type: 'system',
      sourceId: videoId,
      sourceType: 'video',
      data: {
        videoId,
        likedBy
      }
    });
    
    // Enviar notificação em tempo real
    const io = getIO();
    io.to(`user:${userId}`).emit('new_notification', notification);
    
    return { success: true, notificationId: notification.id };
  } catch (error) {
    console.error('Erro ao processar notificação de curtida em vídeo:', error);
    throw error;
  }
});

// Processar notificação de comentário em vídeo
notificationQueue.process('videoComment', async (job) => {
  const { userId, commentedBy, videoId, commentId } = job.data;
  
  try {
    // Verificar preferências do usuário
    const prefsData = await redisClient.get(`user:${userId}:notification_prefs`);
    const prefs = prefsData ? JSON.parse(prefsData) : { videoComments: true };
    
    if (!prefs.videoComments) {
      return { skipped: true, reason: 'User disabled video comment notifications' };
    }
    
    // Buscar informações adicionais
    const [video, commenter] = await Promise.all([
      Video.findByPk(videoId, { attributes: ['title'] }),
      User.findByPk(commentedBy, { attributes: ['username', 'displayName'] })
    ]);
    
    if (!video || !commenter) {
      throw new Error('Dados incompletos para notificação de comentário');
    }
    
    // Criar notificação
    const notification = await Notification.create({
      userId,
      title: 'Novo comentário em seu vídeo',
      message: `${commenter.displayName || commenter.username} comentou em seu vídeo "${video.title}"`,
      type: 'system',
      sourceId: videoId,
      sourceType: 'video',
      data: {
        videoId,
        commentId,
        commentedBy
      }
    });
    
    // Enviar notificação em tempo real
    const io = getIO();
    io.to(`user:${userId}`).emit('new_notification', notification);
    
    return { success: true, notificationId: notification.id };
  } catch (error) {
    console.error('Erro ao processar notificação de comentário em vídeo:', error);
    throw error;
  }
});

// Processar notificação de resposta a comentário
notificationQueue.process('commentReply', async (job) => {
  const { userId, repliedBy, videoId, commentId, parentCommentId } = job.data;
  
  try {
    // Verificar preferências do usuário
    const prefsData = await redisClient.get(`user:${userId}:notification_prefs`);
    const prefs = prefsData ? JSON.parse(prefsData) : { videoComments: true };
    
    if (!prefs.videoComments) {
      return { skipped: true, reason: 'User disabled video comment notifications' };
    }
    
    // Buscar informações adicionais
    const [video, replier] = await Promise.all([
      Video.findByPk(videoId, { attributes: ['title'] }),
      User.findByPk(repliedBy, { attributes: ['username', 'displayName'] })
    ]);
    
    if (!video || !replier) {
      throw new Error('Dados incompletos para notificação de resposta');
    }
    
    // Criar notificação
    const notification = await Notification.create({
      userId,
      title: 'Nova resposta ao seu comentário',
      message: `${replier.displayName || replier.username} respondeu ao seu comentário no vídeo "${video.title}"`,
      type: 'system',
      sourceId: videoId,
      sourceType: 'video',
      data: {
        videoId,
        commentId,
        parentCommentId,
        repliedBy
      }
    });
    
    // Enviar notificação em tempo real
    const io = getIO();
    io.to(`user:${userId}`).emit('new_notification', notification);
    
    return { success: true, notificationId: notification.id };
  } catch (error) {
    console.error('Erro ao processar notificação de resposta a comentário:', error);
    throw error;
  }
});

// Processar notificação de reação a mensagem
notificationQueue.process('messageReaction', async (job) => {
  const { userId, messageId, channelId, serverId, reactionBy, reaction } = job.data;
  
  try {
    // Verificar preferências do usuário
    const prefsData = await redisClient.get(`user:${userId}:notification_prefs`);
    const prefs = prefsData ? JSON.parse(prefsData) : { reactions: true };
    
    if (!prefs.reactions) {
      return { skipped: true, reason: 'User disabled reaction notifications' };
    }
    
    // Buscar informações adicionais
    const [channel, server, reactor] = await Promise.all([
      Channel.findByPk(channelId, { attributes: ['name'] }),
      Server.findByPk(serverId, { attributes: ['name'] }),
      User.findByPk(reactionBy, { attributes: ['username', 'displayName'] })
    ]);
    
    if (!channel || !server || !reactor) {
      throw new Error('Dados incompletos para notificação de reação');
    }
    
    // Criar notificação
    const notification = await Notification.create({
      userId,
      title: `Nova reação em ${server.name}`,
      message: `${reactor.displayName || reactor.username} reagiu à sua mensagem com ${reaction} no canal #${channel.name}`,
      type: 'system',
      sourceId: messageId,
      sourceType: 'message',
      data: {
        serverId,
        channelId,
        messageId,
        reactionBy,
        reaction
      }
    });
    
    // Enviar notificação em tempo real
    const io = getIO();
    io.to(`user:${userId}`).emit('new_notification', notification);
    
    return { success: true, notificationId: notification.id };
  } catch (error) {
    console.error('Erro ao processar notificação de reação:', error);
    throw error;
  }
});