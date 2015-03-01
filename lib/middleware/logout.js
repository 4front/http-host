var _ = require('lodash');
var debug = require('debug')('4front:logout');

// Simple middleware that logs the user out by destroying any session cookie
// and redirecting to the index page.
module.exports = function(options) {
  options = _.defaults(options || {}, {
    sessionCookieName: 'sid'
  });

  return function(req, res, next) {
    debug('logging out');
    if (req.session)
      req.session.destroy();

    var cookie;
    if (_.isFunction(options.sessionCookieName))
      cookie = options.sessionCookieName(req);
    else
      cookie = options.sessionCookieName;

    res.clearCookie(cookie);

    res.redirect('/?_logout=1');
  };
};