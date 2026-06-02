const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const authMiddleware = require('../middleware/auth');

// Guard all administrative review endpoints with JWT
router.use(authMiddleware);

router.get('/', reviewController.listAll);
router.put('/:id/status', reviewController.updateStatus);

module.exports = router;
