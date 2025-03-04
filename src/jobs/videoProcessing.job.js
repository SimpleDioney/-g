const { videoProcessingQueue } = require('../config/redis');
const { Video, User, Notification } = require('../models');
const cloudinary = require('cloudinary').v2;
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const unlinkAsync = promisify(fs.unlink);

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Extrair thumbnail do vídeo
const extractThumbnail = async (filePath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .on('error', (err) => {
        console.error('Erro ao extrair thumbnail:', err);
        reject(err);
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .screenshots({
        count: 1,
        folder: path.dirname(outputPath),
        filename: path.basename(outputPath),
        size: '640x360'
      });
  });
};

// Processar e otimizar vídeo
const processVideo = async (filePath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size('720x?') // Redimensionar para 720p
      .videoBitrate('1000k')
      .audioBitrate('128k')
      .fps(30)
      .format('mp4')
      .on('error', (err) => {
        console.error('Erro ao processar vídeo:', err);
        reject(err);
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .save(outputPath);
  });
};

// Obter duração do vídeo
const getVideoDuration = async (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        console.error('Erro ao obter metadados do vídeo:', err);
        return reject(err);
      }
      
      resolve(metadata.format.duration);
    });
  });
};

// Processar job da fila
videoProcessingQueue.process('processVideo', async (job) => {
  const { videoId, filePath, filename } = job.data;
  
  try {
    console.log(`Processando vídeo ${videoId}...`);
    
    // Verificar se o arquivo existe
    if (!fs.existsSync(filePath)) {
      throw new Error('Arquivo de vídeo não encontrado');
    }
    
    // Criar diretórios para arquivos processados
    const processedDir = path.join(__dirname, '../../uploads/processed');
    const thumbnailsDir = path.join(__dirname, '../../uploads/thumbnails');
    
    if (!fs.existsSync(processedDir)) {
      fs.mkdirSync(processedDir, { recursive: true });
    }
    
    if (!fs.existsSync(thumbnailsDir)) {
      fs.mkdirSync(thumbnailsDir, { recursive: true });
    }
    
    // Caminhos para arquivos processados
    const outputVideoPath = path.join(processedDir, filename);
    const outputThumbnailPath = path.join(thumbnailsDir, `${path.parse(filename).name}.jpg`);
    
    // Obter duração do vídeo
    const duration = await getVideoDuration(filePath);
    
    // Extrair thumbnail
    await extractThumbnail(filePath, outputThumbnailPath);
    
    // Processar vídeo
    await processVideo(filePath, outputVideoPath);
    
    // Fazer upload para Cloudinary
    const videoUpload = await cloudinary.uploader.upload(outputVideoPath, {
      resource_type: 'video',
      folder: 'videos',
      eager_async: true,
      eager: [
        { format: 'mp4', transformation: [
          { quality: 'auto:good', fetch_format: 'auto' }
        ]}
      ]
    });
    
    const thumbnailUpload = await cloudinary.uploader.upload(outputThumbnailPath, {
      folder: 'thumbnails',
      transformation: [
        { width: 640, height: 360, crop: 'fill' }
      ]
    });
    
    // Atualizar vídeo no banco de dados
    const video = await Video.findByPk(videoId);
    
    if (!video) {
      throw new Error('Vídeo não encontrado no banco de dados');
    }
    
    await video.update({
      url: videoUpload.secure_url,
      thumbnailUrl: thumbnailUpload.secure_url,
      duration,
      status: 'published',
      metadata: {
        videoId: videoUpload.public_id,
        thumbnailId: thumbnailUpload.public_id,
        format: videoUpload.format,
        width: videoUpload.width,
        height: videoUpload.height,
        original_filename: filename
      }
    });
    
    // Notificar usuário
    await Notification.create({
      userId: video.userId,
      title: 'Vídeo processado',
      message: `Seu vídeo "${video.title}" foi processado e está disponível agora.`,
      type: 'system',
      sourceId: video.id,
      sourceType: 'video'
    });
    
    // Limpar arquivos temporários
    await Promise.all([
      unlinkAsync(filePath),
      unlinkAsync(outputVideoPath),
      unlinkAsync(outputThumbnailPath)
    ]);
    
    console.log(`Vídeo ${videoId} processado com sucesso!`);
    
    return { success: true, videoId };
  } catch (error) {
    console.error(`Erro ao processar vídeo ${videoId}:`, error);
    
    // Atualizar status do vídeo para falha
    const video = await Video.findByPk(videoId);
    
    if (video) {
      await video.update({
        status: 'failed',
        metadata: {
          error: error.message
        }
      });
      
      // Notificar usuário sobre a falha
      await Notification.create({
        userId: video.userId,
        title: 'Falha no processamento',
        message: `Ocorreu um erro ao processar seu vídeo "${video.title}". Por favor, tente novamente.`,
        type: 'system',
        sourceId: video.id,
        sourceType: 'video'
      });
    }
    
    // Limpar arquivos temporários
    if (fs.existsSync(filePath)) {
      await unlinkAsync(filePath);
    }
    
    throw error;
  }
});