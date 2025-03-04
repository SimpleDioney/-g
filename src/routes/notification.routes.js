const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const streakController = require('../controllers/streak.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// Todas as rotas requerem autenticação
router.use(authenticate);

// Rotas de notificações
router.get('/', notificationController.getNotifications);
router.get('/unread', notificationController.getUnreadCount);
router.patch('/:id/read', notificationController.markAsRead);
router.delete('/:id', notificationController.deleteNotification);
router.get('/preferences', notificationController.getPreferences);
router.put('/preferences', notificationController.updatePreferences);

// Rotas de streak e engajamento
router.get('/streak', streakController.checkStreak);
router.get('/streak/leaderboard', streakController.getStreakLeaderboard);

module.exports = router;