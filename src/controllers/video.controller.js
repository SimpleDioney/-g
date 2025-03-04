const { Video, User, VideoComment } = require('../models');
const { videoProcessingQueue } = require('../config/redis');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('cloudinary').v2;
const { promisify } = require('util');
const { Op } = require('sequelize');

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configurar multer para upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/temp');
    // Garantir que o diretório existe
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

// Filtro para tipos de arquivos permitidos
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-ms-wmv',
    'video/webm'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não suportado. Formatos aceitos: MP4, MOV, AVI, WMV, WEBM.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// Configurar middleware de upload
exports.uploadMiddleware = upload.single('video');

// Upload de vídeo
exports.uploadVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo enviado' });
    }
    
    const { title, description, tags } = req.body;
    const userId = req.user.id;
    
    // Criar entrada no banco de dados
    const video = await Video.create({
      title: title || 'Sem título',
      description: description || '',
      userId,
      url: req.file.path, // Temporário
      status: 'processing',
      tags: tags ? JSON.parse(tags) : []
    });
    
    // Adicionar à fila de processamento
    await videoProcessingQueue.add('processVideo', {
      videoId: video.id,
      filePath: req.file.path,
      filename: req.file.filename
    });
    
    return res.status(201).json({
      message: 'Vídeo enviado e está sendo processado',
      video: {
        id: video.id,
        title: video.title,
        status: video.status
      }
    });
  } catch (error) {
    console.error('Erro no upload de vídeo:', error);
    
    // Remover arquivo em caso de erro
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    return res.status(500).json({
      message: 'Erro ao processar upload de vídeo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter detalhes de um vídeo
exports.getVideo = async (req, res) => {
  try {
    const { id } = req.params;
    
    const video = await Video.findByPk(id, {
      include: [
        {
          model: User,
          attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
        }
      ]
    });
    
    if (!video) {
      return res.status(404).json({ message: 'Vídeo não encontrado' });
    }
    
    // Verificar acesso a vídeos privados
    if (!video.isPublic && video.userId !== req.user.id) {
      return res.status(403).json({ message: 'Você não tem acesso a este vídeo' });
    }
    
    // Incrementar contador de views
    await video.increment('views', { by: 1 });
    
    return res.status(200).json({ video });
  } catch (error) {
    console.error('Erro ao obter vídeo:', error);
    return res.status(500).json({
      message: 'Erro ao obter detalhes do vídeo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Feed de vídeos
exports.getVideoFeed = async (req, res) => {
  try {
    const { page = 1, limit = 10, userId } = req.query;
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
    
    return res.status(200).json({
      videos: videos.rows,
      totalCount: videos.count,
      currentPage: parseInt(page),
      totalPages,
      hasMore
    });
  } catch (error) {
    console.error('Erro ao obter feed de vídeos:', error);
    return res.status(500).json({
      message: 'Erro ao carregar feed de vídeos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Curtir um vídeo
exports.likeVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const video = await Video.findByPk(id);
    
    if (!video) {
      return res.status(404).json({ message: 'Vídeo não encontrado' });
    }
    
    // Verificar se já curtiu
    const likeKey = `video:${id}:likes`;
    const hasLiked = await redisClient.sismember(likeKey, userId);
    
    if (hasLiked) {
      // Remover curtida
      await redisClient.srem(likeKey, userId);
      await video.decrement('likes', { by: 1 });
      
      return res.status(200).json({
        message: 'Curtida removida',
        liked: false,
        likes: video.likes - 1
      });
    } else {
      // Adicionar curtida
      await redisClient.sadd(likeKey, userId);
      await video.increment('likes', { by: 1 });
      
      // Enviar notificação para o criador do vídeo
      if (video.userId !== userId) {
        await notificationQueue.add('videoLike', {
          userId: video.userId,
          likedBy: userId,
          videoId: id
        });
      }
      
      return res.status(200).json({
        message: 'Vídeo curtido',
        liked: true,
        likes: video.likes + 1
      });
    }
  } catch (error) {
    console.error('Erro ao curtir vídeo:', error);
    return res.status(500).json({
      message: 'Erro ao processar curtida',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verificar se o usuário curtiu o vídeo
exports.checkLikeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const video = await Video.findByPk(id);
    
    if (!video) {
      return res.status(404).json({ message: 'Vídeo não encontrado' });
    }
    
    const likeKey = `video:${id}:likes`;
    const hasLiked = await redisClient.sismember(likeKey, userId);
    
    return res.status(200).json({
      liked: !!hasLiked,
      likes: video.likes
    });
  } catch (error) {
    console.error('Erro ao verificar status de curtida:', error);
    return res.status(500).json({
      message: 'Erro ao verificar status de curtida',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Adicionar comentário
exports.addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { content, parentId } = req.body;
    const userId = req.user.id;
    
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ message: 'Conteúdo do comentário não pode estar vazio' });
    }
    
    const video = await Video.findByPk(id);
    
    if (!video) {
      return res.status(404).json({ message: 'Vídeo não encontrado' });
    }
    
    // Verificar se é resposta a outro comentário
    if (parentId) {
      const parentComment = await VideoComment.findByPk(parentId);
      
      if (!parentComment || parentComment.videoId !== id) {
        return res.status(400).json({ message: 'Comentário pai inválido' });
      }
    }
    
    // Criar comentário
    const comment = await VideoComment.create({
      videoId: id,
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
      await notificationQueue.add('videoComment', {
        userId: video.userId,
        commentedBy: userId,
        videoId: id,
        commentId: comment.id
      });
    }
    
    // Enviar notificação para o autor do comentário pai
    if (parentId) {
      const parentComment = await VideoComment.findByPk(parentId);
      
      if (parentComment && parentComment.userId !== userId) {
        await notificationQueue.add('commentReply', {
          userId: parentComment.userId,
          repliedBy: userId,
          videoId: id,
          commentId: comment.id,
          parentCommentId: parentId
        });
      }
    }
    
    return res.status(201).json({
      message: 'Comentário adicionado',
      comment: commentData
    });
  } catch (error) {
    console.error('Erro ao adicionar comentário:', error);
    return res.status(500).json({
      message: 'Erro ao adicionar comentário',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter comentários de um vídeo
exports.getComments = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    
    const video = await Video.findByPk(id);
    
    if (!video) {
      return res.status(404).json({ message: 'Vídeo não encontrado' });
    }
    
    // Buscar comentários de primeiro nível
    const comments = await VideoComment.findAndCountAll({
      where: {
        videoId: id,
        parentId: null
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
    });
    
    // Para cada comentário, buscar respostas
    const commentsWithReplies = await Promise.all(
      comments.rows.map(async (comment) => {
        const replies = await VideoComment.findAll({
          where: {
            parentId: comment.id
          },
          include: [
            {
              model: User,
              attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
            }
          ],
          order: [['createdAt', 'ASC']],
          limit: 5 // Limitar a 5 respostas iniciais
        });
        
        const replyCount = await VideoComment.count({
          where: {
            parentId: comment.id
          }
        });
        
        return {
          ...comment.toJSON(),
          replies,
          hasMoreReplies: replyCount > replies.length,
          totalReplies: replyCount
        };
      })
    );
    
    // Verificar se há mais páginas
    const totalPages = Math.ceil(comments.count / limit);
    const hasMore = page < totalPages;
    
    return res.status(200).json({
      comments: commentsWithReplies,
      totalCount: comments.count,
      currentPage: parseInt(page),
      totalPages,
      hasMore
    });
  } catch (error) {
    console.error('Erro ao obter comentários:', error);
    return res.status(500).json({
      message: 'Erro ao carregar comentários',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Excluir comentário
exports.deleteComment = async (req, res) => {
  try {
    const { commentId } = req.params;
    const userId = req.user.id;
    
    const comment = await VideoComment.findByPk(commentId, {
      include: [{ model: Video }]
    });
    
    if (!comment) {
      return res.status(404).json({ message: 'Comentário não encontrado' });
    }
    
    // Verificar permissões
    const canDelete = comment.userId === userId || 
                      comment.Video.userId === userId || 
                      req.user.role === 'admin' || 
                      req.user.role === 'moderator';
    
    if (!canDelete) {
      return res.status(403).json({ message: 'Você não tem permissão para excluir este comentário' });
    }
    
    // Contar respostas
    const replyCount = await VideoComment.count({
      where: {
        parentId: commentId
      }
    });
    
    // Calcular quantos comentários serão excluídos (incluindo respostas)
    const totalToDelete = 1 + replyCount;
    
    // Excluir respostas
    if (replyCount > 0) {
      await VideoComment.destroy({
        where: {
          parentId: commentId
        }
      });
    }
    
    // Excluir o comentário
    await comment.destroy();
    
    // Decrementar contador de comentários no vídeo
    await Video.decrement('comments', {
      by: totalToDelete,
      where: { id: comment.videoId }
    });
    
    return res.status(200).json({
      message: 'Comentário excluído',
      deletedCount: totalToDelete
    });
  } catch (error) {
    console.error('Erro ao excluir comentário:', error);
    return res.status(500).json({
      message: 'Erro ao excluir comentário',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Compartilhar vídeo
exports.shareVideo = async (req, res) => {
  try {
    const { id } = req.params;
    
    const video = await Video.findByPk(id);
    
    if (!video) {
      return res.status(404).json({ message: 'Vídeo não encontrado' });
    }
    
    // Incrementar contador de compartilhamentos
    await video.increment('shares', { by: 1 });
    
    // Gerar link de compartilhamento
    const shareUrl = `${process.env.FRONTEND_URL}/videos/${id}`;
    
    return res.status(200).json({
      message: 'Vídeo compartilhado',
      shareUrl,
      shares: video.shares + 1
    });
  } catch (error) {
    console.error('Erro ao compartilhar vídeo:', error);
    return res.status(500).json({
      message: 'Erro ao processar compartilhamento',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Atualizar detalhes do vídeo
exports.updateVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, tags, isPublic } = req.body;
    const userId = req.user.id;
    
    const video = await Video.findByPk(id);
    
    if (!video) {
      return res.status(404).json({ message: 'Vídeo não encontrado' });
    }
    
    // Verificar propriedade
    if (video.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Você não tem permissão para editar este vídeo' });
    }
    
    // Campos a atualizar
    const updateData = {};
    
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (tags !== undefined) updateData.tags = tags;
    if (isPublic !== undefined) updateData.isPublic = isPublic;
    
    // Atualizar vídeo
    await video.update(updateData);
    
    return res.status(200).json({
      message: 'Vídeo atualizado',
      video
    });
  } catch (error) {
    console.error('Erro ao atualizar vídeo:', error);
    return res.status(500).json({
      message: 'Erro ao atualizar vídeo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Excluir vídeo
exports.deleteVideo = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const video = await Video.findByPk(id);
    
    if (!video) {
      return res.status(404).json({ message: 'Vídeo não encontrado' });
    }
    
    // Verificar propriedade
    if (video.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Você não tem permissão para excluir este vídeo' });
    }
    
    // Excluir comentários
    await VideoComment.destroy({
      where: {
        videoId: id
      }
    });
    
    // Se estiver armazenado no Cloudinary, excluir
    if (video.url && video.url.includes('cloudinary')) {
      const publicId = video.url.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
      
      // Excluir thumbnail se existir
      if (video.thumbnailUrl) {
        const thumbnailId = video.thumbnailUrl.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(thumbnailId);
      }
    }
    
    // Excluir vídeo do banco de dados
    await video.destroy();
    
    return res.status(200).json({
      message: 'Vídeo excluído com sucesso'
    });
  } catch (error) {
    console.error('Erro ao excluir vídeo:', error);
    return res.status(500).json({
      message: 'Erro ao excluir vídeo',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Buscar vídeos
exports.searchVideos = async (req, res) => {
  try {
    const { q, tags, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    
    if (!q && !tags) {
      return res.status(400).json({ message: 'Forneça um termo de busca ou tags' });
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
    
    return res.status(200).json({
      videos: videos.rows,
      totalCount: videos.count,
      currentPage: parseInt(page),
      totalPages,
      hasMore
    });
  } catch (error) {
    console.error('Erro na busca de vídeos:', error);
    return res.status(500).json({
      message: 'Erro ao buscar vídeos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter vídeos populares
exports.getTrendingVideos = async (req, res) => {
  try {
    const { timeframe = 'week', limit = 10 } = req.query;
    
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
    
    return res.status(200).json({
      timeframe,
      videos
    });
  } catch (error) {
    console.error('Erro ao obter vídeos em tendência:', error);
    return res.status(500).json({
      message: 'Erro ao carregar vídeos em tendência',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
