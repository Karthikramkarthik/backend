const express = require('express');
const router = express.Router();
const bannerController = require('../controllers/bannerController');

// Public active banners list
router.get('/', bannerController.listActive);

module.exports = router;
