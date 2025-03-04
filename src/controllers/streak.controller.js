const { User } = require('../models');
const { redisClient } = require('../config/redis');

// Verificar streak do usuário
exports.checkStreak = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Obter data da última visita
    const lastVisitKey = `user:${userId}:last_visit`;
    const currentStreakKey = `user:${userId}:current_streak`;
    const maxStreakKey = `user:${userId}:max_streak`;
    
    let lastVisit = await redisClient.get(lastVisitKey);
    let currentStreak = parseInt(await redisClient.get(currentStreakKey) || '0');
    let maxStreak = parseInt(await redisClient.get(maxStreakKey) || '0');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayStr = today.toISOString().split('T')[0];
    
    if (!lastVisit) {
      // Primeira visita
      currentStreak = 1;
      maxStreak = 1;
    } else {
      const lastVisitDate = new Date(lastVisit);
      lastVisitDate.setHours(0, 0, 0, 0);
      
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const lastVisitStr = lastVisitDate.toISOString().split('T')[0];
      
      if (lastVisitStr === todayStr) {
        // Já visitou hoje, não faz nada
      } else if (lastVisitDate.getTime() === yesterday.getTime()) {
        // Visitou ontem, incrementa streak
        currentStreak += 1;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
        }
      } else {
        // Quebrou a sequência
        currentStreak = 1;
      }
    }
    
    // Atualizar dados no Redis
    await redisClient.set(lastVisitKey, todayStr);
    await redisClient.set(currentStreakKey, currentStreak.toString());
    await redisClient.set(maxStreakKey, maxStreak.toString());
    
    // Verificar recompensa por streak
    let rewardEarned = false;
    let rewardAmount = 0;
    
    // Dar recompensas a cada 5 dias de streak
    if (currentStreak % 5 === 0) {
      rewardAmount = Math.min(50, 10 * Math.floor(currentStreak / 5));
      
      // Verificar se já recebeu a recompensa deste marco
      const rewardKey = `user:${userId}:streak_reward:${currentStreak}`;
      const alreadyRewarded = await redisClient.get(rewardKey);
      
      if (!alreadyRewarded) {
        // Atribuir tokens ao usuário
        await User.increment('tokens', {
          by: rewardAmount,
          where: { id: userId }
        });
        
        // Marcar recompensa como recebida
        await redisClient.set(rewardKey, '1');
        rewardEarned = true;
        
        // Criar notificação
        await Notification.create({
          userId,
          title: 'Recompensa de sequência diária',
          message: `Parabéns! Você ganhou ${rewardAmount} tokens por manter uma sequência de ${currentStreak} dias.`,
          type: 'system',
          data: {
            streakDays: currentStreak,
            reward: rewardAmount
          }
        });
      }
    }
    
    return res.status(200).json({
      currentStreak,
      maxStreak,
      lastVisit: todayStr,
      rewardEarned,
      rewardAmount
    });
  } catch (error) {
    console.error('Erro ao verificar streak:', error);
    return res.status(500).json({
      message: 'Erro ao verificar streak diária',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Obter top streaks (placar de líderes)
exports.getStreakLeaderboard = async (req, res) => {
  try {
    // Buscar todos os usuários com streaks
    const streakPattern = 'user:*:current_streak';
    const keys = await redisClient.keys(streakPattern);
    
    if (!keys.length) {
      return res.status(200).json({
        leaderboard: []
      });
    }
    
    // Obter valores de streak para cada usuário
    const pipeline = redisClient.pipeline();
    keys.forEach(key => {
      pipeline.get(key);
    });
    
    const results = await pipeline.exec();
    
    // Processar resultados
    const streaks = keys.map((key, index) => {
      const userId = key.split(':')[1];
      const streak = parseInt(results[index][1] || '0');
      
      return {
        userId,
        streak
      };
    });
    
    // Ordenar por streak
    streaks.sort((a, b) => b.streak - a.streak);
    
    // Limitar a 20 usuários
    const topStreaks = streaks.slice(0, 20);
    
    // Buscar informações dos usuários
    const userIds = topStreaks.map(s => s.userId);
    
    const users = await User.findAll({
      where: {
        id: userIds
      },
      attributes: ['id', 'username', 'displayName', 'avatar', 'avatarType', 'level']
    });
    
    // Combinar dados
    const leaderboard = topStreaks.map(streak => {
      const user = users.find(u => u.id === streak.userId);
      
      if (!user) return null;
      
      return {
        userId: streak.userId,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        avatarType: user.avatarType,
        level: user.level,
        streak: streak.streak
      };
    }).filter(Boolean); // Remover nulos
    
    return res.status(200).json({
      leaderboard
    });
  } catch (error) {
    console.error('Erro ao obter leaderboard de streaks:', error);
    return res.status(500).json({
      message: 'Erro ao carregar placar de líderes',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};