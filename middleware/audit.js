/**
 * Audit information middleware helper.
 * Strips audit attributes (created_by_user_id, created_by_name, created_by_role, created_at)
 * from response data if the requesting user is not an Admin or Owner.
 */
function cleanAuditInfo(req, items) {
  const user = req.user;
  const isAuthorized = user && (user.role === 'Owner' || user.role === 'Admin');

  const sanitize = (item) => {
    if (!item) return item;
    if (!isAuthorized) {
      const { created_by_user_id, created_by_name, created_by_role, created_at, ...cleaned } = item;
      return cleaned;
    }
    return item;
  };

  if (Array.isArray(items)) {
    return items.map(sanitize);
  }
  return sanitize(items);
}

module.exports = { cleanAuditInfo };
