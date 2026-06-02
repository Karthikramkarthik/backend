const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');

// Public endpoints
router.post('/', reviewController.create);
router.get('/product/:id', reviewController.getProductReviews);

module.exports = router;
