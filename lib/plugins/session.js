// Just a lightweight wrapper around the express-sessions module.
var session = require("express-session");

// Global singleton
var globalSessionMiddleware;

module.exports = function(options) {
  return function(req, res, next) {
    // Defer creating the global session middleware until the first
    // request since we need to read the sessionStore and sessionSecret
    // from req.app.settings.
    if (!globalSessionMiddleware) {
      globalSessionMiddleware = require("express-session")({
        store: req.app.settings.sessionStore,
        secret: req.app.settings.sessionSecret,
        saveUninitialized: true,
        resave: false,
        name: '4front.sessionid'
      });
    }

    // Now override the cookie
    globalSessionMiddleware(req, res, function() {
      if (options.timeoutMinutes && !req.session.cookie.originalMaxAge)
        req.session.cookie.maxAge(options.timeoutMinutes * 60000);

      next();
    });
  };
}
