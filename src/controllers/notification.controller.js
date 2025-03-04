const { Notification, User } = require('../models');
const { redisClient, notificationQueue } = require('../config/redis');
const { getIO } = require('../config/socketio');
const { Op } = require('sequelize');

// Obter todas as notificações do usuário
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const offset = (page - 1) * limit;
    
    // Construir query
    const query = {
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    };
    
    // Filtrar apenas não lidas se solicitado
    if (unreadOnly === 'true') {
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
    
    return res.status(200).json({
      notifications: notifications.rows,
      totalCount: notifications.count,
      unreadCount,
      currentPage: parseInt(page),
      totalPages,
      hasMore
    });
  } catch (error) {
    console.error('Erro ao obter notificações:', error);
    return res.status(500).json({
      message: 'Erro ao carregar notificações',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Marcar notificação como lida
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    
    // Verificar se é para marcar todas
    if (id === 'all') {
      await Notification.update(
        { isRead: true },
        { where: { userId, isRead: false } }
      );
      
      return res.status(200).json({
        message: 'Todas as notificações foram marcadas como lidas'
      });
    }
    
    // Buscar notificação específica
    const notification = await Notification.findOne({
      where: {
        id,
        userId
      }
    });
    
    if (!notification) {
      return res.status(404).json({ message: 'Notificação não encontrada' });
    }
    
    // Marcar como lida
    await notification.update({ isRead: true });
    
    return res.status(200).json({
      message: 'Notificação marcada como lida',
      notification
    });
  } catch (error) {
    console.error('Erro ao marcar notificação:', error);
    return res.status(500).json({
      message: 'Erro ao marcar notificação como lida',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Excluir notificação
exports.deleteNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    
    // Verificar se é para excluir todas
    if (id === 'all') {
      await Notification.destroy({
        where: { userId }
      });
      
      return res.status(200).json({
        message: 'Todas as notificações foram excluídas'
      });
    }
    
    // Buscar notificação específica
    const notification = await Notification.findOne({
      where: {
        id,
        userId
      }
    });
    
    if (!notification) {
      return res.status(404).json({ message: 'Notificação não encontrada' });
    }
    
    // Excluir
    await notification.destroy();
    
    return res.status(200).json({
      message: 'Notificação excluída com sucesso'
    });
  } catch (error) {
    console.error('Erro ao excluir notificação:', error);
    return res.status(500).json({
      message: 'Erro ao excluir notificação',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter contagem de notificações não lidas
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Contar notificações não lidas
    const unreadCount = await Notification.count({
      where: {
        userId,
        isRead: false
      }
    });
    
    return res.status(200).json({ unreadCount });
  } catch (error) {
    console.error('Erro ao contar notificações não lidas:', error);
    return res.status(500).json({
      message: 'Erro ao contar notificações não lidas',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Configurar preferências de notificação
exports.updatePreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      mentions = true, 
      messages = true, 
      friendRequests = true,
      reactions = true,
      videoLikes = true,
      videoComments = true,
      systemNotifications = true
    } = req.body;
    
    // Armazenar preferências no Redis
    const preferences = {
      mentions,
      messages,
      friendRequests,
      reactions,
      videoLikes,
      videoComments,
      systemNotifications
    };
    
    await redisClient.set(`user:${userId}:notification_prefs`, JSON.stringify(preferences));
    
    return res.status(200).json({
      message: 'Preferências de notificação atualizadas',
      preferences
    });
  } catch (error) {
    console.error('Erro ao atualizar preferências:', error);
    return res.status(500).json({
      message: 'Erro ao atualizar preferências de notificação',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter preferências de notificação
exports.getPreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    
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
    
    return res.status(200).json({ preferences });
  } catch (error) {
    console.error('Erro ao obter preferências:', error);
    return res.status(500).json({
      message: 'Erro ao obter preferências de notificação',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};