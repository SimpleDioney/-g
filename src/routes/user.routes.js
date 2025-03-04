const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// Rotas que requerem autenticação
router.use(authenticate);

// Perfil do usuário atual
router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.post('/avatar', userController.upload.single('avatar'), userController.uploadAvatar);
router.put('/password', userController.changePassword);

// Servidores e atividade
router.get('/servers', userController.getUserServers);
router.get('/activity', userController.getUserActivity);

// Buscar usuários
router.get('/search', userController.searchUsers);

// Perfil público e vídeos de usuário
router.get('/:id', userController.getPublicProfile);
router.get('/:id/videos', userController.getUserVideos);

module.exports = router;