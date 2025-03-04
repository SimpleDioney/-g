// src/jobs/scheduledTasks.js
const { redisClient, videoProcessingQueue, notificationQueue, emailQueue } = require('../config/redis');
const { Message, User, Channel, Server, Notification } = require('../models');
const { getIO } = require('../config/socketio');

// Processar mensagens agendadas
async function processScheduledMessages() {
  try {
    // Buscar IDs de mensagens agendadas
    const scheduledMessageKeys = await redisClient.keys('scheduled_message:*');
    
    if (scheduledMessageKeys.length === 0) {
      return;
    }
    
    console.log(`Processando ${scheduledMessageKeys.length} mensagens agendadas...`);
    
    // Extrair IDs de mensagem
    const messageIds = scheduledMessageKeys.map(key => key.split(':')[1]);
    
    // Buscar mensagens que chegaram no horário
    const messages = await Message.findAll({
      where: {
        id: messageIds,
        scheduledFor: {
          [Op.lte]: new Date()
        }
      },
      include: [
        {
          model: User,
          attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType']
        },
        {
          model: Channel
        }
      ]
    });
    
    // Processar cada mensagem
    for (const message of messages) {
      console.log(`Enviando mensagem agendada ${message.id}...`);
      
      // Limpar campo scheduledFor
      await message.update({
        scheduledFor: null
      });
      
      // Remover da fila
      await redisClient.del(`scheduled_message:${message.id}`);
      
      // Enviar para todos no canal
      const io = getIO();
      io.to(`channel:${message.channelId}`).emit('new_message', message);
    }
  } catch (error) {
    console.error('Erro ao processar mensagens agendadas:', error);
  }
}

// Processar mensagens com expiração
async function processExpiringMessages() {
  try {
    // Buscar IDs de mensagens expiradas
    const expiringMessageKeys = await redisClient.keys('expiring_message:*');
    
    if (expiringMessageKeys.length === 0) {
      return;
    }
    
    console.log(`Processando ${expiringMessageKeys.length} mensagens autodestrutivas...`);
    
    // Extrair IDs de mensagem
    const messageIds = expiringMessageKeys.map(key => key.split(':')[1]);
    
    // Verificar mensagens que ainda existem
    const messages = await Message.findAll({
      where: {
        id: messageIds
      },
      attributes: ['id', 'channelId']
    });
    
    // Processar cada mensagem
    for (const message of messages) {
      console.log(`Excluindo mensagem autodestrutiva ${message.id}...`);
      
      // Armazenar channelId para notificação
      const channelId = message.channelId;
      
      // Excluir mensagem
      await message.destroy();
      
      // Remover da fila
      await redisClient.del(`expiring_message:${message.id}`);
      
      // Notificar usuários no canal
      const io = getIO();
      io.to(`channel:${channelId}`).emit('message_deleted', {
        id: message.id,
        reason: 'expired'
      });
    }
  } catch (error) {
    console.error('Erro ao processar mensagens expiradas:', error);
  }
}

// Processar enquetes expiradas
async function processExpiringPolls() {
  try {
    // Buscar IDs de enquetes expiradas
    const expiringPollKeys = await redisClient.keys('poll_expiry:*');
    
    if (expiringPollKeys.length === 0) {
      return;
    }
    
    console.log(`Processando ${expiringPollKeys.length} enquetes expiradas...`);
    
    // Extrair IDs de mensagem
    const messageIds = expiringPollKeys.map(key => key.split(':')[1]);
    
    // Buscar mensagens de enquete
    const polls = await Message.findAll({
      where: {
        id: messageIds,
        type: 'poll'
      }
    });
    
    // Processar cada enquete
    for (const poll of polls) {
      console.log(`Finalizando enquete ${poll.id}...`);
      
      // Marcar como expirada
      const pollData = poll.attachments;
      pollData.expired = true;
      
      // Atualizar mensagem
      await poll.update({ attachments: pollData });
      
      // Remover da fila
      await redisClient.del(`poll_expiry:${poll.id}`);
      
      // Notificar usuários no canal
      const io = getIO();
      io.to(`channel:${poll.channelId}`).emit('poll_expired', {
        id: poll.id
      });
      
      // Apurar resultados
      const results = pollData.options.map(option => ({
        text: option.text,
        votes: option.votes.length
      })).sort((a, b) => b.votes - a.votes);
      
      // Criar mensagem com resultado
      await Message.create({
        channelId: poll.channelId,
        userId: poll.userId,
        content: `Enquete "${pollData.question}" encerrada. Resultado: ${results.map(r => `"${r.text}": ${r.votes} votos`).join(', ')}`,
        type: 'system'
      });
    }
  } catch (error) {
    console.error('Erro ao processar enquetes expiradas:', error);
  }
}

