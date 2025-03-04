const User = require('./User');
const Server = require('./Server');
const Channel = require('./Channel');
const Message = require('./Message');
const Video = require('./Video');
const UserServer = require('./UserServer');
const VideoComment = require('./VideoComment');
const Transaction = require('./Transaction');
const Notification = require('./Notification');

// Definir relacionamentos

// User <-> Server (N:M)
User.belongsToMany(Server, { through: UserServer, foreignKey: 'userId' });
Server.belongsToMany(User, { through: UserServer, foreignKey: 'serverId' });

// Server -> User (Owner)
Server.belongsTo(User, { as: 'owner', foreignKey: 'ownerId' });
User.hasMany(Server, { as: 'ownedServers', foreignKey: 'ownerId' });

// Server -> Channel (1:N)
Server.hasMany(Channel, { foreignKey: 'serverId' });
Channel.belongsTo(Server, { foreignKey: 'serverId' });

// Channel -> Message (1:N)
Channel.hasMany(Message, { foreignKey: 'channelId' });
Message.belongsTo(Channel, { foreignKey: 'channelId' });

// User -> Message (1:N)
User.hasMany(Message, { foreignKey: 'userId' });
Message.belongsTo(User, { foreignKey: 'userId' });

// Message -> Message (Reply)
Message.belongsTo(Message, { as: 'replyTo', foreignKey: 'replyToId' });
Message.hasMany(Message, { as: 'replies', foreignKey: 'replyToId' });

// User -> Video (1:N)
User.hasMany(Video, { foreignKey: 'userId' });
Video.belongsTo(User, { foreignKey: 'userId' });

// Video -> VideoComment (1:N)
Video.hasMany(VideoComment, { foreignKey: 'videoId' });
VideoComment.belongsTo(Video, { foreignKey: 'videoId' });

// User -> VideoComment (1:N)
User.hasMany(VideoComment, { foreignKey: 'userId' });
VideoComment.belongsTo(User, { foreignKey: 'userId' });

// VideoComment -> VideoComment (Reply)
VideoComment.belongsTo(VideoComment, { as: 'parent', foreignKey: 'parentId' });
VideoComment.hasMany(VideoComment, { as: 'replies', foreignKey: 'parentId' });

// User -> Transaction (1:N)
User.hasMany(Transaction, { foreignKey: 'userId' });
Transaction.belongsTo(User, { foreignKey: 'userId' });

// User -> Notification (1:N)
User.hasMany(Notification, { foreignKey: 'userId' });
Notification.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  User,
  Server,
  Channel,
  Message,
  Video,
  UserServer,
  VideoComment,
  Transaction,
  Notification
};