const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Channel extends Model {}

Channel.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      len: [1, 100]
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  type: {
    type: DataTypes.ENUM('text', 'voice', 'video', 'announcement'),
    defaultValue: 'text'
  },
  serverId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'servers',
      key: 'id'
    }
  },
  position: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  isPrivate: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  slowMode: {
    type: DataTypes.INTEGER,
    defaultValue: 0, // Tempo em segundos
    validate: {
      min: 0
    }
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updatedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  sequelize,
  modelName: 'Channel',
  tableName: 'channels'
});

module.exports = Channel;