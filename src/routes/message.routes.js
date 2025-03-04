const express = require('express');
const router = express.Router();
const messageController = require('../controllers/message.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { checkUserMute, contentFilter } = require('../controllers/admin.controller');

// Todas as rotas requerem autenticação
router.use(authenticate);

// Rotas de mensagens
router.post('/', [checkUserMute, contentFilter], messageController.sendMessage);
router.put('/:id', contentFilter, messageController.editMessage);
router.delete('/:id', messageController.deleteMessage);
router.post('/:id/reaction', messageController.addReaction);
router.post('/:id/pin', messageController.pinMessage);
router.get('/channel/:channelId/pinned', messageController.getPinnedMessages);
router.get('/channel/:channelId/search', messageController.searchMessages);
router.post('/channel/:channelId/schedule', [contentFilter], messageController.scheduleMessage);
router.post('/:id/expiry', messageController.setMessageExpiry);
router.post('/channel/:channelId/poll', [contentFilter], messageController.createPoll);
router.post('/poll/:id/vote', messageController.votePoll);

module.exports = router;