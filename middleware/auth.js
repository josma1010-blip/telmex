function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  return res.redirect('/admin/login');
}

module.exports = { requireAdmin };
