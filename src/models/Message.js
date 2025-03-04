const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Message extends Model {}

Message.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  channelId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'channels',
      key: 'id'
    }
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM('text', 'image', 'video', 'audio', 'file', 'gif', 'system'),
    defaultValue: 'text'
  },
  attachments: {
    type: DataTypes.JSON,
    allowNull: true
  },
  reactions: {
    type: DataTypes.JSON,
    defaultValue: {}
  },
  mentions: {
    type: DataTypes.JSON,
    allowNull: true
  },
  replyToId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'messages',
      key: 'id'
    }
  },
  isEdited: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  isPinned: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  scheduledFor: {
    type: DataTypes.DATE,
    allowNull: true
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
  modelName: 'Message',
  tableName: 'messages',
  indexes: [
    {
      fields: ['channelId', 'createdAt']
    },
    {
      fields: ['userId', 'createdAt']
    }
  ]
});

module.exports = Message;
