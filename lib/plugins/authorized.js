var _ = require('lodash');
var pathToRegexp = require('path-to-regexp');
var debug = require('debug')('4front:addons:authorized');

require('simple-errors');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    loginUrl: undefined,
    loginPage: undefined,
    routes: [],
    returnUrlCookie: 'returnUrl'
  });

  return function(req, res, next) {
    // Find the first authorization route that matches the current request path
    var routeRule = _.find(options.routes, function(routeConfig) {
      var routeRegexp = pathToRegexp(routeConfig.path);
      return routeRegexp.test(req.path);
    });

    // If there are no matching route paths for this request, let the user through.
    if (!routeRule) {
      debug("path %s not a match for any authorized routes, let the user through", req.path);

      // Even if authorization is not required for this route but we still have a
      // valid user, then tack it onto the request.
      if (_.isObject(req.session.user))
        appendUserToRequest(req);

      return next();
    }

    if (_.isObject(req.session) === false)
      return next(Error.http(510, "The express-session module must be declared prior to the authorized plugin"));

    // If we've made it this far, req.session.user must be defined at a minimum.
    if (_.isObject(req.session.user) === false) {
      debug("no req.session.user");
      return missingUser(req, res, next);
    }

    debug("found matching route %s", routeRule.path);

    // If there are ACLs defined, then being logged in is sufficient authorization.
    if (_.isObject(routeRule.allowed) === true) {
      if (isAllowed(routeRule.allowed, 'groups', req.session.user) === false) {
        debug("user not member of any allowed groups");

        maybeDestroySession(req);

        return next(Error.http(403, "User is not a member of any allowed groups", {
          code: "authFailedNotMemberOfAllowedGroup"
        }));
      }
      else if (isAllowed(routeRule.allowed, 'roles', req.session.user) === false) {
        debug("user does not have any allowed roles");
        maybeDestroySession(req);

        return next(Error.http(403, "User does not have any allowed roles", {
          code: "authFailedDoesNotHaveRequiredRole"
        }));
      }
    }

    // Store the user on the extended request without the groups and roles because
    // we don't want to expose that to the browser via the webpage plugin.
    appendUserToRequest(req);

    next();
  };

  function maybeDestroySession(req) {
    // Special case for the dev environment. If we destroy the session cookie
    // it prevents the rendering of a custom 403 error page because by the time
    // we redirect back to the unauthorized URL, the user will be gone and instead
    // of showing the custom error page it will have already redirected to
    // the login page before execution reaches this point.
    if (req.ext.virtualEnv !== 'dev')
      req.session.destroy();
  }

  function appendUserToRequest(req) {
    // Store the user on the extended request without the groups and roles because
    // we don't want to expose that to the browser via the webpage plugin.
    req.ext.user = _.omit(req.session.user, 'groups', 'roles', 'basicAuthToken');
  }

  function missingUser(req, res, next) {
    req.session.destroy();

    if (_.isString(options.loginUrl)) {
      // Set a cookie with the intended URL so that it can be used to go directly there
      // upon authenticating.
      res.cookie(options.returnUrlCookie, req.originalUrl, {httpOnly: true});
      debug("redirect to the login url %s", options.loginUrl);
      return res.redirect(options.loginUrl);
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
