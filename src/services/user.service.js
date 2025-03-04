const { User, Server, UserServer, Video, Transaction } = require('../models');
const { redisClient } = require('../config/redis');
const { Op } = require('sequelize');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const { promisify } = require('util');
const unlinkAsync = promisify(fs.unlink);

class UserService {
  /**
   * Obter perfil de usuário
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Dados do perfil
   */
  async getProfile(userId) {
    const user = await User.findByPk(userId, {
      attributes: { 
        exclude: ['password', 'refreshToken', 'twoFactorSecret']
      }
    });
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Adicionar dados em tempo real do Redis
    const status = await redisClient.get(`user:${userId}:status`) || 'offline';
    const activityData = await redisClient.get(`user:${userId}:activity`);
    const activity = activityData ? JSON.parse(activityData) : null;
    
    // Estatísticas
    const serverCount = await UserServer.count({ where: { userId } });
    const videoCount = await Video.count({ where: { userId } });
    
    // Obter o servidor mais recente para exibir como destaque
    const latestServer = await UserServer.findOne({
      where: { userId },
      include: [{ model: Server, attributes: ['id', 'name', 'icon'] }],
      order: [['createdAt', 'DESC']]
    });
    
    return {
      user: {
        ...user.toJSON(),
        status,
        activity
      },
      stats: {
        serverCount,
        videoCount,
        latestServer: latestServer ? {
          id: latestServer.Server.id,
          name: latestServer.Server.name,
          icon: latestServer.Server.icon
        } : null
      }
    };
  }
  
