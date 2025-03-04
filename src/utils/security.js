const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { JWT_SECRET, JWT_EXPIRES_IN, REFRESH_TOKEN_SECRET, REFRESH_TOKEN_EXPIRES_IN } = require('../config/jwt');

/**
 * Gera um hash para a senha utilizando bcrypt
 * @param {string} password - Senha em texto plano
 * @returns {Promise<string>} Hash da senha
 */
const hashPassword = async (password) => {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
};

/**
 * Verifica se a senha corresponde ao hash
 * @param {string} password - Senha em texto plano
 * @param {string} hash - Hash da senha
 * @returns {Promise<boolean>} Resultado da verificação
 */
const comparePassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

/**
 * Gera um token JWT para autenticação
 * @param {Object} payload - Dados a serem armazenados no token
 * @returns {string} Token JWT
 */
const generateJWT = (payload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
};

/**
 * Gera um token de atualização (refresh token)
 * @param {Object} payload - Dados a serem armazenados no token
 * @returns {string} Refresh token
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN
  });
};

/**
 * Verifica e decodifica um token JWT
 * @param {string} token - Token JWT
 * @returns {Object|null} Payload decodificado ou null se inválido
 */
const verifyJWT = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

/**
 * Verifica e decodifica um refresh token
 * @param {string} token - Refresh token
 * @returns {Object|null} Payload decodificado ou null se inválido
 */
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, REFRESH_TOKEN_SECRET);
  } catch (error) {
    return null;
  }
};

/**
 * Gera uma string aleatória para uso como token ou chave
 * @param {number} length - Tamanho do token
 * @returns {string} Token aleatório
 */
const generateRandomToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Gera um código de convite para servidores
 * @returns {string} Código de convite
 */
const generateInviteCode = () => {
  return crypto.randomBytes(4).toString('hex');
};

/**
 * Verificação básica de segurança para conteúdo
 * @param {string} content - Conteúdo a ser verificado
 * @returns {Object} Resultado da verificação
 */
const securityCheck = (content) => {
  // Lista de padrões potencialmente perigosos
  const patterns = {
    sql: /(\b(select|insert|update|delete|from|where|drop|alter|create|table|database)\b.*\b(from|into|table|database|values)\b)|(-{2,}|\/\*|\*\/)/i,
    javascript: /(<script>|<\/script>|javascript:|on\w+\s*=)/i,
    html: /(<\s*iframe|<\s*object|<\s*embed|<\s*applet)/i,
    externalLinks: /(https?:\/\/|www\.)/i,
    sensitiveData: /(\b\d{3}-\d{2}-\d{4}\b|(\b\d{13,16}\b))/i
  };
  
  const results = {};
  let hasSuspiciousContent = false;
  
  // Verificar cada padrão
  for (const [type, pattern] of Object.entries(patterns)) {
    if (pattern.test(content)) {
      results[type] = true;
      hasSuspiciousContent = true;
    } else {
      results[type] = false;
    }
  }
  
  return {
    hasSuspiciousContent,
    details: results
  };
};

module.exports = {
  hashPassword,
  comparePassword,
  generateJWT,
  generateRefreshToken,
  verifyJWT,
  verifyRefreshToken,
  generateRandomToken,
  generateInviteCode,
  securityCheck
};