const express = require('express');
const router = express.Router();
const serverController = require('../controllers/server.controller');
const channelController = require('../controllers/channel.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { checkBan } = require('../controllers/admin.controller');

// Todas as rotas requerem autenticação
router.use(authenticate);

// Rotas de servidores
router.get('/', serverController.getUserServers);
router.post('/', serverController.createServer);
router.get('/:id', checkBan, serverController.getServer);
router.put('/:id', checkBan, serverController.updateServer);
router.delete('/:id', serverController.deleteServer);
router.post('/:id/icon', checkBan, serverController.upload.single('icon'), serverController.uploadIcon);
router.post('/:id/invite', checkBan, serverController.generateInvite);
router.post('/join', serverController.joinServer);
router.post('/:id/leave', serverController.leaveServer);

// Rotas de canais
router.post('/:serverId/channels', checkBan, serverController.createChannel);
router.get('/:serverId/channels', checkBan, channelController.getServerChannels);
router.put('/:serverId/channels/:channelId', checkBan, channelController.updateChannel);
router.delete('/:serverId/channels/:channelId', checkBan, channelController.deleteChannel);
router.put('/:serverId/channels/:channelId/position', checkBan, channelController.updateChannelPosition);

module.exports = router;