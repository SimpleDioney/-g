const { Transaction, User, Notification } = require('../models');
const { redisClient, emailQueue } = require('../config/redis');
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const mercadopago = require('mercadopago');

// Configurar MercadoPago
mercadopago.configure({
  access_token: process.env.MERCADOPAGO_ACCESS_TOKEN
});

class PaymentService {
  /**
   * Obter produtos disponíveis
   * @returns {Promise<Object>} Lista de produtos
   */
  async getProducts() {
    // Produtos pré-definidos
    const products = [
      {
        id: 'tokens_100',
        name: '100 Tokens',
        description: 'Pacote de 100 tokens para usar na plataforma',
        price: 9.99,
        tokens: 100,
        currency: 'BRL'
      },
      {
        id: 'tokens_500',
        name: '500 Tokens',
        description: 'Pacote de 500 tokens para usar na plataforma',
        price: 39.99,
        tokens: 500,
        currency: 'BRL'
      },
      {
        id: 'tokens_1000',
        name: '1000 Tokens',
        description: 'Pacote de 1000 tokens para usar na plataforma',
        price: 69.99,
        tokens: 1000,
        currency: 'BRL',
        featured: true
      },
      {
        id: 'tokens_3000',
        name: '3000 Tokens',
        description: 'Pacote de 3000 tokens para usar na plataforma',
        price: 179.99,
        tokens: 3000,
        currency: 'BRL'
      }
    ];
    
    // Planos de assinatura
    const subscriptions = [
      {
        id: 'premium_monthly',
        name: 'Assinatura Premium Mensal',
        description: 'Acesso a todos os recursos premium + 200 tokens mensais',
        price: 19.99,
        currency: 'BRL',
        interval: 'month',
        tokens: 200,
        features: [
          'Modo sem anúncios',
          'Upload de vídeos ilimitado',
          'Servidores premium',
          'Avatares exclusivos',
          'Badge Premium'
        ]
      },
      {
        id: 'premium_annual',
        name: 'Assinatura Premium Anual',
        description: 'Acesso a todos os recursos premium + 300 tokens mensais',
        price: 199.99,
        currency: 'BRL',
        interval: 'year',
        tokens: 300,
        features: [
          'Modo sem anúncios',
          'Upload de vídeos ilimitado',
          'Servidores premium',
          'Avatares exclusivos',
          'Badge Premium',
          'Desconto de 17% em relação ao plano mensal'
        ],
        featured: true
      }
    ];
    
    return { products, subscriptions };
  }
  
