// TODO: Implement database.jsconst { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');

// Caminho para o banco de dados SQLite
const dbPath = path.join(__dirname, '../../database.sqlite');

// Instância do Sequelize
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false,
  pool: {
    max: 15,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// Função para inicializar o banco de dados
async function initDatabase() {
  try {
    // Testar conexão
    await sequelize.authenticate();
    
    // Importar modelos dinamicamente
    const modelsDir = path.join(__dirname, '../models');
    fs.readdirSync(modelsDir)
      .filter(file => file.endsWith('.js'))
      .forEach(file => {
        require(path.join(modelsDir, file));
      });
    
    // Sincronizar modelos com o banco de dados
    // Em produção, utilize migrações ao invés de sync
    await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
    
    return sequelize;
  } catch (error) {
    console.error('❌ Erro ao conectar com o banco de dados:', error);
    throw error;
  }
}

module.exports = {
  sequelize,
  initDatabase
};