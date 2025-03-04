const express = require('express');
const router = express.Router();
const channelController = require('../controllers/channel.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { checkUserMute, contentFilter } = require('../controllers/admin.controller');

// Todas as rotas requerem autenticação
router.use(authenticate);

// Rotas de canais
router.get('/:id/messages', channelController.getChannelMessages);
router.post('/:channelId/messages', [checkUserMute, contentFilter], channelController.sendMessage);

module.exports = router;