  /**
   * Atualizar perfil de usuário
   * @param {string} userId - ID do usuário
   * @param {Object} updateData - Dados para atualização
   * @returns {Promise<Object>} Perfil atualizado
   */
  async updateProfile(userId, updateData) {
    const { displayName, bio, status } = updateData;
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Dados a atualizar
    const dataToUpdate = {};
    
    if (displayName !== undefined) dataToUpdate.displayName = displayName;
    if (bio !== undefined) dataToUpdate.bio = bio;
    
    // Atualizar usuário
    await user.update(dataToUpdate);
    
    // Atualizar status se fornecido
    if (status) {
      const validStatuses = ['online', 'away', 'busy', 'invisible', 'offline'];
      
      if (validStatuses.includes(status)) {
        await user.update({ status });
        
        // Atualizar no Redis
        if (status === 'invisible') {
          await redisClient.set(`user:${userId}:status`, 'offline');
          await redisClient.set(`user:${userId}:invisible`, '1');
        } else {
          await redisClient.set(`user:${userId}:status`, status);
          await redisClient.del(`user:${userId}:invisible`);
        }
        
        // Notificar servidores via WebSockets
        if (status !== 'invisible') {
          const userServers = await UserServer.findAll({
            where: { userId },
            attributes: ['serverId']
          });
          
          const io = require('../config/socketio').getIO();
          
          userServers.forEach(({ serverId }) => {
            io.to(`server:${serverId}`).emit('user_status_changed', {
              userId,
              status
            });
          });
        }
      }
    }
    
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      status: status || user.status,
      avatar: user.avatar,
      avatarType: user.avatarType
    };
  }
  
  /**
   * Fazer upload de avatar
   * @param {Object} data - Dados do upload
   * @returns {Promise<Object>} URL do avatar
   */
  async uploadAvatar(data) {
    const { userId, filePath, avatarType } = data;
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    try {
      // Upload para Cloudinary
      const result = await cloudinary.uploader.upload(filePath, {
        folder: 'avatars',
        transformation: [
          { width: 256, height: 256, crop: 'fill' }
        ]
      });
      
      // Remover avatar antigo do Cloudinary se existir
      if (user.avatar && user.avatar.includes('cloudinary')) {
        try {
          const publicId = user.avatar.split('/').pop().split('.')[0];
          await cloudinary.uploader.destroy(publicId);
        } catch (error) {
          console.error('Erro ao remover avatar antigo:', error);
        }
      }
      
      // Atualizar no banco de dados
      await user.update({
        avatar: result.secure_url,
        avatarType: avatarType || 'image'
      });
      
      // Remover arquivo temporário
      await unlinkAsync(filePath);
      
      return {
        avatar: result.secure_url,
        avatarType: avatarType || 'image'
      };
    } catch (error) {
      // Remover arquivo temporário em caso de erro
      try {
        await unlinkAsync(filePath);
      } catch (unlinkError) {
        console.error('Erro ao remover arquivo temporário:', unlinkError);
      }
      
      throw error;
    }
  }
  
  /**
   * Alterar senha do usuário
   * @param {string} userId - ID do usuário
   * @param {string} currentPassword - Senha atual
   * @param {string} newPassword - Nova senha
   * @returns {Promise<Object>} Resultado da operação
   */
  async changePassword(userId, currentPassword, newPassword) {
    const user = await User.findByPk(userId);
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Verificar senha atual
    const isValid = await user.checkPassword(currentPassword);
    
    if (!isValid) {
      throw {
        statusCode: 401,
        message: 'Senha atual incorreta'
      };
    }
    
    // Atualizar senha
    await user.update({ password: newPassword });
    
    // Invalidar todos os refresh tokens
    if (user.refreshToken) {
      await user.update({ refreshToken: null });
    }
    
    return { success: true };
  }
  
  /**
   * Obter servidores do usuário
   * @param {string} userId - ID do usuário
   * @returns {Promise<Array>} Servidores do usuário
   */
  async getUserServers(userId) {
    const userServers = await UserServer.findAll({
      where: { userId },
      include: [{ model: Server }],
      order: [[Server, 'name', 'ASC']]
    });
    
    // Formatar resposta
    return userServers.map(us => ({
      id: us.Server.id,
      name: us.Server.name,
      description: us.Server.description,
      icon: us.Server.icon,
      role: us.role,
      joinedAt: us.joinedAt
    }));
  }
  
  /**
   * Obter vídeos do usuário
   * @param {Object} params - Parâmetros de busca
   * @returns {Promise<Object>} Vídeos do usuário
   */
  async getUserVideos(params) {
    const { id, page = 1, limit = 20, requestingUserId } = params;
    const offset = (page - 1) * limit;
    
    // Verificar se o usuário existe
    const user = await User.findByPk(id, {
      attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
    });
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Buscar vídeos do usuário
    const videos = await Video.findAndCountAll({
      where: {
        userId: id,
        status: 'published',
        ...(requestingUserId !== id ? { isPublic: true } : {}) // Se não for o próprio usuário, mostrar apenas públicos
      },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    // Verificar se há mais páginas
    const totalPages = Math.ceil(videos.count / limit);
    const hasMore = page < totalPages;
    
    return {
      user,
      videos: videos.rows,
      totalCount: videos.count,
      currentPage: parseInt(page),
      totalPages,
      hasMore
    };
  }
  
  /**
   * Buscar usuários
   * @param {string} query - Termo de busca
   * @returns {Promise<Array>} Usuários encontrados
   */
  async searchUsers(query) {
    if (!query || query.length < 3) {
      throw {
        statusCode: 400,
        message: 'A busca deve ter pelo menos 3 caracteres'
      };
    }
    
    // Buscar usuários
    const users = await User.findAll({
      where: {
        [Op.or]: [
          { username: { [Op.like]: `%${query}%` } },
          { displayName: { [Op.like]: `%${query}%` } },
          { email: { [Op.like]: `%${query}%` } }
        ]
      },
      attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType', 'bio'],
      limit: 20
    });
    
    return users;
  }
  
  /**
   * Obter perfil público de um usuário
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Perfil público
   */
  async getPublicProfile(userId) {
    const user = await User.findByPk(userId, {
      attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType', 'bio', 'level', 'xpPoints', 'createdAt']
    });
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Status online somente se não estiver invisível
    let status = await redisClient.get(`user:${userId}:status`) || 'offline';
    const isInvisible = await redisClient.get(`user:${userId}:invisible`);
    
    if (isInvisible) {
      status = 'offline';
    }
    
    // Estatísticas
    const videoCount = await Video.count({
      where: {
        userId,
        status: 'published',
        isPublic: true
      }
    });
    
    const serverCount = await UserServer.count({
      where: { userId }
    });
    
    return {
      user: {
        ...user.toJSON(),
        status
      },
      stats: {
        videoCount,
        serverCount
      }
    };
  }
  
  /**
   * Obter atividade recente do usuário
   * @param {string} userId - ID do usuário
   * @param {Object} options - Opções de busca
   * @returns {Promise<Object>} Atividade recente
   */
  async getUserActivity(userId, options = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;
    
    // Obter transações recentes
    const transactions = await Transaction.findAll({
      where: {
        [Op.or]: [
          { userId },
          {
            type: 'gift',
            metadata: {
              receiverId: userId
            }
          }
        ],
        status: 'completed'
      },
      order: [['createdAt', 'DESC']],
      limit: 10
    });
    
    // Vídeos recentes
    const videos = await Video.findAll({
      where: {
        userId,
        status: 'published'
      },
      order: [['createdAt', 'DESC']],
      limit: 5
    });
    
    // Servidores recém-ingressados
    const servers = await UserServer.findAll({
      where: { userId },
      include: [{ model: Server, attributes: ['id', 'name', 'icon'] }],
      order: [['joinedAt', 'DESC']],
      limit: 5
    });
    
    // Combinar e ordenar por data
    const activity = [
      ...transactions.map(t => ({
        type: 'transaction',
        data: t,
        date: t.createdAt
      })),
      ...videos.map(v => ({
        type: 'video',
        data: v,
        date: v.createdAt
      })),
      ...servers.map(s => ({
        type: 'server',
        data: {
          id: s.Server.id,
          name: s.Server.name,
          icon: s.Server.icon,
          joinedAt: s.joinedAt
        },
        date: s.joinedAt
      }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date))
     .slice(offset, offset + parseInt(limit));
    
    return {
      activity,
      hasMore: activity.length === parseInt(limit)
    };
  }
}

module.exports = new UserService();