var _ = require('lodash');
var debug = require('debug')('4front:logout');

// Simple middleware that logs the user out by destroying any session cookie
// and redirecting to the index page.
module.exports = function(options) {
  options = _.defaults(options || {}, {
    redirectUrl: '/'
  });

  return function(req, res, next) {
    debug('logging out');
    if (req.session)
      req.session.destroy();

    res.clearCookie("4front.sessionid");
    res.redirect(options.redirectUrl);
  };
};
