const { redisClient } = require('../config/redis');
const { User, Server, UserServer } = require('../models');

module.exports = (io, socket) => {
  // Gestão de presença e status do usuário
  const handleStatusChange = async (status) => {
    try {
      const userId = socket.user.id;
      
      // Validar status
      const validStatuses = ['online', 'away', 'busy', 'invisible', 'offline'];
      if (!validStatuses.includes(status)) {
        return socket.emit('error', { message: 'Status inválido' });
      }
      
      // Atualizar no banco de dados
      await User.update({ status }, { where: { id: userId } });
      
      // Atualizar no Redis (exceto se invisível)
      if (status === 'invisible') {
        await redisClient.set(`user:${userId}:status`, 'offline');
        await redisClient.set(`user:${userId}:invisible`, '1');
      } else {
        await redisClient.set(`user:${userId}:status`, status);
        await redisClient.del(`user:${userId}:invisible`);
      }
      
      // Enviar atualização para servidores que o usuário participa
      const userServers = await UserServer.findAll({
        where: { userId },
        attributes: ['serverId']
      });
      
      const serverIds = userServers.map(us => us.serverId);
      
      // Não notificar outros se invisível
      if (status !== 'invisible') {
        serverIds.forEach(serverId => {
          socket.to(`server:${serverId}`).emit('user_status_changed', {
            userId,
            status
          });
        });
      }
      
      socket.emit('status_updated', { status });
    } catch (error) {
      console.error('Erro ao atualizar status:', error);
      socket.emit('error', { message: 'Erro ao atualizar status' });
    }
  };
  
  // Entrar nos canais dos servidores
  const joinUserRooms = async () => {
    try {
      const userId = socket.user.id;
      
      // Buscar servidores do usuário
      const userServers = await UserServer.findAll({
        where: { userId },
        include: [
          {
            model: Server,
            attributes: ['id']
          }
        ]
      });
      
      // Entrar em todas as salas dos servidores
      const serverIds = userServers.map(us => us.Server.id);
      
      serverIds.forEach(serverId => {
        socket.join(`server:${serverId}`);
      });
      
      // Entrar na sala privada do usuário
      socket.join(`user:${userId}`);
      
      // Atualizar lista de usuários online nos servidores
      const status = await redisClient.get(`user:${userId}:status`);
      
      // Não notificar outros se invisível
      if (status !== 'invisible') {
        serverIds.forEach(serverId => {
          socket.to(`server:${serverId}`).emit('user_status_changed', {
            userId,
            status: status || 'online'
          });
        });
      }
      
      socket.emit('rooms_joined', { servers: serverIds });
    } catch (error) {
      console.error('Erro ao entrar nas salas:', error);
      socket.emit('error', { message: 'Erro ao entrar nas salas dos servidores' });
    }
  };
  
  // Obter usuários online em um servidor
  const getOnlineUsers = async (serverId) => {
    try {
      // Verificar se o usuário é membro do servidor
      const membership = await UserServer.findOne({
        where: {
          userId: socket.user.id,
          serverId
        }
      });
      
      if (!membership) {
        return socket.emit('error', { message: 'Você não é membro deste servidor' });
      }
      
      // Buscar todos os membros do servidor
      const serverMembers = await UserServer.findAll({
        where: { serverId },
        attributes: ['userId']
      });
      
      const memberIds = serverMembers.map(m => m.userId);
      
      // Consultar status no Redis
      const pipeline = redisClient.pipeline();
      memberIds.forEach(id => {
        pipeline.get(`user:${id}:status`);
        pipeline.get(`user:${id}:invisible`);
      });
      
      const results = await pipeline.exec();
      
      // Processar resultados
      const onlineUsers = {};
      
      for (let i = 0; i < memberIds.length; i++) {
        const userId = memberIds[i];
        const status = results[i * 2][1]; // Status
        const isInvisible = results[i * 2 + 1][1]; // Flag de invisível
        
        // Não incluir usuários invisíveis, exceto o próprio usuário
        if (!isInvisible || userId === socket.user.id) {
          onlineUsers[userId] = status || 'offline';
        }
      }
      
      socket.emit('online_users', { serverId, users: onlineUsers });
    } catch (error) {
      console.error('Erro ao obter usuários online:', error);
      socket.emit('error', { message: 'Erro ao obter usuários online' });
    }
  };
  
  // Registrar handlers
  socket.on('set_status', handleStatusChange);
  socket.on('join_rooms', joinUserRooms);
  socket.on('get_online_users', getOnlineUsers);
  
  // Iniciar automaticamente
  joinUserRooms();
};