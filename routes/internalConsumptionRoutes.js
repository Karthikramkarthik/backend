const express = require('express');
const router = express.Router();
const internalConsumptionController = require('../controllers/internalConsumptionController');
const authMiddleware = require('../middleware/auth');

// Helper middleware to restrict access to Owner or Admin only
const isAdminOrOwner = (req, res, next) => {
  if (req.user && (req.user.role === 'Owner' || req.user.role === 'Admin')) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: Owner or Admin access only' });
};

router.post('/', authMiddleware, isAdminOrOwner, internalConsumptionController.create);
router.get('/', authMiddleware, isAdminOrOwner, internalConsumptionController.list);
router.delete('/:id', authMiddleware, isAdminOrOwner, internalConsumptionController.delete);

module.exports = router;
