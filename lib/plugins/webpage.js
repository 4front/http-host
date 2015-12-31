var _ = require('lodash');
var path = require('path');
var urljoin = require('url-join');
var parseUrl = require('url').parse;
var isStaticAsset = require('../is-static-asset');
var debug = require('debug')('4front:http-host:webpage');
var helper = require('../helper');

require('simple-errors');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    defaultPage: 'index.html',
    canonicalRedirects: false,
    htmlprep: true,
    returnUrlCookie: 'returnUrl',
    contentType: 'text/html',
    pushState: false,
    defaultFileExtension: '.html'
  });

  var pipeResponse = require('../middleware/pipe-response')(options);

  return function(req, res, next) {
    debug('executing');
    // If this is a non-html static asset, skip this middleware.
    if (isStaticAsset.anyExceptHtml(req)) {
      return next();
    }

    req.ext.requestHandler = 'webpage';

    var error = helper.requiredOptionsError(req.ext, 'virtualApp', 'virtualAppVersion');
    if (error) return next(Error.http(400, error));

    // req.path returns the path that the route was mounted, which
    // for a value like '/*' will always return '/'. Need to look
    // instead at req.originalUrl.
    var actualUrl = parseUrl(req.originalUrl);

    if (options.contentType === 'text/html' && options.canonicalRedirects === true) {
      var canonicalPath = getCanonicalPath(actualUrl);
      if (canonicalPath) {
        return res.redirect(301, canonicalPath + (actualUrl.search ? actualUrl.search : ''));
      }
    }

    // Check if the webPagePath was already set by other middleware further up the stack.
    if (!req.ext.webPagePath) {
      if (options.pushState === true || actualUrl.pathname === '/') {
        req.ext.webPagePath = options.defaultPage;
      } else {
        req.ext.webPagePath = actualUrl.pathname;
      }
    }

    // Chop off the leading slash
    if (req.ext.webPagePath[0] === '/') {
      req.ext.webPagePath = req.ext.webPagePath.slice(1);
    }

    // If the path has a trailing slash, append the default page
    if (req.ext.webPagePath.slice(-1) === '/') {
      req.ext.webPagePath = urljoin(req.ext.webPagePath, options.defaultPage);
    }

    var versionId = req.ext.virtualAppVersion.versionId;

    // Ensure there is a file extension
    if (path.extname(req.ext.webPagePath).length === 0) {
      req.ext.webPagePath += options.defaultFileExtension;
    }

    debug('load page %s', req.ext.webPagePath);

    // Look for a custom createReadStream implementation on req.ext.
    // This is how the dev-sandbox forces the html page to be piped
    // from the private developer cache rather than from storage.
    if (_.isFunction(req.ext.loadPageMiddleware)) {
      req.ext.loadPageMiddleware(req, res, function(err) {
        if (_.isError(err)) return next(err);

        decorateStream(req.ext.webPageStream, req, res, next);
        pipeResponse(req, res, next);
      });
    } else {
      // Set webPageStream to a function which can be lazy evaluated
      // so in the event that the etag matches if-none-match the
      // storage.readFileStream function is not called unnecessarily.
      req.ext.webPageStream = function() {
        var storagePath = urljoin(req.ext.virtualApp.appId, versionId, req.ext.webPagePath);
        return decorateStream(req.app.settings.storage.readFileStream(storagePath), req, res, next);
      };

      pipeResponse(req, res, next);
    }
  };

  function decorateStream(stream, req, res, next) {
    function pageNotFound() {
      // If the requested page was not found, pass control through to the next
      // middleware.
      debug('missing event emitted by page stream');
      return next();
    }

    stream.on('missing', function() {
      if (req.path.slice(-1) !== '/') {
        // If we got a missing event on the original request, try
        // again by tacking on '/index.html'. So if the request is for /blog
        // we first look for a file /blog.html. As a fallback look for a file
        // /blog/index.html and redirect there.
        var fallbackPagePath = urljoin(
          req.ext.virtualApp.appId,
          req.ext.virtualAppVersion.versionId,
          req.path,
          options.defaultPage);

        req.app.settings.storage.fileExists(fallbackPagePath, function(err, exists) {
          if (err) return next(err);

          // If the fallback page exists, redirect with the trailing slash.
          if (exists === true) {
            return res.redirect(req.path + '/');
          }
          pageNotFound();
        });
      } else {
        pageNotFound();
      }
    })
    .on('readError', function(err) {
      return next(new Error('Could not read page ' + req.ext.webPagePath
        + ' from storage: ' + err.stack));
    });

    return stream;
  }

  function getCanonicalPath(actualUrl) {
    var canonicalPath;

    // Check trailing slash
    if (actualUrl.pathname.slice(-5) === '.html') {
      canonicalPath = actualUrl.pathname.slice(0, -5).toLowerCase();
    } else if (/[A-Z]/.test(actualUrl.pathname)) {
      canonicalPath = actualUrl.pathname.toLowerCase();
    }

    return canonicalPath;
  }
};
