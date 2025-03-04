const { Video, VideoComment, User } = require('../models');
const { videoProcessingQueue, redisClient } = require('../config/redis');
const { processVideoComplete } = require('../utils/videoProcessor');
const notificationService = require('./notification.service');
const { Op } = require('sequelize');

class VideoService {
  /**
   * Processar upload de vídeo
   * @param {Object} data - Dados do vídeo
   * @returns {Promise<Object>} Vídeo criado
   */
  async uploadVideo(data) {
    const { userId, title, description, tags, filePath, isPublic = true } = data;
    
    // Criar entrada no banco de dados
    const video = await Video.create({
      title: title || 'Sem título',
      description: description || '',
      userId,
      url: filePath, // Temporário
      status: 'processing',
      tags: tags || [],
      isPublic
    });
    
    // Adicionar à fila de processamento
    await videoProcessingQueue.add('processVideo', {
      videoId: video.id,
      filePath,
      userId
    });
    
    return video;
  }
  
  /**
   * Processar vídeo na fila
   * @param {Object} data - Dados do vídeo
   * @returns {Promise<Object>} Resultado do processamento
   */
  async processVideo(data) {
    const { videoId, filePath, userId } = data;
    
    try {
      // Verificar se o vídeo existe
      const video = await Video.findByPk(videoId);
      
      if (!video) {
        throw new Error('Vídeo não encontrado');
      }
      
      // Processar vídeo
      const result = await processVideoComplete(filePath);
      
      // Atualizar vídeo no banco de dados
      await video.update({
        url: result.video.url,
        thumbnailUrl: result.thumbnail.url,
        duration: result.duration,
        status: 'published',
        metadata: {
          videoId: result.video.publicId,
          thumbnailId: result.thumbnail.publicId,
          format: result.video.format,
          width: result.video.width,
          height: result.video.height
        }
      });
      
      // Notificar usuário
      await notificationService.create({
        userId,
        title: 'Vídeo processado',
        message: `Seu vídeo "${video.title}" foi processado e está disponível agora.`,
        type: 'system',
        sourceId: video.id,
        sourceType: 'video'
      });
      
      return { success: true, videoId, status: 'published' };
    } catch (error) {
      console.error('Erro ao processar vídeo:', error);
      
      // Atualizar status para falha
      const video = await Video.findByPk(videoId);
      
      if (video) {
        await video.update({
          status: 'failed',
          metadata: {
            error: error.message
          }
        });
        
        // Notificar usuário sobre a falha
        await notificationService.create({
          userId,
          title: 'Falha no processamento',
          message: `Ocorreu um erro ao processar seu vídeo "${video.title}". Por favor, tente novamente.`,
          type: 'system',
          sourceId: video.id,
          sourceType: 'video'
        });
      }
      
      throw error;
    }
  }
  
