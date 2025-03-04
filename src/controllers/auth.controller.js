const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { User } = require('../models');
const { 
  JWT_SECRET, 
  JWT_EXPIRES_IN, 
  REFRESH_TOKEN_SECRET, 
  REFRESH_TOKEN_EXPIRES_IN 
} = require('../config/jwt');
const { redisClient } = require('../config/redis');
const { emailQueue } = require('../config/redis');

// Gerar tokens JWT
const generateTokens = async (user) => {
  const payload = user.toJWTPayload();
  
  // Token de acesso
  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
  
  // Token de atualização
  const refreshToken = jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN
  });
  
  // Armazenar o refresh token no banco de dados
  await user.update({ 
    refreshToken: await bcrypt.hash(refreshToken, 10),
    lastLogin: new Date()
  });
  
  return { accessToken, refreshToken };
};

// Registro de novo usuário
exports.register = async (req, res) => {
  try {
    const { email, username, password } = req.body;
    
    // Verificar se usuário já existe
    const existingUser = await User.findOne({
      where: {
        [sequelize.Op.or]: [{ email }, { username }]
      }
    });
    
    if (existingUser) {
      return res.status(409).json({
        message: 'Email ou nome de usuário já cadastrado'
      });
    }
    
    // Criar novo usuário
    const user = await User.create({
      email,
      username,
      password,
      displayName: username,
      status: 'online'
    });
    
    // Gerar tokens
    const { accessToken, refreshToken } = await generateTokens(user);
    
    // Enviar email de verificação
    const verificationToken = uuidv4();
    await redisClient.set(`verification:${user.id}`, verificationToken, 'EX', 86400); // 24 horas
    
    await emailQueue.add('verificationEmail', {
      email: user.email,
      username: user.username,
      verificationLink: `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}&userId=${user.id}`
    });
    
    // Retornar dados e tokens
    return res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Erro no registro:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao processar o registro',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Login com email e senha
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Buscar usuário
    const user = await User.findOne({ where: { email } });
    
    if (!user) {
      return res.status(401).json({
        message: 'Credenciais inválidas'
      });
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
        return res.status(429).json({
          message: 'Muitas tentativas de login. Conta bloqueada por 1 hora.'
        });
      }
      
      return res.status(401).json({
        message: 'Credenciais inválidas'
      });
    }
    
    // Verificar se a conta está bloqueada
    const isBlocked = await redisClient.get(`user:${user.id}:blocked`);
    if (isBlocked) {
      return res.status(403).json({
        message: 'Conta temporariamente bloqueada. Tente novamente mais tarde.'
      });
    }
    
    // Limpar contagem de tentativas
    await redisClient.del(`login_attempts:${user.id}`);
    
    // Verificar 2FA se estiver ativado
    if (user.twoFactorEnabled) {
      // Gerar token temporário para validação 2FA
      const tempToken = jwt.sign({ id: user.id, require2FA: true }, JWT_SECRET, { expiresIn: '5m' });
      
      return res.status(200).json({
        message: 'Autenticação de dois fatores necessária',
        tempToken,
        require2FA: true
      });
    }
    
    // Atualizar status online
    await user.update({ status: 'online' });
    await redisClient.set(`user:${user.id}:status`, 'online');
    
    // Gerar tokens
    const { accessToken, refreshToken } = await generateTokens(user);
    
    return res.status(200).json({
      message: 'Login realizado com sucesso',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        status: user.status,
        bio: user.bio,
        isPremium: user.isPremium,
        level: user.level,
        xpPoints: user.xpPoints
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Erro no login:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao processar o login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verificação de código 2FA
exports.verify2FA = async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    
    // Verificar token temporário
    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        message: 'Token inválido ou expirado'
      });
    }
    
    // Verificar se o token exige 2FA
    if (!decoded.require2FA) {
      return res.status(400).json({
        message: 'Token inválido para verificação 2FA'
      });
    }
    
    // Buscar usuário
    const user = await User.findByPk(decoded.id);
    
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({
        message: 'Autenticação de dois fatores não está configurada para este usuário'
      });
    }
    
    // Verificar código 2FA
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code
    });
    
    if (!verified) {
      return res.status(401).json({
        message: 'Código de verificação inválido'
      });
    }
    
    // Atualizar status online
    await user.update({ status: 'online' });
    await redisClient.set(`user:${user.id}:status`, 'online');
    
    // Gerar tokens
    const { accessToken, refreshToken } = await generateTokens(user);
    
    return res.status(200).json({
      message: 'Autenticação de dois fatores bem-sucedida',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        status: user.status,
        bio: user.bio,
        isPremium: user.isPremium,
        level: user.level,
        xpPoints: user.xpPoints
      },
      accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Erro na verificação 2FA:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao processar a verificação 2FA',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Configurar 2FA
exports.setup2FA = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({
        message: 'Usuário não encontrado'
      });
    }
    
    // Gerar segredo 2FA
    const secret = speakeasy.generateSecret({
      name: `StreamChat:${user.email}`
    });
    
    // Gerar QR code
    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);
    
    // Armazenar temporariamente o segredo no Redis
    await redisClient.set(`2fa_temp:${user.id}`, secret.base32, 'EX', 600); // 10 minutos
    
    return res.status(200).json({
      message: 'Configuração 2FA iniciada',
      secret: secret.base32, // Isso será usado para confirmar a configuração
      qrCode: qrCodeUrl
    });
  } catch (error) {
    console.error('Erro na configuração 2FA:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao iniciar a configuração 2FA',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Confirmar configuração 2FA
exports.confirm2FA = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code } = req.body;
    
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({
        message: 'Usuário não encontrado'
      });
    }
    
    // Obter segredo temporário do Redis
    const secret = await redisClient.get(`2fa_temp:${user.id}`);
    
    if (!secret) {
      return res.status(400).json({
        message: 'Tempo expirado para configuração 2FA. Inicie novamente.'
      });
    }
    
    // Verificar código 2FA
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code
    });
    
    if (!verified) {
      return res.status(400).json({
        message: 'Código de verificação inválido'
      });
    }
    
    // Ativar 2FA para o usuário
    await user.update({
      twoFactorEnabled: true,
      twoFactorSecret: secret
    });
    
    // Limpar segredo temporário
    await redisClient.del(`2fa_temp:${user.id}`);
    
    return res.status(200).json({
      message: 'Autenticação de dois fatores configurada com sucesso'
    });
  } catch (error) {
    console.error('Erro na confirmação 2FA:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao confirmar a configuração 2FA',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Desativar 2FA
exports.disable2FA = async (req, res) => {
  try {
    const userId = req.user.id;
    const { code, password } = req.body;
    
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({
        message: 'Usuário não encontrado'
      });
    }
    
    // Verificar senha
    const isPasswordValid = await user.checkPassword(password);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        message: 'Senha incorreta'
      });
    }
    
    // Verificar código 2FA se estiver ativado
    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: code
      });
      
      if (!verified) {
        return res.status(401).json({
          message: 'Código de verificação inválido'
        });
      }
    } else {
      return res.status(400).json({
        message: 'Autenticação de dois fatores não está ativada'
      });
    }
    
    // Desativar 2FA
    await user.update({
      twoFactorEnabled: false,
      twoFactorSecret: null
    });
    
    return res.status(200).json({
      message: 'Autenticação de dois fatores desativada com sucesso'
    });
  } catch (error) {
    console.error('Erro ao desativar 2FA:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao desativar a autenticação de dois fatores',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Atualizar token de acesso com refresh token
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({
        message: 'Refresh token não fornecido'
      });
    }
    
    // Verificar blacklist de tokens revogados
    const isRevoked = await redisClient.get(`revoked_token:${refreshToken}`);
    
    if (isRevoked) {
      return res.status(401).json({
        message: 'Token revogado'
      });
    }
    
    // Verificar refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
    } catch (err) {
      return res.status(401).json({
        message: 'Refresh token inválido ou expirado'
      });
    }
    
    // Buscar usuário
    const user = await User.findByPk(decoded.id);
    
    if (!user) {
      return res.status(404).json({
        message: 'Usuário não encontrado'
      });
    }
    
    // Verificar se o refresh token é válido
    const isValidToken = user.refreshToken && await bcrypt.compare(refreshToken, user.refreshToken);
    
    if (!isValidToken) {
      return res.status(401).json({
        message: 'Refresh token inválido'
      });
    }
    
    // Gerar novo token de acesso
    const accessToken = jwt.sign(user.toJWTPayload(), JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN
    });
    
    return res.status(200).json({
      message: 'Token atualizado com sucesso',
      accessToken
    });
  } catch (error) {
    console.error('Erro ao atualizar token:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao atualizar o token',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Logout
exports.logout = async (req, res) => {
  try {
    const userId = req.user.id;
    const refreshToken = req.body.refreshToken;
    
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({
        message: 'Usuário não encontrado'
      });
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
    
    return res.status(200).json({
      message: 'Logout realizado com sucesso'
    });
  } catch (error) {
    console.error('Erro no logout:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao processar o logout',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Verificação de e-mail
exports.verifyEmail = async (req, res) => {
  try {
    const { userId, token } = req.body;
    
    // Buscar token de verificação no Redis
    const storedToken = await redisClient.get(`verification:${userId}`);
    
    if (!storedToken || storedToken !== token) {
      return res.status(400).json({
        message: 'Token de verificação inválido ou expirado'
      });
    }
    
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({
        message: 'Usuário não encontrado'
      });
    }
    
    // Atualizar status de verificação
    await user.update({
      isVerified: true
    });
    
    // Remover token de verificação
    await redisClient.del(`verification:${userId}`);
    
    return res.status(200).json({
      message: 'E-mail verificado com sucesso'
    });
  } catch (error) {
    console.error('Erro na verificação de e-mail:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao verificar o e-mail',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Solicitar redefinição de senha
exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    
    // Buscar usuário
    const user = await User.findOne({ where: { email } });
    
    if (!user) {
      // Por segurança, não informamos se o e-mail existe ou não
      return res.status(200).json({
        message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha'
      });
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
    
    return res.status(200).json({
      message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha'
    });
  } catch (error) {
    console.error('Erro ao solicitar redefinição de senha:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao processar a solicitação',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Redefinir senha
exports.resetPassword = async (req, res) => {
  try {
    const { userId, token, newPassword } = req.body;
    
    // Buscar token de redefinição no Redis
    const storedToken = await redisClient.get(`password_reset:${userId}`);
    
    if (!storedToken || storedToken !== token) {
      return res.status(400).json({
        message: 'Token de redefinição inválido ou expirado'
      });
    }
    
    // Buscar usuário
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({
        message: 'Usuário não encontrado'
      });
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
    
    return res.status(200).json({
      message: 'Senha redefinida com sucesso'
    });
  } catch (error) {
    console.error('Erro na redefinição de senha:', error);
    return res.status(500).json({
      message: 'Ocorreu um erro ao redefinir a senha',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Autenticação com OAuth (Google)
exports.googleAuth = async (req, res) => {
  // Implementado com Passport.js
  // Esta função será chamada pelo callback do Passport
  try {
    const user = req.user;
    
    // Gerar tokens
    const { accessToken, refreshToken } = await generateTokens(user);
    
    // Redirecionar para o frontend com os tokens
    return res.redirect(`${process.env.FRONTEND_URL}/oauth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`);
  } catch (error) {
    console.error('Erro na autenticação Google:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/oauth/error`);
  }
};
