const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

router.get('/', salesController.list);
router.get('/price-audits', salesController.priceAudits);
router.get('/:id', salesController.get);
router.post('/', salesController.create);
router.delete('/:id', salesController.delete);
router.put('/:id/status', salesController.updateStatus);

module.exports = router;
