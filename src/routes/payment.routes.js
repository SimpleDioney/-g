const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// Rotas públicas (webhooks)
router.post('/webhook/stripe', express.raw({ type: 'application/json' }), paymentController.stripeWebhook);
router.post('/webhook/mercadopago', paymentController.mercadoPagoWebhook);

// Rotas que necessitam autenticação
router.use(authenticate);

// Produtos e checkout
router.get('/products', paymentController.getProducts);
router.post('/checkout/stripe', paymentController.createStripeCheckout);
router.post('/checkout/mercadopago', paymentController.createMercadoPagoCheckout);

// Gerenciamento de tokens e transações
router.get('/balance', paymentController.getTokenBalance);
router.get('/transactions', paymentController.getTransactionHistory);
router.get('/transactions/:id', paymentController.getTransactionDetails);
router.post('/gift', paymentController.sendGift);
router.post('/superchat', paymentController.sendSuperChat);
router.post('/subscription/cancel', paymentController.cancelSubscription);

module.exports = router;