  /**
   * Obter feed de vídeos
   * @param {Object} options - Opções de busca
   * @returns {Promise<Object>} Vídeos encontrados
   */
  async getFeed(options = {}) {
    const { page = 1, limit = 10, userId } = options;
    const offset = (page - 1) * limit;
    
    // Construir query
    const query = {
      where: {
        status: 'published',
        isPublic: true
      },
      include: [
        {
          model: User,
          attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    };
    
    // Filtrar por usuário específico
    if (userId) {
      query.where.userId = userId;
    }
    
    // Buscar vídeos
    const videos = await Video.findAndCountAll(query);
    
    // Verificar se há mais páginas
    const totalPages = Math.ceil(videos.count / limit);
    const hasMore = page < totalPages;
    
    return {
      videos: videos.rows,
      totalCount: videos.count,
      currentPage: parseInt(page),
      totalPages,
      hasMore
    };
  }
  
  /**
   * Obter vídeos em tendência
   * @param {string} timeframe - Período de tempo (day, week, month)
   * @param {number} limit - Limite de vídeos
   * @returns {Promise<Array>} Vídeos em tendência
   */
  async getTrending(timeframe = 'week', limit = 10) {
    // Buscar do cache do Redis
    const cacheKey = `trending:${timeframe}`;
    const cachedData = await redisClient.get(cacheKey);
    
    if (cachedData) {
      const videos = JSON.parse(cachedData);
      return videos.slice(0, limit);
    }
    
    // Fallback: buscar do banco de dados
    // Definir período de tempo
    let fromDate;
    const now = new Date();
    
    switch (timeframe) {
      case 'day':
        fromDate = new Date(now.setDate(now.getDate() - 1));
        break;
      case 'week':
        fromDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        fromDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      default:
        fromDate = new Date(now.setDate(now.getDate() - 7));
    }
    
    // Buscar vídeos populares
    const videos = await Video.findAll({
      where: {
        status: 'published',
        isPublic: true,
        createdAt: {
          [Op.gte]: fromDate
        }
      },
      include: [
        {
          model: User,
          attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
        }
      ],
      order: [
        ['views', 'DESC'],
        ['likes', 'DESC'],
        ['comments', 'DESC']
      ],
      limit: parseInt(limit)
    });
    
    return videos;
  }
  
  /**
   * Curtir ou descurtir um vídeo
   * @param {string} videoId - ID do vídeo
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Resultado da operação
   */
  async toggleLike(videoId, userId) {
    // Buscar vídeo
    const video = await Video.findByPk(videoId);
    
    if (!video) {
      throw {
        statusCode: 404,
        message: 'Vídeo não encontrado'
      };
    }
    
    // Verificar se já curtiu
    const likeKey = `video:${videoId}:likes`;
    const hasLiked = await redisClient.sismember(likeKey, userId);
    
    if (hasLiked) {
      // Remover curtida
      await redisClient.srem(likeKey, userId);
      await video.decrement('likes', { by: 1 });
      
      return {
        message: 'Curtida removida',
        liked: false,
        likes: video.likes - 1
      };
    } else {
      // Adicionar curtida
      await redisClient.sadd(likeKey, userId);
      await video.increment('likes', { by: 1 });
      
      // Enviar notificação para o criador do vídeo
      if (video.userId !== userId) {
        await notificationService.create({
          userId: video.userId,
          title: 'Novo like em seu vídeo',
          message: `Alguém curtiu seu vídeo "${video.title}"`,
          type: 'video_like',
          sourceId: videoId,
          sourceType: 'video',
          data: {
            videoId,
            likedBy: userId
          }
        });
      }
      
      return {
        message: 'Vídeo curtido',
        liked: true,
        likes: video.likes + 1
      };
    }
  }
  
  /**
   * Verificar status de curtida
   * @param {string} videoId - ID do vídeo
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Status da curtida
   */
  async checkLikeStatus(videoId, userId) {
    // Buscar vídeo
    const video = await Video.findByPk(videoId);
    
    if (!video) {
      throw {
        statusCode: 404,
        message: 'Vídeo não encontrado'
      };
    }
    
    const likeKey = `video:${videoId}:likes`;
    const hasLiked = await redisClient.sismember(likeKey, userId);
    
    return {
      liked: !!hasLiked,
      likes: video.likes
    };
  }
  
  /**
   * Adicionar comentário a um vídeo
   * @param {Object} data - Dados do comentário
   * @returns {Promise<Object>} Comentário criado
   */
  async addComment(data) {
    const { videoId, userId, content, parentId } = data;
    
    // Verificar vídeo
    const video = await Video.findByPk(videoId);
    
    if (!video) {
      throw {
        statusCode: 404,
        message: 'Vídeo não encontrado'
      };
    }
    
    // Verificar se é resposta a outro comentário
    if (parentId) {
      const parentComment = await VideoComment.findByPk(parentId);
      
      if (!parentComment || parentComment.videoId !== videoId) {
        throw {
          statusCode: 400,
          message: 'Comentário pai inválido'
        };
      }
    }
    
    // Criar comentário
    const comment = await VideoComment.create({
      videoId,
      userId,
      content,
      parentId: parentId || null
    });
    
    // Incrementar contador de comentários
    await video.increment('comments', { by: 1 });
    
    // Incluir dados do autor
    const user = await User.findByPk(userId, {
      attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
    });
    
    const commentData = {
      ...comment.toJSON(),
      user
    };
    
    // Enviar notificação para o criador do vídeo
    if (video.userId !== userId) {
      await notificationService.create({
        userId: video.userId,
        title: 'Novo comentário em seu vídeo',
        message: `Alguém comentou em seu vídeo "${video.title}"`,
        type: 'video_comment',
        sourceId: videoId,
        sourceType: 'video',
        data: {
          videoId,
          commentId: comment.id,
          commentedBy: userId
        }
      });
    }
    
    // Enviar notificação para o autor do comentário pai
    if (parentId) {
      const parentComment = await VideoComment.findByPk(parentId);
      
      if (parentComment && parentComment.userId !== userId) {
        await notificationService.create({
          userId: parentComment.userId,
          title: 'Resposta ao seu comentário',
          message: `Alguém respondeu ao seu comentário no vídeo "${video.title}"`,
          type: 'video_comment',
          sourceId: videoId,
          sourceType: 'video',
          data: {
            videoId,
            commentId: comment.id,
            parentCommentId: parentId,
            repliedBy: userId
          }
        });
      }
    }
    
    return { commentData };
  }
  
  /**
   * Incrementar visualizações de vídeo
   * @param {string} videoId - ID do vídeo
   * @returns {Promise<Object>} Resultado da operação
   */
  async incrementViews(videoId) {
    // Buscar vídeo
    const video = await Video.findByPk(videoId);
    
    if (!video) {
      throw {
        statusCode: 404,
        message: 'Vídeo não encontrado'
      };
    }
    
    // Incrementar contador de visualizações
    await video.increment('views', { by: 1 });
    
    return { success: true };
  }
  
  /**
   * Buscar vídeos
   * @param {Object} options - Opções de busca
   * @returns {Promise<Object>} Vídeos encontrados
   */
  async searchVideos(options = {}) {
    const { q, tags, page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;
    
    if (!q && !tags) {
      throw {
        statusCode: 400,
        message: 'Forneça um termo de busca ou tags'
      };
    }
    
    // Construir query
    const where = {
      status: 'published',
      isPublic: true
    };
    
    // Busca por texto
    if (q) {
      where[Op.or] = [
        { title: { [Op.like]: `%${q}%` } },
        { description: { [Op.like]: `%${q}%` } }
      ];
    }
    
    // Busca por tags
    if (tags) {
      const tagList = tags.split(',').map(tag => tag.trim());
      
      // Este método depende de como as tags são armazenadas
      // Assumindo que tags é um array JSON
      where.tags = {
        [Op.overlap]: tagList
      };
    }
    
    // Buscar vídeos
    const videos = await Video.findAndCountAll({
      where,
      include: [
        {
          model: User,
          attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    // Verificar se há mais páginas
    const totalPages = Math.ceil(videos.count / limit);
    const hasMore = page < totalPages;
    
    return {
      videos: videos.rows,
      totalCount: videos.count,
      currentPage: parseInt(page),
      totalPages,
      hasMore
    };
  }
}

module.exports = new VideoService();