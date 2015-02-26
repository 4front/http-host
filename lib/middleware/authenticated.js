var _ = require('lodash');
var debug = require('debug')('4front:authenticated');

// Checks the session for a user object and sets the req.ext.isAuthenticated flag
module.exports = function(options) {
  options = _.defaults(options || {}, {
    sessionUserKey: 'user'
  });

  return function(req, res, next) {
    debug('executing');

    if (!req.session || !_.isObject(req.session[options.sessionUserKey]))
      req.ext.isAuthenticated = false;
    else {
      req.user = req.session.user;
      req.ext.isAuthenticated = true;
    }

    next();
  };
};