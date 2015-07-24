// Lightweight wrapper around a singleton instance of express-sessions. We can't
// use express-session directly in the virtual router as it will cause a memory
// leak by registering a listener with the sessionStore every time it is created.
var expressSession = require("express-session");
var debug = require('debug')('4front:apphost:plugins:session');
var uid = require('uid-safe').sync;
var _ = require('lodash');

module.exports = function(options) {
  return function(req, res, next) {
    // Defer creating the global session middleware until the first
    // request since we need to read the sessionStore and sessionSecret
    // from req.app.settings.
    if (!req.app._sessionPlugin) {
      debug("creating singleton express-session instance");

      req.app._sessionPlugin = expressSession({
        store: req.app.settings.sessionStore,
        secret: req.app.settings.sessionSecret,
        saveUninitialized: true,
        resave: false,
        name: '4front.sessionid',
        genid: generateSessionId
      });

      // Override the generate function our own implementation
      // that sets the req.session object. Make sure we use the _req
      // passed to this function rather than req. Seems like these should
      // be the same object references, but observed some strange
      // behavior without this.
      req.app.settings.sessionStore.generate = function(_req) {
        debug("generate session override");
        generateSession(_req, options);
      };
    }

    req.app._sessionPlugin(req, res, next);
  };
};

function generateSession(req, options) {
  // Define our own session cookie
  var sessionCookie = {
    httpOnly: true,
    path: '/'
  };

  if (_.isNumber(options.timeoutMinutes))
    sessionCookie.maxAge = options.timeoutMinutes * 60000;

  if (req.ext.virtualApp.requireSsl === true)
    sessionCookie.secure = true;

  debug("creating custom session cookie");
  req.sessionID = generateSessionId(req);
  req.session = new expressSession.Session(req);
  req.session.cookie = new expressSession.Cookie(sessionCookie);
}

function generateSessionId() {
  return uid(24);
}
