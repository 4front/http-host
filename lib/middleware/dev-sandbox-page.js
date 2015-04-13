var _ = require('lodash');
var async = require('async');
var urlFormat = require('url').format;
var debug = require('debug')('4front-apphost:dev-sandbox-page');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    // short-lived cookie used to track the lifecycle of loading the sandbox page.
    cookieName: '_sandboxPage'
  });

  return function(req, res, next) {
    if (req.ext.pagePath.slice(0, 1) == '/')
      req.ext.pagePath = req.ext.pagePath.substr(1);

    var cacheKey = req.ext.user.userId + '/' + req.ext.virtualApp.appId + '/' + req.ext.pagePath;

    if (req.cookies[options.cookieName]) {
      debug("sandboxPage already loaded");
      res.clearCookie(options.cookieName);

      req.app.settings.cache.exists(cacheKey, function(err, exists) {
        if (err) return next(err);

        if (!exists)
          return next(Error.http(404, 'Page ' + req.ext.pagePath + ' not found.', {code: "pageNotFound"}));

        req.ext.htmlPageStream = req.app.settings.cache.readStream(cacheKey);
        next();
      });
    }
    else {
      debug("sandbox page needs to be loaded");
      res.cookie(options.cookieName, '1', {httpOnly: true});

      var redirectUrl = {
        protocol: req.secure ? 'https' : 'http',
        hostname: 'localhost',
        port: options.port,
        pathname: req.ext.pagePath
      };

      // Check if we already have the specified page in the cache and a sha value.
      async.parallel({
        exists: function(cb) {
          req.app.settings.cache.exists(cacheKey, cb);
        },
        sha: function(cb) {
          req.app.settings.cache.get(cacheKey + '/sha', cb);
        }
      }, function(err, results) {
        if (err) return next(err);

        if (results.exists === true && _.isEmpty(results.sha) === false)
          redirectUrl.query = {_sha: results.sha};

        res.redirect(urlFormat(redirectUrl));
      });
    }
  };
};
