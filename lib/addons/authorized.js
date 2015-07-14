var _ = require('lodash');
var debug = require('debug')('4front:addons:authorized');

require('simple-errors');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    loginUrlRedirect: undefined,
    loginPage: undefined,
    allowed: {
      groups: undefined,
      roles: undefined
    },
    returnUrlCookie: 'returnUrl'
  });

  return function(req, res, next) {
    var errorMessage, errorCode;

    // The req.ext.user must be defined.
    if (_.isObject(req.ext.user) === false) {
      debug("no req.ext.user");
      errorMessage = "No user defined";
      errorCode = "cannotAuthorizeMissingUser";
    }
    else if (isAllowed('groups', req.ext.user) === false) {
      debug("user not member of any allowed groups");
      errorMessage = "User is not a member of any allowed groups";
      errorCode = "authFailedNotMemberOfAllowedGroup";
    }
    else if (isAllowed('roles', req.ext.user) === false) {
      // Kill their session
      debug("user does not have any allowed roles");
      errorMessage = "User is not a member of any allowed roles";
      errorCode = "authFailedDoesNotHaveRequiredRole";
    }
    else {
      // If not authorization checks failed, then
      // skip ahead to the next middleware.
      debug("authorization successful");
      return next();
    }

    // If there is a session, destroy it.
    if (req.session) {
      req.session.destroy();
    }

    // Differentiate between a missing user (like from a timed out session),
    // vs. a user lacking the appropriate roles or group membership.
    if (errorCode === "cannotAuthorizeMissingUser") {
      if (options.loginUrl) {
        // Set a cookie with the intended URL so that it can be used to go directly there
        // upon authenticating.
        res.cookie(options.returnUrlCookie, req.originalUrl, {httpOnly: true});
        debug("redirect to the login url %s", options.loginUrl);
        return res.redirect(options.loginUrl);
      }
      else if (options.loginPage) {
        // If there is a loginPage and the pathname is still the root render it as part of this
        // http request without redirecting to a different URL.
        // This is useful for single page apps where everything
        // is served off the base path '/'.
        if (req.path === '/') {
          debug("setting webPagePath to %s", options.loginPage);
          req.ext.webPagePath = options.loginPage;
          return next();
        }
        else {
          res.cookie(options.returnUrlCookie, req.originalUrl, {httpOnly: true});
          return res.redirect("/");
        }
      }
      else {
        return next(Error.http(401, errorMessage, {code: errorCode}));
      }
    }
    else
      return next(Error.http(403, errorMessage, {code: errorCode}))
  };

  function isAllowed(type, user) {
    debugger;
    var allowedList = options.allowed[type];
    if (_.isArray(allowedList) === false)
      return true;

    var userList = user[type];

    if (_.isArray(userList) === false)
      return false;

    return _.intersection(allowedList, userList).length > 0;
  }
};
