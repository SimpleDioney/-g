const { Notification, User } = require('../models');
const { getIO } = require('../config/socketio');
const { redisClient } = require('../config/redis');

class NotificationService {
  /**
   * Criar uma nova notificação
   * @param {Object} data - Dados da notificação
   * @returns {Promise<Object>} Notificação criada
   */
  async create(data) {
    const { userId, title, message, type, sourceId, sourceType, data: extraData } = data;
    
    // Verificar preferências do usuário
    const prefsData = await redisClient.get(`user:${userId}:notification_prefs`);
    const prefs = prefsData ? JSON.parse(prefsData) : {
      mentions: true,
      messages: true,
      friendRequests: true,
      reactions: true,
      videoLikes: true,
      videoComments: true,
      systemNotifications: true
    };
    
    // Verificar se o tipo de notificação está habilitado
    let shouldSend = true;
    
    switch (type) {
      case 'mention':
        shouldSend = prefs.mentions;
        break;
      case 'message':
        shouldSend = prefs.messages;
        break;
      case 'friend_request':
        shouldSend = prefs.friendRequests;
        break;
      case 'reaction':
        shouldSend = prefs.reactions;
        break;
      case 'video_like':
        shouldSend = prefs.videoLikes;
        break;
      case 'video_comment':
        shouldSend = prefs.videoComments;
        break;
      case 'system':
        shouldSend = prefs.systemNotifications;
        break;
      default:
        shouldSend = true;
    }
    
    if (!shouldSend) {
      return { skipped: true, reason: `User disabled ${type} notifications` };
    }
    
    // Criar notificação
    const notification = await Notification.create({
      userId,
      title,
      message,
      type,
      sourceId,
      sourceType,
      data: extraData
    });
    
    // Enviar notificação em tempo real
    const io = getIO();
    io.to(`user:${userId}`).emit('new_notification', notification);
    
    return notification;
  }
  
  /**
   * Obter notificações de um usuário
   * @param {string} userId - ID do usuário
   * @param {Object} options - Opções de busca
   * @returns {Promise<Object>} Notificações encontradas
   */
  async getForUser(userId, options = {}) {
    const { page = 1, limit = 20, unreadOnly = false } = options;
    const offset = (page - 1) * limit;
    
    // Construir query
    const query = {
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    };
    
    // Filtrar apenas não lidas se solicitado
    if (unreadOnly === true) {
      query.where.isRead = false;
    }
    
    // Buscar notificações
    const notifications = await Notification.findAndCountAll(query);
    
    // Verificar se há mais páginas
    const totalPages = Math.ceil(notifications.count / limit);
    const hasMore = page < totalPages;
    
    // Contar não lidas
    const unreadCount = await Notification.count({
      where: {
        userId,
        isRead: false
      }
    });
    
    return {
      notifications: notifications.rows,
      totalCount: notifications.count,
      unreadCount,
      currentPage: parseInt(page),
      totalPages,
      hasMore
    };
  }
  
  /**
   * Marcar notificação como lida
   * @param {string} id - ID da notificação
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Resultado da operação
   */
  async markAsRead(id, userId) {
    // Verificar se é para marcar todas
    if (id === 'all') {
      await Notification.update(
        { isRead: true },
        { where: { userId, isRead: false } }
      );
      
      return { success: true, message: 'Todas as notificações foram marcadas como lidas' };
    }
    
    // Buscar notificação específica
    const notification = await Notification.findOne({
      where: {
        id,
        userId
      }
    });
    
    if (!notification) {
      throw {
        statusCode: 404,
        message: 'Notificação não encontrada'
      };
    }
    
    // Marcar como lida
    await notification.update({ isRead: true });
    
    return { success: true, notification };
  }
  
  /**
   * Excluir notificação
   * @param {string} id - ID da notificação
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Resultado da operação
   */
  async delete(id, userId) {
    // Verificar se é para excluir todas
    if (id === 'all') {
      await Notification.destroy({
        where: { userId }
      });
      
      return { success: true, message: 'Todas as notificações foram excluídas' };
    }
    
    // Buscar notificação específica
    const notification = await Notification.findOne({
      where: {
        id,
        userId
      }
    });
    
    if (!notification) {
      throw {
        statusCode: 404,
        message: 'Notificação não encontrada'
      };
    }
    
    // Excluir
    await notification.destroy();
    
    return { success: true };
  }
  
