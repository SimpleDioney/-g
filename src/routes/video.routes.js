const express = require('express');
const router = express.Router();
const videoController = require('../controllers/video.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');

// Rotas públicas
router.get('/feed', videoController.getVideoFeed);
router.get('/trending', videoController.getTrendingVideos);
router.get('/search', videoController.searchVideos);
router.get('/:id', videoController.getVideo);
router.get('/:id/comments', videoController.getComments);

// Rotas protegidas
router.post('/upload', authenticate, videoController.uploadMiddleware, videoController.uploadVideo);
router.put('/:id', authenticate, videoController.updateVideo);
router.delete('/:id', authenticate, videoController.deleteVideo);
router.post('/:id/like', authenticate, videoController.likeVideo);
router.get('/:id/like-status', authenticate, videoController.checkLikeStatus);
router.post('/:id/comments', authenticate, videoController.addComment);
router.delete('/comments/:commentId', authenticate, videoController.deleteComment);
router.post('/:id/share', authenticate, videoController.shareVideo);

module.exports = router;