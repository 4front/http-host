var _ = require('lodash');
var debug = require('debug')('4front:logout');

// Simple middleware that logs the user out by destroying any session cookie
// and redirecting to the index page.
module.exports = function(options) {
  options = _.defaults(options || {}, {
    sessionCookieName: 'sid',
    redirectUrl: '/'
  });

  return function(req, res, next) {
    debug('logging out');
    if (req.session)
      req.session.destroy();

    res.clearCookie(options.sessionCookieName);
    res.redirect(options.redirectUrl);
  };
};
