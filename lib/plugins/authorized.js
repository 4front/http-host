var _ = require('lodash');
var pathToRegexp = require('path-to-regexp');
var debug = require('debug')('4front:addons:authorized');

require('simple-errors');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    loginUrlRedirect: undefined,
    loginPage: undefined,
    routes: [],
    returnUrlCookie: 'returnUrl'
  });

  return function(req, res, next) {
    if (_.isObject(req.session) === false)
      return next(Error.http(510, "The express-session module must be declared prior to the authorized plugin"));

    var errorMessage, errorCode;

    // The req.session.user must be defined.
    if (_.isObject(req.session.user) === false) {
      debug("no req.session.user");
      return missingUser(req, res, next);
    }

    // Find the first authorization route that matches the current request path
    var routeRule = _.find(options.routes, function(routeConfig) {
      var routeRegexp = pathToRegexp(routeConfig.path);
      return routeRegexp.test(req.path);
    });

    // If there are no matching route paths for this request, let the user through.
    if (!routeRule || _.isObject(routeRule.allowed) === false) {
      debug("%s not a match for any authorized routes")
      return next();
    }

    debug("found matching route %s", routeRule.path);

    if (isAllowed(routeRule.allowed, 'groups', req.session.user) === false) {
      debug("user not member of any allowed groups");
      req.session.destroy();
      return next(Error.http(403, "User is not a member of any allowed groups", {
        code: "authFailedNotMemberOfAllowedGroup"
      }));
    }
    else if (isAllowed(routeRule.allowed, 'roles', req.session.user) === false) {
      // Kill their session
      debug("user does not have any allowed roles");
      req.session.destroy();

      return next(Error.http(403, "User does not have any allowed roles", {
        code: "authFailedDoesNotHaveRequiredRole"
      }));
    }

    next();
  };

  function missingUser(req, res, next) {
    req.session.destroy();

    if (_.isString(options.loginUrlRedirect)) {
      // Set a cookie with the intended URL so that it can be used to go directly there
      // upon authenticating.
      res.cookie(options.returnUrlCookie, req.originalUrl, {httpOnly: true});
      debug("redirect to the login url %s", options.loginUrlRedirect);
      return res.redirect(options.loginUrlRedirect);
    }
    else if (_.isString(options.loginPage)) {
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
      return next(Error.http(401, "User is not logged in", {code: "noLoggedInUser"}));
    }
  }

  function isAllowed(allowed, type, user) {
    var allowedList = allowed[type];
    if (_.isArray(allowedList) === false)
      return true;

    var userList = user[type];

    if (_.isArray(userList) === false)
      return false;

    return _.intersection(allowedList, userList).length > 0;
  }
};
