const Redis = require('ioredis');
const Bull = require('bull');

let redisClient;

// Configuração do Redis
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || '',
  maxRetriesPerRequest: 5
};

// Inicializar cliente Redis
async function initRedis() {
  try {
    redisClient = new Redis(redisConfig);
    
    // Listeners de eventos Redis
    redisClient.on('error', (error) => {
      console.error('❌ Erro na conexão Redis:', error);
    });
    
    redisClient.on('connect', () => {
      console.log('🔄 Conectando ao Redis...');
    });
    
    await redisClient.ping();
    return redisClient;
  } catch (error) {
    console.error('❌ Não foi possível conectar ao Redis:', error);
    throw error;
  }
}

// Criar uma fila do Bull
function createQueue(name) {
  return new Bull(name, {
    redis: redisConfig,
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: true,
      removeOnFail: false
    }
  });
}

// Queues para processamento assíncrono
const videoProcessingQueue = createQueue('video-processing');
const notificationQueue = createQueue('notifications');
const emailQueue = createQueue('emails');

module.exports = {
  initRedis,
  redisClient,
  videoProcessingQueue,
  notificationQueue,
  emailQueue
};
