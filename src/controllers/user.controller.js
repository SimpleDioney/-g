const { User, Server, UserServer, Video, Transaction } = require('../models');
const { redisClient } = require('../config/redis');
const cloudinary = require('cloudinary').v2;
const bcrypt = require('bcrypt');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// Configurar upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/avatars');
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

// Obter perfil do usuário atual
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const user = await User.findByPk(userId, {
      attributes: { 
        exclude: ['password', 'refreshToken', 'twoFactorSecret']
      }
    });
    
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
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
    
    return res.status(200).json({
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
    });
  } catch (error) {
    console.error('Erro ao obter perfil:', error);
    return res.status(500).json({
      message: 'Erro ao carregar dados do perfil',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Atualizar perfil
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { displayName, bio, status } = req.body;
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Dados a atualizar
    const updateData = {};
    
    if (displayName !== undefined) updateData.displayName = displayName;
    if (bio !== undefined) updateData.bio = bio;
    
    // Atualizar usuário
    await user.update(updateData);
    
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
    
    return res.status(200).json({
      message: 'Perfil atualizado com sucesso',
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        status: status || user.status,
        avatar: user.avatar,
        avatarType: user.avatarType
      }
    });
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    return res.status(500).json({
      message: 'Erro ao atualizar perfil',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Upload de avatar
exports.uploadAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo enviado' });
    }
    
    const userId = req.user.id;
    const avatarType = req.body.avatarType || 'image';
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Upload para Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'avatars',
      transformation: [
        { width: 256, height: 256, crop: 'fill' }
      ]
    });
    
    // Remover avatar antigo do Cloudinary se existir
    if (user.avatar && user.avatar.includes('cloudinary')) {
      const publicId = user.avatar.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(publicId);
    }
    
    // Atualizar no banco de dados
    await user.update({
      avatar: result.secure_url,
      avatarType
    });
    
    // Remover arquivo temporário
    fs.unlinkSync(req.file.path);
    
    return res.status(200).json({
      message: 'Avatar atualizado com sucesso',
      avatar: result.secure_url,
      avatarType
    });
  } catch (error) {
    console.error('Erro ao atualizar avatar:', error);
    
    // Remover arquivo temporário em caso de erro
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    return res.status(500).json({
      message: 'Erro ao atualizar avatar',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Alterar senha
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: 'Senha atual e nova senha são obrigatórias'
      });
    }
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Verificar senha atual
    const isValid = await user.checkPassword(currentPassword);
    
    if (!isValid) {
      return res.status(401).json({ message: 'Senha atual incorreta' });
    }
    
    // Atualizar senha
    await user.update({ password: newPassword });
    
    // Invalidar todos os refresh tokens
    if (user.refreshToken) {
      await user.update({ refreshToken: null });
    }
    
    return res.status(200).json({
      message: 'Senha alterada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao alterar senha:', error);
    return res.status(500).json({
      message: 'Erro ao alterar senha',
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
      include: [{ model: Server }],
      order: [[Server, 'name', 'ASC']]
    });
    
    // Formatar resposta
    const servers = userServers.map(us => ({
      id: us.Server.id,
      name: us.Server.name,
      icon: us.Server.icon,
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

// Obter vídeos do usuário
exports.getUserVideos = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    
    // Verificar se o usuário existe
    const user = await User.findByPk(id, {
      attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
    });
    
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Buscar vídeos do usuário
    const videos = await Video.findAndCountAll({
      where: {
        userId: id,
        status: 'published',
        ...(req.user?.id !== id ? { isPublic: true } : {}) // Se não for o próprio usuário, mostrar apenas públicos
      },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    // Verificar se há mais páginas
    const totalPages = Math.ceil(videos.count / limit);
    const hasMore = page < totalPages;
    
    return res.status(200).json({
      user,
      videos: videos.rows,
      totalCount: videos.count,
      currentPage: parseInt(page),
      totalPages,
      hasMore
    });
  } catch (error) {
    console.error('Erro ao obter vídeos do usuário:', error);
    return res.status(500).json({
      message: 'Erro ao carregar vídeos do usuário',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Buscar usuários
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.length < 3) {
      return res.status(400).json({
        message: 'A busca deve ter pelo menos 3 caracteres'
      });
    }
    
    // Buscar usuários
    const users = await User.findAll({
      where: {
        [Op.or]: [
          { username: { [Op.like]: `%${q}%` } },
          { displayName: { [Op.like]: `%${q}%` } },
          { email: { [Op.like]: `%${q}%` } }
        ]
      },
      attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType', 'bio'],
      limit: 20
    });
    
    return res.status(200).json({ users });
  } catch (error) {
    console.error('Erro ao buscar usuários:', error);
    return res.status(500).json({
      message: 'Erro ao buscar usuários',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter perfil público de um usuário
exports.getPublicProfile = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findByPk(id, {
      attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType', 'bio', 'level', 'xpPoints', 'createdAt']
    });
    
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Status online somente se não estiver invisível
    let status = await redisClient.get(`user:${id}:status`) || 'offline';
    const isInvisible = await redisClient.get(`user:${id}:invisible`);
    
    if (isInvisible) {
      status = 'offline';
    }
    
    // Estatísticas
    const videoCount = await Video.count({
      where: {
        userId: id,
        status: 'published',
        isPublic: true
      }
    });
    
    const serverCount = await UserServer.count({
      where: { userId: id }
    });
    
    return res.status(200).json({
      user: {
        ...user.toJSON(),
        status
      },
      stats: {
        videoCount,
        serverCount
      }
    });
  } catch (error) {
    console.error('Erro ao obter perfil público:', error);
    return res.status(500).json({
      message: 'Erro ao carregar perfil do usuário',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter atividade recente do usuário
exports.getUserActivity = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
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
    
    return res.status(200).json({
      activity,
      hasMore: activity.length === parseInt(limit)
    });
  } catch (error) {
    console.error('Erro ao obter atividade do usuário:', error);
    return res.status(500).json({
      message: 'Erro ao carregar atividade recente',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};