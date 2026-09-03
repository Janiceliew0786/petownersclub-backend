// Use AFTER verifyToken in a route's middleware chain — relies on
// req.user.role already being set from the JWT payload.
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'Admin') {
    return res.status(403).json({ message: 'Admin access required.' });
  }
  next();
}

module.exports = requireAdmin;
