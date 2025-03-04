const { Transaction, User, Notification } = require('../models');
const stripe = require('stripe')(process.env.STRIPE_KEY);
const mercadopago = require('mercadopago');
const { v4: uuidv4 } = require('uuid');
const { redisClient, emailQueue } = require('../config/redis');

// Configurar MercadoPago
mercadopago.configure({
  access_token: process.env.MERCADOPAGO_ACCESS_TOKEN
});

// Obter produtos disponíveis (pacotes de tokens)
exports.getProducts = async (req, res) => {
  try {
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
    
    return res.status(200).json({
      products,
      subscriptions
    });
  } catch (error) {
    console.error('Erro ao obter produtos:', error);
    return res.status(500).json({
      message: 'Erro ao carregar produtos',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Iniciar checkout Stripe
exports.createStripeCheckout = async (req, res) => {
  try {
    const { productId, returnUrl } = req.body;
    const userId = req.user.id;
    
    if (!productId) {
      return res.status(400).json({ message: 'ID do produto é obrigatório' });
    }

    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Buscar produtos disponíveis
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
        currency: 'BRL'
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
    
    const subscriptions = [
      {
        id: 'premium_monthly',
        name: 'Assinatura Premium Mensal',
        description: 'Acesso a todos os recursos premium + 200 tokens mensais',
        price: 19.99,
        currency: 'BRL',
        interval: 'month',
        tokens: 200
      },
      {
        id: 'premium_annual',
        name: 'Assinatura Premium Anual',
        description: 'Acesso a todos os recursos premium + 300 tokens mensais',
        price: 199.99,
        currency: 'BRL',
        interval: 'year',
        tokens: 300
      }
    ];
    
    // Encontrar produto selecionado
    const product = [...products, ...subscriptions].find(p => p.id === productId);
    
    if (!product) {
      return res.status(404).json({ message: 'Produto não encontrado' });
    }
    
    // Gerar ID único para transação
    const paymentId = uuidv4();
    
    // Determinar se é assinatura ou compra única
    const isSubscription = product.interval !== undefined;
    
    // Criar metadados
    const metadata = {
      userId: userId,
      productId: productId,
      tokens: product.tokens,
      paymentId: paymentId,
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
        metadata: metadata,
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
        metadata: metadata,
        client_reference_id: paymentId
      });
    }
    
    // Criar transação pendente
    await Transaction.create({
      id: paymentId,
      userId: userId,
      amount: product.price,
      tokens: product.tokens,
      type: isSubscription ? 'subscription' : 'purchase',
      status: 'pending',
      paymentMethod: 'stripe',
      paymentId: session.id,
      metadata: {
        productId: productId,
        sessionId: session.id,
        ...metadata
      }
    });
    
    return res.status(200).json({
      sessionId: session.id,
      paymentId: paymentId,
      url: session.url
    });
  } catch (error) {
    console.error('Erro ao criar sessão de checkout no Stripe:', error);
    return res.status(500).json({
      message: 'Erro ao processar pagamento',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Iniciar checkout MercadoPago
exports.createMercadoPagoCheckout = async (req, res) => {
  try {
    const { productId, returnUrl } = req.body;
    const userId = req.user.id;
    
    if (!productId) {
      return res.status(400).json({ message: 'ID do produto é obrigatório' });
    }
    
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }
    
    // Buscar produtos disponíveis (mesma lógica do método anterior)
    const products = [
      {
        id: 'tokens_100',
        name: '100 Tokens',
        description: 'Pacote de 100 tokens para usar na plataforma',
        price: 9.99,
        tokens: 100,
        currency: 'BRL'
      },
      // Outros produtos...
    ];
    
    const subscriptions = [
      {
        id: 'premium_monthly',
        name: 'Assinatura Premium Mensal',
        description: 'Acesso a todos os recursos premium + 200 tokens mensais',
        price: 19.99,
        currency: 'BRL',
        interval: 'month',
        tokens: 200
      },
      // Outras assinaturas...
    ];
    
    // Encontrar produto selecionado
    const product = [...products, ...subscriptions].find(p => p.id === productId);
    
    if (!product) {
      return res.status(404).json({ message: 'Produto não encontrado' });
    }
    
    // Gerar ID único para transação
    const paymentId = uuidv4();
    
    // Determinar se é assinatura ou compra única
    const isSubscription = product.interval !== undefined;
    
    // Criar metadados
    const metadata = {
      userId: userId,
      productId: productId,
      tokens: product.tokens,
      paymentId: paymentId,
      isSubscription: isSubscription
    };
    
    // Configurar preferência de pagamento
    const preference = {
      items: [
        {
          id: productId,
          title: product.name,
          description: product.description,
          unit_price: product.price,
          quantity: 1,
          currency_id: product.currency
        }
      ],
      back_urls: {
        success: `${returnUrl || process.env.FRONTEND_URL}/payment/success`,
        failure: `${returnUrl || process.env.FRONTEND_URL}/payment/cancel`,
        pending: `${returnUrl || process.env.FRONTEND_URL}/payment/pending`
      },
      auto_return: 'approved',
      external_reference: paymentId,
      metadata: metadata
    };
    
    // Para assinaturas, utilizamos um endpoint diferente
    let response;
    if (isSubscription) {
      // Criar plano de assinatura
      const plan = {
        reason: product.name,
        auto_recurring: {
          frequency: product.interval === 'month' ? 1 : 12,
          frequency_type: 'months',
          transaction_amount: product.price,
          currency_id: product.currency
        },
        back_url: `${returnUrl || process.env.FRONTEND_URL}/payment/success`,
        external_reference: paymentId,
        metadata: metadata
      };
      
      response = await mercadopago.preapproval.create(plan);
    } else {
      // Criar checkout para pagamento único
      response = await mercadopago.preferences.create(preference);
    }
    
    // Criar transação pendente
    await Transaction.create({
      id: paymentId,
      userId: userId,
      amount: product.price,
      tokens: product.tokens,
      type: isSubscription ? 'subscription' : 'purchase',
      status: 'pending',
      paymentMethod: 'mercadopago',
      paymentId: isSubscription ? response.body.id : response.body.id,
      metadata: {
        productId: productId,
        ...metadata
      }
    });
    
    return res.status(200).json({
      id: response.body.id,
      paymentId: paymentId,
      url: isSubscription ? response.body.init_point : response.body.init_point
    });
  } catch (error) {
    console.error('Erro ao criar checkout no MercadoPago:', error);
    return res.status(500).json({
      message: 'Erro ao processar pagamento',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Webhook para processar eventos do Stripe
exports.stripeWebhook = async (req, res) => {
  const signature = req.headers['stripe-signature'];
  let event;
  
  try {
    // Verificar assinatura do webhook
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Erro na assinatura do webhook:', error);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
  
  // Processar evento
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { userId, tokens, paymentId, isSubscription } = session.metadata;
        
        // Buscar transação
        const transaction = await Transaction.findOne({
          where: { paymentId: session.id }
        });
        
        if (!transaction) {
          console.error('Transação não encontrada:', session.id);
          return res.status(400).json({ received: true });
        }
        
        // Atualizar status da transação
        await transaction.update({
          status: 'completed',
          metadata: {
            ...transaction.metadata,
            stripeEvent: event.type
          }
        });
        
        // Adicionar tokens ao usuário
        const user = await User.findByPk(userId);
        
        if (user) {
          await user.increment('tokens', { by: parseInt(tokens) });
          
          // Para assinaturas, atualizar status premium
          if (isSubscription === 'true') {
            await user.update({ isPremium: true });
          }
          
          // Enviar notificação
          await Notification.create({
            userId,
            title: 'Pagamento confirmado',
            message: `Seu pagamento foi confirmado. ${tokens} tokens foram adicionados à sua conta.`,
            type: 'system',
            data: {
              tokens: parseInt(tokens),
              transactionId: transaction.id
            }
          });
          
          // Enviar e-mail de confirmação
          await emailQueue.add('paymentConfirmation', {
            email: user.email,
            username: user.username,
            tokens: parseInt(tokens),
            amount: transaction.amount,
            date: new Date().toISOString()
          });
        }
        
        break;
      }
      
      case 'invoice.payment_succeeded': {
        // Processamento de renovação de assinatura
        const invoice = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const { userId, tokens } = subscription.metadata;
        
        // Adicionar tokens mensais ao usuário
        const user = await User.findByPk(userId);
        
        if (user) {
          await user.increment('tokens', { by: parseInt(tokens) });
          
          // Criar registro de transação para a renovação
          await Transaction.create({
            id: uuidv4(),
            userId,
            amount: invoice.amount_paid / 100, // Converter de centavos
            tokens: parseInt(tokens),
            type: 'subscription',
            status: 'completed',
            paymentMethod: 'stripe',
            paymentId: invoice.id,
            metadata: {
              subscriptionId: invoice.subscription,
              invoiceId: invoice.id
            }
          });
          
          // Enviar notificação
          await Notification.create({
            userId,
            title: 'Assinatura renovada',
            message: `Sua assinatura foi renovada. ${tokens} tokens foram adicionados à sua conta.`,
            type: 'system',
            data: {
              tokens: parseInt(tokens),
              subscriptionId: invoice.subscription
            }
          });
        }
        
        break;
      }
      
      case 'customer.subscription.deleted': {
        // Processamento de cancelamento de assinatura
        const subscription = event.data.object;
        const { userId } = subscription.metadata;
        
        // Atualizar status do usuário
        const user = await User.findByPk(userId);
        
        if (user) {
          await user.update({ isPremium: false });
          
          // Enviar notificação
          await Notification.create({
            userId,
            title: 'Assinatura cancelada',
            message: 'Sua assinatura foi cancelada. Seus benefícios premium expiraram.',
            type: 'system',
            data: {
              subscriptionId: subscription.id
            }
          });
        }
        
        break;
      }
      
      default:
        console.log(`Evento não tratado: ${event.type}`);
    }
    
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Erro ao processar webhook do Stripe:', error);
    return res.status(500).json({ error: 'Erro ao processar evento' });
  }
};

// Webhook para processar eventos do MercadoPago
exports.mercadoPagoWebhook = async (req, res) => {
  try {
    const { type, data } = req.body;
    
    if (type !== 'payment' && type !== 'plan') {
      return res.status(200).json({ message: 'Evento ignorado' });
    }
    
    // Buscar informações do pagamento
    let payment;
    
    if (type === 'payment') {
      payment = await mercadopago.payment.findById(data.id);
    } else {
      payment = await mercadopago.preapproval.findById(data.id);
    }
    
    if (!payment || !payment.body) {
      return res.status(404).json({ message: 'Pagamento não encontrado' });
    }
    
    const paymentData = payment.body;
    const externalReference = paymentData.external_reference;
    
    // Buscar transação
    const transaction = await Transaction.findByPk(externalReference);
    
    if (!transaction) {
      return res.status(404).json({ message: 'Transação não encontrada' });
    }
    
    // Atualizar status com base no status do pagamento
    let status;
    
    if (type === 'payment') {
      switch (paymentData.status) {
        case 'approved':
          status = 'completed';
          break;
        case 'pending':
        case 'in_process':
          status = 'pending';
          break;
        case 'rejected':
          status = 'failed';
          break;
        default:
          status = 'pending';
      }
    } else {
      // Para assinaturas
      switch (paymentData.status) {
        case 'authorized':
          status = 'completed';
          break;
        case 'pending':
          status = 'pending';
          break;
        case 'cancelled':
          status = 'failed';
          break;
        default:
          status = 'pending';
      }
    }
    
    // Atualizar transação
    await transaction.update({
      status,
      metadata: {
        ...transaction.metadata,
        mercadoPagoEvent: type,
        mercadoPagoStatus: paymentData.status
      }
    });
    
    // Se concluído com sucesso, adicionar tokens
    if (status === 'completed') {
      const user = await User.findByPk(transaction.userId);
      
      if (user) {
        await user.increment('tokens', { by: transaction.tokens });
        
        // Para assinaturas, atualizar status premium
        if (transaction.type === 'subscription') {
          await user.update({ isPremium: true });
        }
        
        // Enviar notificação
        await Notification.create({
          userId: transaction.userId,
          title: 'Pagamento confirmado',
          message: `Seu pagamento foi confirmado. ${transaction.tokens} tokens foram adicionados à sua conta.`,
          type: 'system',
          data: {
            tokens: transaction.tokens,
            transactionId: transaction.id
          }
        });
        
        // Enviar e-mail de confirmação
        await emailQueue.add('paymentConfirmation', {
          email: user.email,
          username: user.username,
          tokens: transaction.tokens,
          amount: transaction.amount,
          date: new Date().toISOString()
        });
      }
    }
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro ao processar webhook do MercadoPago:', error);
    return res.status(500).json({
      message: 'Erro ao processar evento',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Histórico de transações do usuário
exports.getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
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
    
    return res.status(200).json({
      transactions: transactions.rows,
      totalCount: transactions.count,
      currentPage: parseInt(page),
      totalPages,
      hasMore
    });
  } catch (error) {
    console.error('Erro ao obter histórico de transações:', error);
    return res.status(500).json({
      message: 'Erro ao carregar histórico de transações',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Enviar presente virtual para outro usuário
exports.sendGift = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { receiverId, amount, message } = req.body;
    
    if (!receiverId || !amount || amount <= 0) {
      return res.status(400).json({
        message: 'Destinatário e valor são obrigatórios'
      });
    }
    
    // Verificar se tem tokens suficientes
    const sender = await User.findByPk(senderId);
    
    if (!sender || sender.tokens < amount) {
      return res.status(400).json({
        message: 'Saldo insuficiente de tokens'
      });
    }
    
    // Verificar se o destinatário existe
    const receiver = await User.findByPk(receiverId);
    
    if (!receiver) {
      return res.status(404).json({
        message: 'Destinatário não encontrado'
      });
    }
    
    // Não permitir enviar para si mesmo
    if (senderId === receiverId) {
      return res.status(400).json({
        message: 'Você não pode enviar presentes para si mesmo'
      });
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
    
    return res.status(200).json({
      message: 'Presente enviado com sucesso',
      transaction: {
        id: transactionId,
        tokens: amount,
        receiver: {
          id: receiver.id,
          username: receiver.username,
          displayName: receiver.displayName
        }
      }
    });
  } catch (error) {
    console.error('Erro ao enviar presente:', error);
    return res.status(500).json({
      message: 'Erro ao enviar presente',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Enviar Super Chat em um canal
exports.sendSuperChat = async (req, res) => {
  try {
    const senderId = req.user.id;
    const { channelId, amount, message } = req.body;
    
    if (!channelId || !amount || amount <= 0) {
      return res.status(400).json({
        message: 'Canal e valor são obrigatórios'
      });
    }
    
    // Verificar se tem tokens suficientes
    const sender = await User.findByPk(senderId);
    
    if (!sender || sender.tokens < amount) {
      return res.status(400).json({
        message: 'Saldo insuficiente de tokens'
      });
    }
    
    // Verificar se o canal existe
    const channel = await Channel.findByPk(channelId, {
      include: [{ model: Server }]
    });
    
    if (!channel) {
      return res.status(404).json({
        message: 'Canal não encontrado'
      });
    }
    
    // Verificar permissões
    const userServer = await UserServer.findOne({
      where: {
        userId: senderId,
        serverId: channel.Server.id
      }
    });
    
    if (!userServer) {
      return res.status(403).json({
        message: 'Você não é membro deste servidor'
      });
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
    
    return res.status(200).json({
      message: 'Super Chat enviado com sucesso',
      superChat: {
        id: superChatMessage.id,
        tokens: amount,
        color,
        message: message || ''
      }
    });
  } catch (error) {
    console.error('Erro ao enviar Super Chat:', error);
    return res.status(500).json({
      message: 'Erro ao enviar Super Chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter saldo de tokens do usuário
exports.getTokenBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Buscar usuário
    const user = await User.findByPk(userId, {
      attributes: ['id', 'tokens', 'isPremium']
    });
    
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
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
    
    return res.status(200).json({
      balance: user.tokens,
      isPremium: user.isPremium,
      subscription,
      stats
    });
  } catch (error) {
    console.error('Erro ao obter saldo de tokens:', error);
    return res.status(500).json({
      message: 'Erro ao obter saldo de tokens',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verificar detalhes de transação
exports.getTransactionDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    
    // Buscar transação
    const transaction = await Transaction.findOne({
      where: {
        id,
        userId
      }
    });
    
    if (!transaction) {
      return res.status(404).json({ message: 'Transação não encontrada' });
    }
    
    // Adicionar detalhes com base no tipo de transação
    let details = {};
    
    if (transaction.type === 'gift' && transaction.metadata.receiverId) {
      const receiver = await User.findByPk(transaction.metadata.receiverId, {
        attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
      });
      
      if (receiver) {
        details.receiver = receiver;
      }
    } else if (transaction.type === 'superchat' && transaction.metadata.channelId) {
      const channel = await Channel.findByPk(transaction.metadata.channelId, {
        attributes: ['id', 'name'],
        include: [
          {
            model: Server,
            attributes: ['id', 'name']
          }
        ]
      });
      
      if (channel) {
        details.channel = channel;
      }
    }
    
    return res.status(200).json({
      transaction,
      details
    });
  } catch (error) {
    console.error('Erro ao obter detalhes da transação:', error);
    return res.status(500).json({
      message: 'Erro ao obter detalhes da transação',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Cancelar assinatura
exports.cancelSubscription = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Buscar assinatura ativa
    const user = await User.findByPk(userId);
    
    if (!user || !user.isPremium) {
      return res.status(400).json({ message: 'Você não possui uma assinatura ativa' });
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
      return res.status(404).json({ message: 'Assinatura não encontrada' });
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
    
    return res.status(200).json({
      message: 'Assinatura cancelada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao cancelar assinatura:', error);
    return res.status(500).json({
      message: 'Erro ao cancelar assinatura',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};