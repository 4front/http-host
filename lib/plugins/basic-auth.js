var auth = require('basic-auth');
var fs = require('fs');
var _ = require('lodash');
var urljoin = require('url-join');
var debug = require('debug');
require('simple-errors');

// Snippet of html that is injected into the head of the custom html login page
// that will intercept the form submit and make a XHR request with the basic
// auth credentials. If the credentials are correct the actual HTML for the page
// is returned and the document is replaced via JavaScript.
var loginFormClientSnippet = '<script>' +
  fs.readFileSync(__dirname + '/../../scripts/basic-auth-client.js') +
  '</script>';

module.exports = function(options) {
  var pipeResponse = require('../middleware/pipe-response')(options);

  _.defaults(options, {
    maxFailedLogins: 3
  });

  return function(req, res, next) {
    var credentials = auth(req);

    // If there were no credentials on the request, prompt the user for them.
    if (!credentials) {
      return promptForCredentials(req, res, next);
    }

    var validCredentials = (credentials.name === options.username &&
      credentials.pass === options.password);

    // If the credentials are valid, skip ahead.
    if (validCredentials) {
      return next();
    }

    // Cache key to keep track of the number of failed login
    // attempts for this IP address.
    var loginCacheKey = 'basic-auth-fails-' + req.ext.virtualApp.appId + '-' + req.ip;

    // Load the number of login failures for this IP address.
    req.app.settings.cache.incr(loginCacheKey, function(err, value) {
      if (err) return next(err);

      // If the incremented value is 1 it must have been the first failed
      // login in this period so set the expiration of the key.
      if (value === 1) {
        req.app.settings.cache.expire(loginCacheKey, options.failedLoginPeriod);
      }

      // If too many failed login atttempts, return a 401 error.
      if (value > options.maxFailedLogins) {
        return next(Error.http(401, 'Basic auth login failure', {
          code: 'tooManyFailedLoginAttempts',
          log: false
        }));
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

  // Force the browser to display it's ugly built-in basic auth prompt.
  function browserLoginPrompt(req, res) {
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="' + (options.realm || req.hostname) + '"');
    res.end('Access denied');
  }

  // Render a custom html login form
  function customLoginForm(req, res, next) {
    var loginPath = urljoin(req.ext.virtualApp.appId, req.ext.virtualAppVersion.versionId, options.loginPage);
    req.app.settings.storage.readFileStream(loginPath)
      .on('stream', function(stream) {
        res.statusCode = 401;
        req.ext.webPageStream = stream;

        // Inject the loginFormClientSnippet into the head of the custom login html page.
        req.ext.htmlOptions = {
          inject: {
            head: loginFormClientSnippet
          }
        };

        pipeResponse(req, res, next);
      })
      .on('error', function(err) {
        return next(err);
      })
      .on('missing', function() {
        // If the login page is missing, show the browser login
        browserLoginPrompt(req, res, next);
      });
  }

  function promptForCredentials(req, res, next) {
    if (options.loginPage) {
      customLoginForm(req, res, next);
    } else {
      browserLoginPrompt(req, res, next);
    }
  }
};
