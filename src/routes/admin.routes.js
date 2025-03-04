const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');

// Todas as rotas requerem autenticação
router.use(authenticate);

// Rotas de administração global (apenas admins do sistema)
router.get('/forbidden-words', authorize('admin'), adminController.getForbiddenWords);
router.put('/forbidden-words', authorize('admin'), adminController.updateForbiddenWords);

// Rotas de moderação de servidor
router.get('/servers/:serverId/moderation', adminController.getServerModeration);
router.put('/servers/:serverId/moderation', adminController.updateServerModeration);
router.get('/servers/:serverId/logs', adminController.getServerModLogs);

// Gerenciamento de usuários
router.post('/servers/:serverId/ban/:userId', adminController.banUser);
router.delete('/servers/:serverId/ban/:userId', adminController.unbanUser);
router.get('/servers/:serverId/bans', adminController.getBannedUsers);

// Silenciamentos
router.post('/servers/:serverId/channels/:channelId/mute/:userId', adminController.muteUser);
router.delete('/servers/:serverId/channels/:channelId/mute/:userId', adminController.unmuteUser);

// Gerenciamento de cargos
router.put('/servers/:serverId/users/:userId/role', adminController.updateUserRole);

// Exportar middlewares para uso em outras rotas
module.exports = {
  router,
  contentFilter: adminController.contentFilter,
  checkUserMute: adminController.checkUserMute,
  checkBan: adminController.checkBan
};