// Verificar e remover banimentos expirados
async function processExpiredBans() {
  try {
    // Buscar todos os banimentos
    const banKeys = await redisClient.keys('server:*:banned:*');
    
    if (banKeys.length === 0) {
      return;
    }
    
    console.log(`Verificando ${banKeys.length} banimentos...`);
    
    // Verificar cada banimento
    for (const key of banKeys) {
      const banData = await redisClient.get(key);
      
      if (!banData) continue;
      
      const ban = JSON.parse(banData);
      
      // Verificar se tem data de expiração
      if (ban.expiration) {
        const expirationDate = new Date(ban.expiration);
        
        if (expirationDate <= new Date()) {
          console.log(`Removendo banimento expirado: ${key}`);
          
          // Extrair IDs
          const [, serverId, , userId] = key.split(':');
          
          // Remover banimento
          await redisClient.del(key);
          
          // Registrar nos logs
          await redisClient.lpush(`server:${serverId}:mod_logs`, JSON.stringify({
            type: 'unban',
            userId,
            moderatorId: 'system',
            reason: 'Ban expirado automaticamente',
            timestamp: new Date().toISOString()
          }));
          
          // Notificar usuário
          const io = getIO();
          
          // Buscar nome do servidor
          const server = await Server.findByPk(serverId, {
            attributes: ['name']
          });
          
          io.to(`user:${userId}`).emit('ban_expired', {
            serverId,
            serverName: server?.name || 'Servidor'
          });
        }
      }
    }
  } catch (error) {
    console.error('Erro ao processar banimentos expirados:', error);
  }
}

// Verificar e remover silenciamentos expirados
async function processExpiredMutes() {
  try {
    // Buscar todos os silenciamentos
    const muteKeys = await redisClient.keys('server:*:channel:*:muted:*');
    
    if (muteKeys.length === 0) {
      return;
    }
    
    console.log(`Verificando ${muteKeys.length} silenciamentos...`);
    
    // Verificar cada silenciamento
    for (const key of muteKeys) {
      const muteData = await redisClient.get(key);
      
      if (!muteData) continue;
      
      const mute = JSON.parse(muteData);
      
      // Verificar se tem data de expiração
      if (mute.expiration) {
        const expirationDate = new Date(mute.expiration);
        
        if (expirationDate <= new Date()) {
          console.log(`Removendo silenciamento expirado: ${key}`);
          
          // Extrair IDs
          const [, serverId, , channelId, , userId] = key.split(':');
          
          // Remover silenciamento
          await redisClient.del(key);
          
          // Registrar nos logs
          await redisClient.lpush(`server:${serverId}:mod_logs`, JSON.stringify({
            type: 'unmute',
            userId,
            channelId,
            moderatorId: 'system',
            reason: 'Silenciamento expirado automaticamente',
            timestamp: new Date().toISOString()
          }));
          
          // Notificar usuário
          const io = getIO();
          
          // Buscar nome do canal
          const channel = await Channel.findByPk(channelId, {
            attributes: ['name']
          });
          
          io.to(`user:${userId}`).emit('channel_unmute', {
            serverId,
            channelId,
            channelName: channel?.name
          });
        }
      }
    }
  } catch (error) {
    console.error('Erro ao processar silenciamentos expirados:', error);
  }
}

// Limpar notificações antigas (mais de 30 dias)
async function cleanupOldNotifications() {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const result = await Notification.destroy({
      where: {
        createdAt: {
          [Op.lt]: thirtyDaysAgo
        }
      }
    });
    
    if (result > 0) {
      console.log(`Limpeza: Removidas ${result} notificações antigas.`);
    }
  } catch (error) {
    console.error('Erro ao limpar notificações antigas:', error);
  }
}

// Atualizar ranking de vídeos em tendência
async function updateTrendingVideos() {
  try {
    console.log('Atualizando ranking de vídeos em tendência...');
    
    // Diferentes períodos
    const periods = [
      { key: 'trending:day', days: 1 },
      { key: 'trending:week', days: 7 },
      { key: 'trending:month', days: 30 }
    ];
    
    for (const period of periods) {
      // Definir data início
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - period.days);
      
      // Buscar vídeos do período
      const videos = await Video.findAll({
        where: {
          status: 'published',
          isPublic: true,
          createdAt: {
            [Op.gte]: startDate
          }
        },
        attributes: ['id', 'title', 'thumbnailUrl', 'views', 'likes', 'comments', 'shares'],
        include: [
          {
            model: User,
            attributes: ['id', 'username', 'displayName', 'avatar']
          }
        ],
        limit: 100
      });
      
      // Calcular pontuação para cada vídeo
      // Fórmula: (visualizações * 1) + (likes * 5) + (comentários * 3) + (compartilhamentos * 7)
      const scoredVideos = videos.map(video => {
        const score = 
          (video.views || 0) + 
          (video.likes || 0) * 5 + 
          (video.comments || 0) * 3 + 
          (video.shares || 0) * 7;
          
        return {
          id: video.id,
          title: video.title,
          thumbnailUrl: video.thumbnailUrl,
          userId: video.User.id,
          username: video.User.username,
          displayName: video.User.displayName,
          avatar: video.User.avatar,
          stats: {
            views: video.views || 0,
            likes: video.likes || 0,
            comments: video.comments || 0
          },
          score
        };
      });
      
      // Ordenar por pontuação
      scoredVideos.sort((a, b) => b.score - a.score);
      
      // Armazenar no Redis
      await redisClient.set(period.key, JSON.stringify(scoredVideos.slice(0, 50)));
    }
  } catch (error) {
    console.error('Erro ao atualizar vídeos em tendência:', error);
  }
}