  /**
   * Criar sessão de checkout Stripe
   * @param {Object} data - Dados para checkout
   * @returns {Promise<Object>} Sessão de checkout
   */
  async createStripeCheckout(data) {
    const { userId, productId, returnUrl } = data;
    
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Buscar produto
    const { products, subscriptions } = await this.getProducts();
    const product = [...products, ...subscriptions].find(p => p.id === productId);
    
    if (!product) {
      throw {
        statusCode: 404,
        message: 'Produto não encontrado'
      };
    }
    
    // Gerar ID único para transação
    const paymentId = uuidv4();
    
    // Determinar se é assinatura ou compra única
    const isSubscription = product.interval !== undefined;
    
    // Criar metadados
    const metadata = {
      userId,
      productId,
      tokens: product.tokens,
      paymentId,
      isSubscription: isSubscription
    };
    
    let session;
    
    if (isSubscription) {
      // Criar ou recuperar plano no Stripe
      const planId = `plan_${product.id}`;
      let plan;
      
      try {
        // Tentar obter plano existente
        plan = await stripe.plans.retrieve(planId);
      } catch (error) {
        // Criar plano se não existir
        plan = await stripe.plans.create({
          id: planId,
          amount: Math.round(product.price * 100), // Em centavos
          currency: product.currency.toLowerCase(),
          interval: product.interval,
          product: {
            name: product.name
          },
          metadata: {
            tokens: product.tokens
          }
        });
      }
      
      // Criar sessão de checkout para assinatura
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price: plan.id,
          quantity: 1
        }],
        mode: 'subscription',
        success_url: `${returnUrl || process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnUrl || process.env.FRONTEND_URL}/payment/cancel`,
        customer_email: user.email,
        metadata,
        client_reference_id: paymentId
      });
    } else {
      // Criar sessão de checkout para compra única
      session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: product.currency.toLowerCase(),
            product_data: {
              name: product.name,
              description: product.description
            },
            unit_amount: Math.round(product.price * 100) // Em centavos
          },
          quantity: 1
        }],
        mode: 'payment',
        success_url: `${returnUrl || process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnUrl || process.env.FRONTEND_URL}/payment/cancel`,
        customer_email: user.email,
        metadata,
        client_reference_id: paymentId
      });
    }
    
    // Criar transação pendente
    await Transaction.create({
      id: paymentId,
      userId,
      amount: product.price,
      tokens: product.tokens,
      type: isSubscription ? 'subscription' : 'purchase',
      status: 'pending',
      paymentMethod: 'stripe',
      paymentId: session.id,
      metadata: {
        productId,
        sessionId: session.id,
        ...metadata
      }
    });
    
    return {
      sessionId: session.id,
      paymentId,
      url: session.url
    };
  }
  
  /**
   * Enviar presente (tokens) para outro usuário
   * @param {Object} data - Dados da transação
   * @returns {Promise<Object>} Resultado da transação
   */
  async sendGift(data) {
    const { senderId, receiverId, amount, message } = data;
    
    // Verificar se tem tokens suficientes
    const sender = await User.findByPk(senderId);
    
    if (!sender || sender.tokens < amount) {
      throw {
        statusCode: 400,
        message: 'Saldo insuficiente de tokens'
      };
    }
    
    // Verificar se o destinatário existe
    const receiver = await User.findByPk(receiverId);
    
    if (!receiver) {
      throw {
        statusCode: 404,
        message: 'Destinatário não encontrado'
      };
    }
    
    // Não permitir enviar para si mesmo
    if (senderId === receiverId) {
      throw {
        statusCode: 400,
        message: 'Você não pode enviar presentes para si mesmo'
      };
    }
    
    // Transferir tokens
    await sender.decrement('tokens', { by: amount });
    await receiver.increment('tokens', { by: amount });
    
    // Registrar transação
    const transactionId = uuidv4();
    await Transaction.create({
      id: transactionId,
      userId: senderId,
      amount: 0, // Não há valor monetário
      tokens: amount,
      type: 'gift',
      status: 'completed',
      paymentMethod: 'tokens',
      metadata: {
        receiverId,
        message: message || 'Presente enviado!'
      }
    });
    
    // Enviar notificações
    await Notification.create({
      userId: senderId,
      title: 'Presente enviado',
      message: `Você enviou ${amount} tokens para ${receiver.displayName || receiver.username}`,
      type: 'system',
      data: {
        giftId: transactionId,
        receiverId,
        tokens: amount
      }
    });
    
    await Notification.create({
      userId: receiverId,
      title: 'Presente recebido',
      message: `${sender.displayName || sender.username} enviou ${amount} tokens para você${message ? ': ' + message : ''}`,
      type: 'system',
      data: {
        giftId: transactionId,
        senderId,
        tokens: amount,
        message
      }
    });
    
    return {
      success: true,
      transaction: {
        id: transactionId,
        tokens: amount,
        receiver: {
          id: receiver.id,
          username: receiver.username,
          displayName: receiver.displayName
        }
      }
    };
  }
  
  /**
   * Enviar Super Chat em um canal
   * @param {Object} data - Dados do Super Chat
   * @returns {Promise<Object>} Resultado da transação
   */
  async sendSuperChat(data) {
    const { senderId, channelId, amount, message } = data;
    
    // Verificar se tem tokens suficientes
    const sender = await User.findByPk(senderId);
    
    if (!sender || sender.tokens < amount) {
      throw {
        statusCode: 400,
        message: 'Saldo insuficiente de tokens'
      };
    }
    
    // Verificar se o canal existe
    const channel = await Channel.findByPk(channelId, {
      include: [{ model: Server }]
    });
    
    if (!channel) {
      throw {
        statusCode: 404,
        message: 'Canal não encontrado'
      };
    }
    
    // Verificar permissões
    const userServer = await UserServer.findOne({
      where: {
        userId: senderId,
        serverId: channel.Server.id
      }
    });
    
    if (!userServer) {
      throw {
        statusCode: 403,
        message: 'Você não é membro deste servidor'
      };
    }
    
    // Descontar tokens do remetente
    await sender.decrement('tokens', { by: amount });
    
    // Registrar transação
    const transactionId = uuidv4();
    await Transaction.create({
      id: transactionId,
      userId: senderId,
      amount: 0, // Não há valor monetário
      tokens: amount,
      type: 'superchat',
      status: 'completed',
      paymentMethod: 'tokens',
      metadata: {
        channelId,
        serverId: channel.Server.id,
        message: message || ''
      }
    });
    
    // Determinar cor do Super Chat com base no valor
    let color = '#1976D2'; // Azul padrão
    
    if (amount >= 100) {
      color = '#F44336'; // Vermelho
    } else if (amount >= 50) {
      color = '#FFA000'; // Laranja
    } else if (amount >= 20) {
      color = '#4CAF50'; // Verde
    } else if (amount >= 10) {
      color = '#2196F3'; // Azul
    }
    
    // Criar mensagem de Super Chat
    const superChatMessage = await Message.create({
      channelId,
      userId: senderId,
      content: message || '',
      type: 'superchat',
      attachments: {
        tokens: amount,
        color,
        transactionId
      }
    });
    
    // Incluir dados do remetente
    const senderData = {
      id: sender.id,
      username: sender.username,
      displayName: sender.displayName,
      avatar: sender.avatar,
      avatarType: sender.avatarType
    };
    
    // Enviar para todos no canal
    const io = getIO();
    io.to(`channel:${channelId}`).emit('superchat', {
      id: superChatMessage.id,
      user: senderData,
      content: message || '',
      tokens: amount,
      color,
      createdAt: superChatMessage.createdAt
    });
    
    // Notificar o dono do servidor
    await Notification.create({
      userId: channel.Server.ownerId,
      title: 'Super Chat recebido',
      message: `${sender.displayName || sender.username} enviou um Super Chat de ${amount} tokens no canal #${channel.name}`,
      type: 'system',
      data: {
        transactionId,
        channelId,
        serverId: channel.Server.id,
        tokens: amount,
        senderId
      }
    });
    
    return {
      success: true,
      superChat: {
        id: superChatMessage.id,
        tokens: amount,
        color,
        message: message || ''
      }
    };
  }
  
  /**
   * Obter histórico de transações do usuário
   * @param {string} userId - ID do usuário
   * @param {Object} options - Opções de busca
   * @returns {Promise<Object>} Transações encontradas
   */
  async getTransactionHistory(userId, options = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;
    
    // Buscar transações
    const transactions = await Transaction.findAndCountAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    // Verificar se há mais páginas
    const totalPages = Math.ceil(transactions.count / limit);
    const hasMore = page < totalPages;
    
    return {
      transactions: transactions.rows,
      totalCount: transactions.count,
      currentPage: parseInt(page),
      totalPages,
      hasMore
    };
  }
  
  /**
   * Obter saldo de tokens do usuário
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Dados do saldo
   */
  async getTokenBalance(userId) {
    // Buscar usuário
    const user = await User.findByPk(userId, {
      attributes: ['id', 'tokens', 'isPremium']
    });
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Dados de assinatura
    let subscription = null;
    
    if (user.isPremium) {
      // Buscar assinatura ativa
      const activeSubscription = await Transaction.findOne({
        where: {
          userId,
          type: 'subscription',
          status: 'completed'
        },
        order: [['createdAt', 'DESC']]
      });
      
      if (activeSubscription) {
        subscription = {
          id: activeSubscription.id,
          startDate: activeSubscription.createdAt,
          paymentMethod: activeSubscription.paymentMethod
        };
      }
    }
    
    // Estatísticas de uso
    const stats = {
      totalSent: await Transaction.sum('tokens', {
        where: {
          userId,
          type: {
            [Op.in]: ['gift', 'superchat']
          },
          status: 'completed'
        }
      }) || 0,
      
      totalReceived: await Transaction.sum('tokens', {
        where: {
          [Op.and]: [
            { status: 'completed' },
            {
              [Op.or]: [
                {
                  type: 'gift',
                  metadata: {
                    receiverId: userId
                  }
                }
              ]
            }
          ]
        }
      }) || 0,
      
      totalPurchased: await Transaction.sum('tokens', {
        where: {
          userId,
          type: {
            [Op.in]: ['purchase', 'subscription']
          },
          status: 'completed'
        }
      }) || 0
    };
    
    return {
      balance: user.tokens,
      isPremium: user.isPremium,
      subscription,
      stats
    };
  }
  
  /**
   * Cancelar assinatura
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Resultado da operação
   */
  async cancelSubscription(userId) {
    // Buscar assinatura ativa
    const user = await User.findByPk(userId);
    
    if (!user || !user.isPremium) {
      throw {
        statusCode: 400,
        message: 'Você não possui uma assinatura ativa'
      };
    }
    
    // Buscar última transação de assinatura
    const subscription = await Transaction.findOne({
      where: {
        userId,
        type: 'subscription',
        status: 'completed'
      },
      order: [['createdAt', 'DESC']]
    });
    
    if (!subscription) {
      throw {
        statusCode: 404,
        message: 'Assinatura não encontrada'
      };
    }
    
    // Cancelar assinatura no provedor de pagamentos
    if (subscription.paymentMethod === 'stripe' && subscription.metadata.subscriptionId) {
      await stripe.subscriptions.del(subscription.metadata.subscriptionId);
    } else if (subscription.paymentMethod === 'mercadopago' && subscription.paymentId) {
      await mercadopago.preapproval.update({
        id: subscription.paymentId,
        status: 'cancelled'
      });
    }
    
    // Atualizar status do usuário
    await user.update({ isPremium: false });
    
    // Registrar cancelamento
    await Transaction.create({
      id: uuidv4(),
      userId,
      amount: 0,
      tokens: 0,
      type: 'subscription',
      status: 'cancelled',
      paymentMethod: subscription.paymentMethod,
      metadata: {
        originalSubscriptionId: subscription.id,
        reason: 'user_cancellation'
      }
    });
    
    // Enviar notificação
    await Notification.create({
      userId,
      title: 'Assinatura cancelada',
      message: 'Sua assinatura foi cancelada conforme solicitado. Seus benefícios premium ficarão disponíveis até o fim do período já pago.',
      type: 'system',
      data: {
        subscriptionId: subscription.id
      }
    });
    
    return { success: true };
  }
}

module.exports = new PaymentService();