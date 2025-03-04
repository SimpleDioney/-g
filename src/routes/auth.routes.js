const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const passport = require('passport');

// Rotas públicas
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/verify2fa', authController.verify2FA);
router.post('/refresh-token', authController.refreshToken);
router.post('/verify-email', authController.verifyEmail);
router.post('/request-password-reset', authController.requestPasswordReset);
router.post('/reset-password', authController.resetPassword);

// OAuth
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', passport.authenticate('google', { session: false }), authController.googleAuth);

// OAuth - outros provedores
router.get('/discord', passport.authenticate('discord', { scope: ['identify', 'email'] }));
router.get('/discord/callback', passport.authenticate('discord', { session: false }), authController.googleAuth);

router.get('/facebook', passport.authenticate('facebook', { scope: ['email'] }));
router.get('/facebook/callback', passport.authenticate('facebook', { session: false }), authController.googleAuth);

router.get('/twitter', passport.authenticate('twitter'));
router.get('/twitter/callback', passport.authenticate('twitter', { session: false }), authController.googleAuth);

// Rotas protegidas
router.post('/logout', authenticate, authController.logout);
router.post('/setup2fa', authenticate, authController.setup2FA);
router.post('/confirm2fa', authenticate, authController.confirm2FA);
router.post('/disable2fa', authenticate, authController.disable2FA);

module.exports = router;