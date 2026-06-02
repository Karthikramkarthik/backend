const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized: No authorization token provided' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Format must be Bearer <token>' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'stock_management_jwt_secret_key_2026');
    req.user = decoded; // Attach user info (id, username, email) to request
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
  }
};
