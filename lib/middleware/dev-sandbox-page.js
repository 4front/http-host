var _ = require('lodash');
var async = require('async');
var urljoin = require('url-join');
var urlFormat = require('url').format;
var parseUrl = require('url').parse;
var debug = require('debug')('4front:apphost:dev-sandbox-page');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    // short-lived cookie used to track the lifecycle of loading the sandbox page.
    cookieName: '_sandboxPage'
  });

  return function(req, res, next) {
    var cacheKey = urljoin(req.ext.user.userId, req.ext.virtualApp.appId, req.ext.pagePath);

    if (req.cookies[options.cookieName]) {
      debug("sandboxPage already loaded");
      res.clearCookie(options.cookieName);

      req.app.settings.cache.exists(cacheKey, function(err, exists) {
        if (err) return next(err);

        if (!exists)
          return next(Error.http(404, 'Page ' + req.ext.pagePath + ' not found.', {code: "pageNotFound"}));

        req.ext.pageStream = req.app.settings.cache.readStream(cacheKey);
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
        pathname: urljoin('sandbox', req.ext.pagePath)
      };

      // Check if we already have the specified page in the cache and a hash value.
      async.parallel({
        exists: function(cb) {
          req.app.settings.cache.exists(cacheKey, cb);
        },
        hash: function(cb) {
          req.app.settings.cache.get(cacheKey + '/hash', cb);
        }
      }, function(err, results) {
        if (err) return next(err);

        // Pass the original url as the return query parameter
        // so the localhost sandbox can redirect back to the same place.
        var returnUrl = {};
        returnUrl.protocol = req.secure ? 'https' : 'http';
        returnUrl.host = req.hostname;

        // Need to use the orignalUrl, not just req.path. Otherwise
        // we lose what preceeded the route mount point.
        returnUrl.pathname = parseUrl(req.originalUrl).pathname;
        returnUrl.query = req.query;

        redirectUrl.query = {return: urlFormat(returnUrl)};

        // If we have a hash for the requested file, pass it back as a
        // querystring parameter. The localhost sandbox will only re-upload
        // the file if the hash is different.
        if (results.exists && _.isEmpty(results.hash) === false)
          redirectUrl.query.hash = results.hash;

        res.redirect(urlFormat(redirectUrl));
      });
    }
  };
};
