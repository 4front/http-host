var _ = require('lodash');
var async = require('async');
var urljoin = require('url-join');
var debug = require('debug')('4front:http-host:webpage-fallback');

// Internal middleware for when a page is not found.
module.exports = function(options) {
  var staticAsset = require('./static-asset')(options);

  return function(req, res, next) {
    var alternates = possibleAlternateFiles(req);
    async.detectSeries(alternates, function(alt, cb) {
      debug('check for alternate file %s', alt.filePath);
      var fullPath = urljoin(req.ext.virtualApp.appId,
        req.ext.virtualAppVersion.versionId, alt.filePath);

      req.app.settings.storage.fileExists(fullPath, function(err, _exists) {
        var exists = !err && _exists;
        debug('alternate file %s exists: %s', fullPath, exists);
        cb(null, exists);
      });
    }, function(err, foundAlternate) {
      debug('done detecting alternates');
      if (_.isObject(foundAlternate)) {
        // If the alternate is a static asset fallback, delegate to
        // the static asset middleware. Example is when returning an index.xml
        // file rather than index.html.
        if (foundAlternate.fallback === true) {
          debug('render static alternate %s', foundAlternate.filePath);
          // Override the req.path to the alternate
          req.ext.path = foundAlternate.filePath;
          return staticAsset(req, res, next);
        }

        debug('redirecting to alternate page %s', foundAlternate.url);
        res.redirect(foundAlternate.code, foundAlternate.url + req.querystring);
      } else {
        // If the requested page was not found, pass control through to the next
        // middleware.
        debug('page and alternates not found');
        return next();
      }
    });
  };

  function possibleAlternateFiles(req) {
    var alternates = [];
    var url;
    var filePath;

    // If the req path contains an uppercase character, check if
    // the all lowercase version exists.
    if (/[A-Z]+/.test(req.originalUrl)) {
      url = req.originalUrl.toLowerCase();
      filePath = url + options.defaultFileExtension;
      alternates.push({url: url, filePath: filePath, code: 301});
    }

    // If url has a trailing slash, look if chopping off the slash would yield a hit.
    // Conversely if the request does not have a trailing slash, check if tacking on
    // a trailing slash would yield a hit. For example:
    // /docs/custom-error-pages/ -> /docs/custom-error-pages if docs/custom-error-page.html exists
    // /docs/custom-error-pages -> /docs/custom-error-pages/
    // if docs/custom-error-pages/index.html exists
    if (req.originalUrl.slice(-1) === '/') {
      // Check if any of the default page fallbacks exist like index.xml
      _.forEach(options.defaultPageFallbacks, function(fallbackFile) {
        alternates.push({filePath: req.originalUrl + fallbackFile, fallback: true});
      });
      url = req.originalUrl.slice(0, -1);

      filePath = url + options.defaultFileExtension;
      alternates.push({url: url, filePath: filePath, code: 302});
    } else {
      // try tacking on a trailing slash
      url = req.originalUrl + '/';
      filePath = url + options.defaultPage;
      alternates.push({url: url, filePath: filePath, code: 302});
    }

    return alternates;
  }
};
