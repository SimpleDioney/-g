class Paginator {
    /**
     * Cria uma nova instância de Paginator
     * @param {Object} options - Opções de paginação
     */
    constructor(options = {}) {
      this.page = parseInt(options.page) || 1;
      this.limit = parseInt(options.limit) || 20;
      this.maxLimit = options.maxLimit || 100;
      
      // Garantir valores válidos
      if (this.page < 1) this.page = 1;
      if (this.limit < 1) this.limit = 20;
      if (this.limit > this.maxLimit) this.limit = this.maxLimit;
      
      this.offset = (this.page - 1) * this.limit;
    }
    
    /**
     * Gera os parâmetros para a consulta no banco de dados
     * @returns {Object} Parâmetros para consulta
     */
    getQueryParams() {
      return {
        limit: this.limit,
        offset: this.offset
      };
    }
    
    /**
     * Formata os resultados com metadados de paginação
     * @param {Object} results - Resultados da consulta
     * @param {number} results.count - Total de registros
     * @param {Array} results.rows - Registros da página atual
     * @returns {Object} Resultados formatados com metadados
     */
    format(results) {
      const totalItems = results.count;
      const totalPages = Math.ceil(totalItems / this.limit);
      const hasMore = this.page < totalPages;
      
      return {
        data: results.rows,
        meta: {
          totalItems,
          itemsPerPage: this.limit,
          currentPage: this.page,
          totalPages,
          hasMore
        }
      };
    }
    
    /**
     * Formata os resultados com metadados de paginação (para arrays)
     * @param {Array} items - Itens a serem paginados
     * @returns {Object} Resultados formatados com metadados
     */
    formatArray(items) {
      const totalItems = items.length;
      const totalPages = Math.ceil(totalItems / this.limit);
      const start = this.offset;
      const end = Math.min(start + this.limit, totalItems);
      const pageItems = items.slice(start, end);
      const hasMore = this.page < totalPages;
      
      return {
        data: pageItems,
        meta: {
          totalItems,
          itemsPerPage: this.limit,
          currentPage: this.page,
          totalPages,
          hasMore
        }
      };
    }
  }
  
  module.exports = Paginator;
  
  // src/utils/formatter.js
  /**
   * Formatador de dados para diferentes entidades
   */
  const formatter = {
    /**
     * Formata dados de usuário para resposta pública
     * @param {Object} user - Dados do usuário
     * @returns {Object} Dados formatados
     */
    publicUser: (user) => {
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        avatarType: user.avatarType,
        bio: user.bio,
        level: user.level,
        xpPoints: user.xpPoints,
        createdAt: user.createdAt,
        status: user.status
      };
    },
    
    /**
     * Formata dados de usuário para resposta privada (próprio usuário)
     * @param {Object} user - Dados do usuário
     * @returns {Object} Dados formatados
     */
    privateUser: (user) => {
      return {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        avatarType: user.avatarType,
        bio: user.bio,
        status: user.status,
        level: user.level,
        xpPoints: user.xpPoints,
        tokens: user.tokens,
        isPremium: user.isPremium,
        twoFactorEnabled: user.twoFactorEnabled,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      };
    },
    
    /**
     * Formata dados de servidor
     * @param {Object} server - Dados do servidor
     * @returns {Object} Dados formatados
     */
    server: (server) => {
      return {
        id: server.id,
        name: server.name,
        description: server.description,
        icon: server.icon,
        inviteCode: server.inviteCode,
        isPrivate: server.isPrivate,
        memberCount: server.memberCount,
        isPremium: server.isPremium,
        premiumTier: server.premiumTier,
        createdAt: server.createdAt
      };
    },
    
    /**
     * Formata dados de canal
     * @param {Object} channel - Dados do canal
     * @returns {Object} Dados formatados
     */
    channel: (channel) => {
      return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        serverId: channel.serverId,
        description: channel.description,
        position: channel.position,
        isPrivate: channel.isPrivate,
        slowMode: channel.slowMode,
        createdAt: channel.createdAt
      };
    },
    
    /**
     * Formata dados de mensagem
     * @param {Object} message - Dados da mensagem
     * @returns {Object} Dados formatados
     */
    message: (message) => {
      return {
        id: message.id,
        content: message.content,
        channelId: message.channelId,
        userId: message.userId,
        type: message.type,
        attachments: message.attachments,
        reactions: message.reactions,
        mentions: message.mentions,
        replyToId: message.replyToId,
        isEdited: message.isEdited,
        isPinned: message.isPinned,
        expiresAt: message.expiresAt,
        scheduledFor: message.scheduledFor,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        user: message.User ? {
          id: message.User.id,
          username: message.User.username,
          displayName: message.User.displayName,
          avatar: message.User.avatar,
          avatarType: message.User.avatarType
        } : undefined
      };
    },
    
    /**
     * Formata dados de vídeo
     * @param {Object} video - Dados do vídeo
     * @returns {Object} Dados formatados
     */
    video: (video) => {
      return {
        id: video.id,
        title: video.title,
        description: video.description,
        url: video.url,
        thumbnailUrl: video.thumbnailUrl,
        duration: video.duration,
        likes: video.likes,
        views: video.views,
        shares: video.shares,
        comments: video.comments,
        status: video.status,
        isPublic: video.isPublic,
        tags: video.tags,
        createdAt: video.createdAt,
        user: video.User ? {
          id: video.User.id,
          username: video.User.username,
          displayName: video.User.displayName,
          avatar: video.User.avatar,
          avatarType: video.User.avatarType
        } : undefined
      };
    },
    
    /**
     * Formata dados de notificação
     * @param {Object} notification - Dados da notificação
     * @returns {Object} Dados formatados
     */
    notification: (notification) => {
      return {
        id: notification.id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        isRead: notification.isRead,
        sourceId: notification.sourceId,
        sourceType: notification.sourceType,
        data: notification.data,
        createdAt: notification.createdAt
      };
    },
    
    /**
     * Formata dados de transação
     * @param {Object} transaction - Dados da transação
     * @returns {Object} Dados formatados
     */
    transaction: (transaction) => {
      return {
        id: transaction.id,
        amount: transaction.amount,
        tokens: transaction.tokens,
        type: transaction.type,
        status: transaction.status,
        paymentMethod: transaction.paymentMethod,
        metadata: transaction.metadata,
        createdAt: transaction.createdAt
      };
    },
    
    /**
     * Formata mensagem de erro
     * @param {string} message - Mensagem de erro
     * @param {Array|Object} details - Detalhes do erro
     * @returns {Object} Erro formatado
     */
    error: (message, details = null) => {
      return {
        error: true,
        message,
        details
      };
    }
  };
  
  module.exports = formatter;