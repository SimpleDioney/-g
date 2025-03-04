const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');

const fsAccess = promisify(fs.access);
const fsUnlink = promisify(fs.unlink);
const fsMkdir = promisify(fs.mkdir);

// Configurar caminho do FFmpeg
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

/**
 * Verifica se um arquivo existe
 * @param {string} filePath - Caminho do arquivo
 * @returns {Promise<boolean>} Resultado da verificação
 */
const fileExists = async (filePath) => {
  try {
    await fsAccess(filePath, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Cria diretório se não existir
 * @param {string} dirPath - Caminho do diretório
 * @returns {Promise<void>}
 */
const ensureDir = async (dirPath) => {
  try {
    await fsAccess(dirPath, fs.constants.F_OK);
  } catch (error) {
    await fsMkdir(dirPath, { recursive: true });
  }
};

/**
 * Obtém a duração de um vídeo
 * @param {string} filePath - Caminho do arquivo de vídeo
 * @returns {Promise<number>} Duração em segundos
 */
const getVideoDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        return reject(err);
      }
      
      resolve(metadata.format.duration);
    });
  });
};

/**
 * Extrai thumbnail de um vídeo
 * @param {string} filePath - Caminho do arquivo de vídeo
 * @param {string} outputDir - Diretório de saída
 * @returns {Promise<string>} Caminho da thumbnail
 */
const extractThumbnail = async (filePath, outputDir) => {
  await ensureDir(outputDir);
  
  const thumbnailFilename = `${path.parse(path.basename(filePath)).name}_thumb.jpg`;
  const outputPath = path.join(outputDir, thumbnailFilename);
  
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .on('error', (err) => {
        reject(err);
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .screenshots({
        count: 1,
        folder: outputDir,
        filename: thumbnailFilename,
        size: '640x360'
      });
  });
};

/**
 * Processa e otimiza um vídeo
 * @param {string} filePath - Caminho do arquivo original
 * @param {string} outputDir - Diretório de saída
 * @param {Object} options - Opções de processamento
 * @returns {Promise<string>} Caminho do vídeo processado
 */
const processVideo = async (filePath, outputDir, options = {}) => {
  await ensureDir(outputDir);
  
  const outputFilename = `${path.parse(path.basename(filePath)).name}_processed.mp4`;
  const outputPath = path.join(outputDir, outputFilename);
  
  const {
    resolution = '720x?',
    videoBitrate = '1000k',
    audioBitrate = '128k',
    fps = 30,
    format = 'mp4'
  } = options;
  
  return new Promise((resolve, reject) => {
    ffmpeg(filePath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size(resolution)
      .videoBitrate(videoBitrate)
      .audioBitrate(audioBitrate)
      .fps(fps)
      .format(format)
      .on('error', (err) => {
        reject(err);
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .save(outputPath);
  });
};

/**
 * Faz upload de um vídeo para o Cloudinary
 * @param {string} filePath - Caminho do arquivo
 * @returns {Promise<Object>} Resultado do upload
 */
const uploadVideoToCloudinary = (filePath) => {
  return cloudinary.uploader.upload(filePath, {
    resource_type: 'video',
    folder: 'videos',
    eager_async: true,
    eager: [
      { 
        format: 'mp4', 
        transformation: [
          { quality: 'auto:good', fetch_format: 'auto' }
        ]
      }
    ]
  });
};

/**
 * Faz upload de uma imagem para o Cloudinary
 * @param {string} filePath - Caminho do arquivo
 * @param {string} folder - Pasta no Cloudinary
 * @returns {Promise<Object>} Resultado do upload
 */
const uploadImageToCloudinary = (filePath, folder = 'thumbnails') => {
  return cloudinary.uploader.upload(filePath, {
    folder,
    transformation: [
      { quality: 'auto:good' }
    ]
  });
};

/**
 * Remove um arquivo
 * @param {string} filePath - Caminho do arquivo
 * @returns {Promise<void>}
 */
const removeFile = async (filePath) => {
  try {
    if (await fileExists(filePath)) {
      await fsUnlink(filePath);
    }
  } catch (error) {
    console.error('Erro ao remover arquivo:', error);
  }
};

/**
 * Processa vídeo completo (extração de thumbnail, conversão e upload)
 * @param {string} filePath - Caminho do arquivo original
 * @returns {Promise<Object>} Resultados do processamento
 */
const processVideoComplete = async (filePath) => {
  try {
    // Criar diretórios temporários
    const tempDir = path.join(__dirname, '../../temp');
    const processedDir = path.join(tempDir, 'processed');
    const thumbnailsDir = path.join(tempDir, 'thumbnails');
    
    await ensureDir(processedDir);
    await ensureDir(thumbnailsDir);
    
    // Obter duração do vídeo
    const duration = await getVideoDuration(filePath);
    
    // Extrair thumbnail
    const thumbnailPath = await extractThumbnail(filePath, thumbnailsDir);
    
    // Processar vídeo
    const processedPath = await processVideo(filePath, processedDir);
    
    // Fazer upload para Cloudinary
    const [videoUpload, thumbnailUpload] = await Promise.all([
      uploadVideoToCloudinary(processedPath),
      uploadImageToCloudinary(thumbnailPath)
    ]);
    
    // Limpar arquivos temporários
    await Promise.all([
      removeFile(filePath),
      removeFile(processedPath),
      removeFile(thumbnailPath)
    ]);
    
    return {
      success: true,
      duration,
      video: {
        url: videoUpload.secure_url,
        publicId: videoUpload.public_id,
        format: videoUpload.format,
        width: videoUpload.width,
        height: videoUpload.height
      },
      thumbnail: {
        url: thumbnailUpload.secure_url,
        publicId: thumbnailUpload.public_id
      }
    };
  } catch (error) {
    // Garantir que os arquivos temporários sejam removidos em caso de erro
    try {
      await removeFile(filePath);
    } catch (e) {
      // Ignorar erros ao remover arquivos
    }
    
    throw error;
  }
};

module.exports = {
  getVideoDuration,
  extractThumbnail,
  processVideo,
  uploadVideoToCloudinary,
  uploadImageToCloudinary,
  removeFile,
  processVideoComplete,
  fileExists,
  ensureDir
};