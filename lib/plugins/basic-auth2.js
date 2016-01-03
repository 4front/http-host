var auth = require('basic-auth');
var fs = require('fs');
var async = require('async');
var path = require('path');
var _ = require('lodash');
var urljoin = require('url-join');
var uglify = require('uglify-js');
var debug = require('debug')('4front:http-host:basic-auth');
require('simple-errors');

var _loginFormScriptEmbed;

module.exports = function(options) {
  var pipeResponse = require('../middleware/pipe-response')(options);

  _.defaults(options, {
    maxFailedLogins: 10
  });

  return function(req, res, next) {
    // Bypass basic-auth when using a custom login page and the request is for a static asset.
    // TODO: need to enforce canonical URLs for this to work otherwise user can just tack on
    // the .html extension and bypass the auth check.
    if (path.extname(req.path).length > 0) {
      return next();
    }

    var credentials = auth(req);

    // Cache key to keep track of the number of failed login
    // attempts for this IP address.
    var loginCacheKey = 'basic-auth-fails-' + req.ext.virtualApp.appId + '-' + req.ip;

    // If there were no credentials on the request, prompt the user for them.
    if (!credentials) {
      debug('no credentials sent');
      return req.app.settings.cache.get(loginCacheKey, function(err, attempts) {
        if (attempts !== null && parseInt(attempts, 10) > options.maxFailedLogins) {
          tooManyFailedLogins(next);
        } else {
          promptForCredentials(req, res, next);
        }
      });
    }

    var validCredentials = (credentials.name === options.username &&
      credentials.pass === options.password);

    // If the credentials are valid, skip ahead.
    if (validCredentials) {
      debug('credentials valid');

      // Clear out the failed logins counter
      req.app.settings.cache.del(loginCacheKey);

      return next();
    }

    // Load the number of login failures for this IP address.
    req.app.settings.cache.incr(loginCacheKey, function(err, loginFailures) {
      if (err) return next(err);

      debug('invalid credentials, attempt %s', loginFailures);

      // If the incremented value is 1 it must have been the first failed
      // login in this period so set the expiration of the key.
      if (loginFailures === 1) {
        req.app.settings.cache.expire(loginCacheKey, options.failedLoginPeriod);
      }

      // If too many failed login atttempts, return a 401 error.
      if (loginFailures > options.maxFailedLogins) {
        return tooManyFailedLogins(next);
      }

      // must be an ajax request from custom login form
      if (req.xhr) {
        debug('xhr request with wrong credentials');
        res.status(401).send('Access denied');
      } else {
        browserLoginPrompt(req, res, next);
      }
    });
  };

  function tooManyFailedLogins(next) {
    debug('too many failed login attempts');
    return next(Error.http(403, 'Basic auth login failure', {
      code: 'tooManyFailedLoginAttempts',
      log: false
    }));
  }

  // Force the browser to display it's ugly built-in basic auth prompt.
  function browserLoginPrompt(req, res) {
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="' + (options.realm || req.hostname) + '"');
    res.end('Access denied');
  }

  // Render a custom html login form
  function customLoginForm(req, res, next) {
    req.ext.webPagePath = options.loginPage;

    async.series([
      function(cb) {
        getLoginFormEmbedSnippet(function(err, embedScript) {
          if (err) return cb(err);

          // Inject the loginFormClientSnippet into the head of the custom login html page.
          req.ext.htmlOptions = {
            inject: {
              head: embedScript
            }
          };
          cb();
        });
      },
      function(cb) {
        loadLoginFormStream(req, res, cb);
      }
    ], function(err) {
      if (err) return next(err);

      res.statusCode = 401;
      req.ext.webPageStream
        .on('error', function(streamErr) {
          return next(streamErr);
        })
        .on('missing', function() {
          // If the login page is missing, show the browser login
          browserLoginPrompt(req, res, next);
        });

      pipeResponse(req, res, next);
    });
  }

  function loadLoginFormStream(req, res, next) {
    if (_.isFunction(req.ext.loadPageMiddleware)) {
      req.ext.loadPageMiddleware(req, res, next);
    } else {
      var loginPath = urljoin(req.ext.virtualApp.appId, req.ext.virtualAppVersion.versionId, options.loginPage);
      req.ext.webPageStream = req.app.settings.storage.readFileStream(loginPath);
      next();
    }
  }

  function getLoginFormEmbedSnippet(cb) {
    if (_.isString(_loginFormScriptEmbed)) return cb(null, _loginFormScriptEmbed);

    // Snippet of html that is injected into the head of the custom html login page
    // that will intercept the form submit and make a XHR request with the basic
    // auth credentials. If the credentials are correct the actual HTML for the page
    // is returned and the document is replaced via JavaScript.
    fs.readFile(__dirname + '/../../scripts/basic-auth-client.js', function(err, contents) {
      var scriptEmbed = contents.toString();
      // if (process.env.NODE_ENV === 'production') {
      scriptEmbed = uglify.minify(scriptEmbed, {fromString: true}).code;
      // }
      _loginFormScriptEmbed = '<script>' + scriptEmbed + '</script>';
      cb(null, _loginFormScriptEmbed);
    });
  }

  function promptForCredentials(req, res, next) {
    debug('prompt for credentials');
    if (options.loginPage) {
      customLoginForm(req, res, next);
    } else {
      browserLoginPrompt(req, res, next);
    }
  }
};