  /**
   * Atualizar preferências de notificação
   * @param {string} userId - ID do usuário
   * @param {Object} preferences - Preferências de notificação
   * @returns {Promise<Object>} Preferências atualizadas
   */
  async updatePreferences(userId, preferences) {
    const { 
      mentions = true, 
      messages = true, 
      friendRequests = true,
      reactions = true,
      videoLikes = true,
      videoComments = true,
      systemNotifications = true
    } = preferences;
    
    // Armazenar preferências no Redis
    const prefs = {
      mentions,
      messages,
      friendRequests,
      reactions,
      videoLikes,
      videoComments,
      systemNotifications
    };
    
    await redisClient.set(`user:${userId}:notification_prefs`, JSON.stringify(prefs));
    
    return { success: true, preferences: prefs };
  }
  
  /**
   * Obter preferências de notificação
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Preferências de notificação
   */
  async getPreferences(userId) {
    // Buscar preferências no Redis
    const prefsData = await redisClient.get(`user:${userId}:notification_prefs`);
    
    // Valores padrão se não encontrado
    const defaultPrefs = {
      mentions: true,
      messages: true,
      friendRequests: true,
      reactions: true,
      videoLikes: true,
      videoComments: true,
      systemNotifications: true
    };
    
    const preferences = prefsData ? JSON.parse(prefsData) : defaultPrefs;
    
    return { preferences };
  }
  
  /**
   * Verificar streak diária do usuário
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Dados da streak
   */
  async checkStreak(userId) {
    // Obter data da última visita
    const lastVisitKey = `user:${userId}:last_visit`;
    const currentStreakKey = `user:${userId}:current_streak`;
    const maxStreakKey = `user:${userId}:max_streak`;
    
    let lastVisit = await redisClient.get(lastVisitKey);
    let currentStreak = parseInt(await redisClient.get(currentStreakKey) || '0');
    let maxStreak = parseInt(await redisClient.get(maxStreakKey) || '0');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayStr = today.toISOString().split('T')[0];
    
    if (!lastVisit) {
      // Primeira visita
      currentStreak = 1;
      maxStreak = 1;
    } else {
      const lastVisitDate = new Date(lastVisit);
      lastVisitDate.setHours(0, 0, 0, 0);
      
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const lastVisitStr = lastVisitDate.toISOString().split('T')[0];
      
      if (lastVisitStr === todayStr) {
        // Já visitou hoje, não faz nada
      } else if (lastVisitDate.getTime() === yesterday.getTime()) {
        // Visitou ontem, incrementa streak
        currentStreak += 1;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
        }
      } else {
        // Quebrou a sequência
        currentStreak = 1;
      }
    }
    
    // Atualizar dados no Redis
    await redisClient.set(lastVisitKey, todayStr);
    await redisClient.set(currentStreakKey, currentStreak.toString());
    await redisClient.set(maxStreakKey, maxStreak.toString());
    
    // Verificar recompensa por streak
    let rewardEarned = false;
    let rewardAmount = 0;
    
    // Dar recompensas a cada 5 dias de streak
    if (currentStreak % 5 === 0) {
      rewardAmount = Math.min(50, 10 * Math.floor(currentStreak / 5));
      
      // Verificar se já recebeu a recompensa deste marco
      const rewardKey = `user:${userId}:streak_reward:${currentStreak}`;
      const alreadyRewarded = await redisClient.get(rewardKey);
      
      if (!alreadyRewarded) {
        // Atribuir tokens ao usuário
        await User.increment('tokens', {
          by: rewardAmount,
          where: { id: userId }
        });
        
        // Marcar recompensa como recebida
        await redisClient.set(rewardKey, '1');
        rewardEarned = true;
        
        // Criar notificação
        await this.create({
          userId,
          title: 'Recompensa de sequência diária',
          message: `Parabéns! Você ganhou ${rewardAmount} tokens por manter uma sequência de ${currentStreak} dias.`,
          type: 'system',
          data: {
            streakDays: currentStreak,
            reward: rewardAmount
          }
        });
      }
    }
    
    return {
      currentStreak,
      maxStreak,
      lastVisit: todayStr,
      rewardEarned,
      rewardAmount
    };
  }
}

module.exports = new NotificationService();