// Função principal que executa todas as tarefas agendadas
async function runScheduledTasks() {
  console.log('Executando tarefas agendadas...');
  
  await processScheduledMessages();
  await processExpiringMessages();
  await processExpiringPolls();
  await processExpiredBans();
  await processExpiredMutes();
  await cleanupOldNotifications();
  await updateTrendingVideos();
  
  console.log('Tarefas agendadas concluídas.');
}

// Configurar execução periódica
setInterval(runScheduledTasks, 60000); // A cada minuto

// Exportar funções para testes
module.exports = {
  processScheduledMessages,
  processExpiringMessages,
  processExpiringPolls,
  processExpiredBans,
  processExpiredMutes,
  cleanupOldNotifications,
  updateTrendingVideos,
  runScheduledTasks
};

// src/jobs/emailProcessor.js
const nodemailer = require('nodemailer');
const { emailQueue } = require('../config/redis');

// Configurar transporte de e-mail
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.example.com',
  port: process.env.EMAIL_PORT || 587,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER || 'user@example.com',
    pass: process.env.EMAIL_PASSWORD || 'password'
  }
});

// Templates de e-mail
const emailTemplates = {
  // E-mail de verificação
  verificationEmail: (data) => ({
    subject: 'Verifique seu e-mail no StreamChat',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Bem-vindo ao StreamChat!</h2>
        <p>Olá ${data.username},</p>
        <p>Obrigado por se cadastrar no StreamChat. Para verificar sua conta, clique no botão abaixo:</p>
        <p style="text-align: center;">
          <a href="${data.verificationLink}" style="background-color: #5865F2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Verificar minha conta
          </a>
        </p>
        <p>Se você não solicitou este e-mail, ignore-o.</p>
        <p>Atenciosamente,<br>Equipe StreamChat</p>
      </div>
    `
  }),
  
  // E-mail de redefinição de senha
  passwordResetEmail: (data) => ({
    subject: 'Redefinição de senha no StreamChat',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Redefinição de senha</h2>
        <p>Olá ${data.username},</p>
        <p>Você solicitou a redefinição de senha da sua conta no StreamChat. Clique no botão abaixo para definir uma nova senha:</p>
        <p style="text-align: center;">
          <a href="${data.resetLink}" style="background-color: #5865F2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
            Redefinir minha senha
          </a>
        </p>
        <p>Este link expirará em 1 hora.</p>
        <p>Se você não solicitou a redefinição, ignore este e-mail.</p>
        <p>Atenciosamente,<br>Equipe StreamChat</p>
      </div>
    `
  }),
  
  // Confirmação de pagamento
  paymentConfirmation: (data) => ({
    subject: 'Confirmação de Pagamento - StreamChat',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Pagamento Confirmado</h2>
        <p>Olá ${data.username},</p>
        <p>Seu pagamento foi confirmado com sucesso. Aqui estão os detalhes:</p>
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Data:</strong> ${new Date(data.date).toLocaleString()}</p>
          <p><strong>Valor:</strong> R$ ${data.amount.toFixed(2)}</p>
          <p><strong>Tokens:</strong> ${data.tokens}</p>
        </div>
        <p>Os tokens já foram adicionados à sua conta e estão disponíveis para uso.</p>
        <p>Obrigado por apoiar o StreamChat!</p>
        <p>Atenciosamente,<br>Equipe StreamChat</p>
      </div>
    `
  })
};

// Processar e-mails da fila
emailQueue.process(async (job) => {
  try {
    const { type, ...data } = job.data;
    
    // Verificar se o template existe
    if (!emailTemplates[type]) {
      throw new Error(`Template de e-mail "${type}" não encontrado`);
    }
    
    // Gerar corpo do e-mail
    const emailContent = emailTemplates[type](data);
    
    // Configurar e-mail
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'StreamChat <contato@dioneygabriel.com.br>',
      to: data.email,
      subject: emailContent.subject,
      html: emailContent.html
    };
    
    // Enviar e-mail
    const info = await transporter.sendMail(mailOptions);
    
    console.log(`E-mail enviado: ${info.messageId}`);
    
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
    throw error;
  }
});

console.log('Processador de e-mails iniciado');