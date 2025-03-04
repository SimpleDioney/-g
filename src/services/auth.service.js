// src/services/auth.service.js
const { User } = require('../models');
const { redisClient, emailQueue } = require('../config/redis');
const { generateJWT, generateRefreshToken, hashPassword, comparePassword, verifyJWT, verifyRefreshToken } = require('../utils/security');
const { v4: uuidv4 } = require('uuid');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');

class AuthService {
  /**
   * Gerar tokens JWT e Refresh Token para um usuário
   * @param {Object} user - Instância do usuário
   * @returns {Promise<Object>} Tokens gerados
   */
  async generateTokens(user) {
    const payload = user.toJWTPayload();
    
    // Token de acesso
    const accessToken = generateJWT(payload);
    
    // Token de atualização
    const refreshToken = generateRefreshToken(payload);
    
    // Armazenar hash do refresh token
    const refreshTokenHash = await hashPassword(refreshToken);
    
    // Atualizar no banco de dados
    await user.update({ 
      refreshToken: refreshTokenHash,
      lastLogin: new Date()
    });
    
    return { accessToken, refreshToken };
  }
  
  /**
   * Registrar novo usuário
   * @param {Object} userData - Dados do usuário
   * @returns {Promise<Object>} Resultado do registro
   */
  async register(userData) {
    const { email, username, password } = userData;
    
    // Verificar se usuário já existe
    const existingUser = await User.findOne({
      where: {
        [sequelize.Op.or]: [{ email }, { username }]
      }
    });
    
    if (existingUser) {
      throw {
        statusCode: 409,
        message: 'Email ou nome de usuário já cadastrado'
      };
    }
    
    // Criar novo usuário
    const user = await User.create({
      email,
      username,
      password, // Hash é feito automaticamente nos hooks do modelo
      displayName: username,
      status: 'online'
    });
    
    // Gerar tokens
    const tokens = await this.generateTokens(user);
    
    // Gerar token de verificação de e-mail
    const verificationToken = uuidv4();
    await redisClient.set(`verification:${user.id}`, verificationToken, 'EX', 86400); // 24 horas
    
    // Enviar e-mail de verificação
    await emailQueue.add('verificationEmail', {
      email: user.email,
      username: user.username,
      verificationLink: `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}&userId=${user.id}`
    });
    
    return {
      user,
      ...tokens
    };
  }
  
  /**
   * Autenticar usuário com e-mail e senha
   * @param {string} email - E-mail do usuário
   * @param {string} password - Senha do usuário
   * @returns {Promise<Object>} Resultado da autenticação
   */
  async login(email, password) {
    // Buscar usuário
    const user = await User.findOne({ where: { email } });
    
    if (!user) {
      throw {
        statusCode: 401,
        message: 'Credenciais inválidas'
      };
    }
    
    // Verificar senha
    const isPasswordValid = await user.checkPassword(password);
    
    if (!isPasswordValid) {
      // Registrar tentativa de login falha
      const loginAttempts = await redisClient.incr(`login_attempts:${user.id}`);
      await redisClient.expire(`login_attempts:${user.id}`, 3600); // 1 hora
      
      // Bloquear após 5 tentativas
      if (loginAttempts >= 5) {
        await redisClient.set(`user:${user.id}:blocked`, 'true', 'EX', 3600); // 1 hora
        throw {
          statusCode: 429,
          message: 'Muitas tentativas de login. Conta bloqueada por 1 hora.'
        };
      }
      
      throw {
        statusCode: 401,
        message: 'Credenciais inválidas'
      };
    }
    
    // Verificar se a conta está bloqueada
    const isBlocked = await redisClient.get(`user:${user.id}:blocked`);
    if (isBlocked) {
      throw {
        statusCode: 403,
        message: 'Conta temporariamente bloqueada. Tente novamente mais tarde.'
      };
    }
    
    // Limpar contagem de tentativas
    await redisClient.del(`login_attempts:${user.id}`);
    
    // Verificar 2FA se estiver ativado
    if (user.twoFactorEnabled) {
      // Gerar token temporário para validação 2FA
      const tempToken = generateJWT({ id: user.id, require2FA: true }, '5m');
      
      return {
        require2FA: true,
        tempToken
      };
    }
    
    // Atualizar status online
    await user.update({ status: 'online' });
    await redisClient.set(`user:${user.id}:status`, 'online');
    
    // Gerar tokens
    const tokens = await this.generateTokens(user);
    
    return {
      user,
      ...tokens
    };
  }
  
