const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class UserServer extends Model {}

UserServer.init({
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    },
    primaryKey: true
  },
  serverId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'servers',
      key: 'id'
    },
    primaryKey: true
  },
  role: {
    type: DataTypes.ENUM('member', 'moderator', 'admin', 'owner'),
    defaultValue: 'member'
  },
  nickname: {
    type: DataTypes.STRING,
    allowNull: true
  },
  joinedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  sequelize,
  modelName: 'UserServer',
  tableName: 'user_servers'
});

module.exports = UserServer;