  /**
   * Verificar código 2FA
   * @param {string} tempToken - Token temporário
   * @param {string} code - Código 2FA
   * @returns {Promise<Object>} Resultado da verificação
   */
  async verify2FA(tempToken, code) {
    // Verificar token temporário
    const decoded = verifyJWT(tempToken);
    
    if (!decoded || !decoded.require2FA) {
      throw {
        statusCode: 401,
        message: 'Token inválido ou expirado'
      };
    }
    
    // Buscar usuário
    const user = await User.findByPk(decoded.id);
    
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw {
        statusCode: 400,
        message: 'Autenticação de dois fatores não está configurada para este usuário'
      };
    }
    
    // Verificar código 2FA
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code
    });
    
    if (!verified) {
      throw {
        statusCode: 401,
        message: 'Código de verificação inválido'
      };
    }
    
    // Atualizar status online
    await user.update({ status: 'online' });
    await redisClient.set(`user:${user.id}:status`, 'online');
    
    // Gerar tokens
    const tokens = await this.generateTokens(user);
    
    return {
      user,
      ...tokens
    };
  }
  
  /**
   * Iniciar configuração 2FA
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Dados para configuração 2FA
   */
  async setup2FA(userId) {
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Gerar segredo 2FA
    const secret = speakeasy.generateSecret({
      name: `StreamChat:${user.email}`
    });
    
    // Gerar QR code
    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);
    
    // Armazenar temporariamente o segredo no Redis
    await redisClient.set(`2fa_temp:${user.id}`, secret.base32, 'EX', 600); // 10 minutos
    
    return {
      secret: secret.base32, // Isso será usado para confirmar a configuração
      qrCode: qrCodeUrl
    };
  }
  
  /**
   * Confirmar configuração 2FA
   * @param {string} userId - ID do usuário
   * @param {string} code - Código 2FA
   * @returns {Promise<Object>} Resultado da confirmação
   */
  async confirm2FA(userId, code) {
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Obter segredo temporário do Redis
    const secret = await redisClient.get(`2fa_temp:${user.id}`);
    
    if (!secret) {
      throw {
        statusCode: 400,
        message: 'Tempo expirado para configuração 2FA. Inicie novamente.'
      };
    }
    
    // Verificar código 2FA
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code
    });
    
    if (!verified) {
      throw {
        statusCode: 400,
        message: 'Código de verificação inválido'
      };
    }
    
    // Ativar 2FA para o usuário
    await user.update({
      twoFactorEnabled: true,
      twoFactorSecret: secret
    });
    
    // Limpar segredo temporário
    await redisClient.del(`2fa_temp:${user.id}`);
    
    return { success: true };
  }
  
  /**
   * Desativar 2FA
   * @param {string} userId - ID do usuário
   * @param {string} code - Código 2FA
   * @param {string} password - Senha do usuário
   * @returns {Promise<Object>} Resultado da desativação
   */
  async disable2FA(userId, code, password) {
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Verificar senha
    const isPasswordValid = await user.checkPassword(password);
    
    if (!isPasswordValid) {
      throw {
        statusCode: 401,
        message: 'Senha incorreta'
      };
    }
    
    // Verificar código 2FA
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: code
      });
      
      if (!verified) {
        throw {
          statusCode: 401,
          message: 'Código de verificação inválido'
        };
      }
    } else {
      throw {
        statusCode: 400,
        message: 'Autenticação de dois fatores não está ativada'
      };
    }
    
    // Desativar 2FA
    await user.update({
      twoFactorEnabled: false,
      twoFactorSecret: null
    });
    
    return { success: true };
  }
  
  /**
   * Atualizar token de acesso com refresh token
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object>} Novo token de acesso
   */
  async refreshToken(refreshToken) {
    if (!refreshToken) {
      throw {
        statusCode: 400,
        message: 'Refresh token não fornecido'
      };
    }
    
    // Verificar blacklist de tokens revogados
    const isRevoked = await redisClient.get(`revoked_token:${refreshToken}`);
    
    if (isRevoked) {
      throw {
        statusCode: 401,
        message: 'Token revogado'
      };
    }
    
    // Verificar refresh token
    const decoded = verifyRefreshToken(refreshToken);
    
    if (!decoded) {
      throw {
        statusCode: 401,
        message: 'Refresh token inválido ou expirado'
      };
    }
    
    // Buscar usuário
    const user = await User.findByPk(decoded.id);
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Verificar se o refresh token é válido
    const isValidToken = user.refreshToken && await comparePassword(refreshToken, user.refreshToken);
    
    if (!isValidToken) {
      throw {
        statusCode: 401,
        message: 'Refresh token inválido'
      };
    }
    
    // Gerar novo token de acesso
    const accessToken = generateJWT(user.toJWTPayload());
    
    return { accessToken };
  }
  
  /**
   * Realizar logout
   * @param {string} userId - ID do usuário
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object>} Resultado do logout
   */
  async logout(userId, refreshToken) {
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Invalidar refresh token
    if (refreshToken) {
      // Adicionar à blacklist de tokens revogados
      await redisClient.set(`revoked_token:${refreshToken}`, '1', 'EX', 86400 * 7); // 7 dias
    }
    
    // Limpar refresh token do usuário
    await user.update({
      refreshToken: null,
      status: 'offline'
    });
    
    // Atualizar status no Redis
    await redisClient.set(`user:${userId}:status`, 'offline');
    
    return { success: true };
  }
  
  /**
   * Verificar e-mail
   * @param {string} userId - ID do usuário
   * @param {string} token - Token de verificação
   * @returns {Promise<Object>} Resultado da verificação
   */
  async verifyEmail(userId, token) {
    // Buscar token de verificação no Redis
    const storedToken = await redisClient.get(`verification:${userId}`);
    
    if (!storedToken || storedToken !== token) {
      throw {
        statusCode: 400,
        message: 'Token de verificação inválido ou expirado'
      };
    }
    
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Atualizar status de verificação
    await user.update({
      isVerified: true
    });
    
    // Remover token de verificação
    await redisClient.del(`verification:${userId}`);
    
    return { success: true };
  }
  
  /**
   * Solicitar redefinição de senha
   * @param {string} email - E-mail do usuário
   * @returns {Promise<Object>} Resultado da solicitação
   */
  async requestPasswordReset(email) {
    // Buscar usuário
    const user = await User.findOne({ where: { email } });
    
    if (!user) {
      // Por segurança, não informamos se o e-mail existe ou não
      return { success: true };
    }
    
    // Gerar token de redefinição
    const resetToken = uuidv4();
    
    // Armazenar token no Redis
    await redisClient.set(`password_reset:${user.id}`, resetToken, 'EX', 3600); // 1 hora
    
    // Enviar e-mail com link de redefinição
    await emailQueue.add('passwordResetEmail', {
      email: user.email,
      username: user.username,
      resetLink: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&userId=${user.id}`
    });
    
    return { success: true };
  }
  
  /**
   * Redefinir senha
   * @param {string} userId - ID do usuário
   * @param {string} token - Token de redefinição
   * @param {string} newPassword - Nova senha
   * @returns {Promise<Object>} Resultado da redefinição
   */
  async resetPassword(userId, token, newPassword) {
    // Buscar token de redefinição no Redis
    const storedToken = await redisClient.get(`password_reset:${userId}`);
    
    if (!storedToken || storedToken !== token) {
      throw {
        statusCode: 400,
        message: 'Token de redefinição inválido ou expirado'
      };
    }
    
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      throw {
        statusCode: 404,
        message: 'Usuário não encontrado'
      };
    }
    
    // Atualizar senha
    await user.update({
      password: newPassword
    });
    
    // Remover token de redefinição
    await redisClient.del(`password_reset:${userId}`);
    
    // Invalidar todos os refresh tokens
    if (user.refreshToken) {
      await user.update({
        refreshToken: null
      });
    }
    
    return { success: true };
  }
}

module.exports = new AuthService();