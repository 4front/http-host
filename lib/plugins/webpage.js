var _ = require('lodash');
var path = require('path');
var urljoin = require('url-join');
var debug = require('debug')('4front:http-host:webpage');
var helper = require('../helper');
var instrument = require('../instrument');

require('simple-errors');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    defaultPage: 'index.html',
    htmlprep: true,
    returnUrlCookie: 'returnUrl',
    contentType: 'text/html',
    pushState: false,
    defaultFileExtension: '.html',
    canonicalRedirects: true,
    noVersionAssetPatterns: [],
    // Files to look for if the defaultPage doesn't exist
    defaultPageFallbacks: ['index.xml', 'index.json']
  });

  var pipeResponse = instrument.middleware(
    require('../middleware/pipe-response')(options),
    'pipe-response');

  var webpageFallback = instrument.middleware(
    require('../middleware/webpage-fallback')(options),
    'webpage-fallback');

  return function(req, res, next) {
    debug('executing');

    // Chop the querystring off the originalUrl
    var queryIndex = req.originalUrl.indexOf('?');
    req.querystring = '';
    if (queryIndex > -1) {
      req.querystring = req.originalUrl.substr(queryIndex);
      req.originalUrl = req.originalUrl.substr(0, queryIndex);
    }

    var extName = path.extname(req.originalUrl);

    // If the url has an extension and it's not .html, skip this plugin.
    if (!_.isEmpty(extName) && extName !== options.defaultFileExtension) {
      return next();
    }

    var destUrl;
    if (req.originalUrl !== '/' && options.canonicalRedirects !== false) {
      // If the path ends with index.html then strip off the index.html and redirect
      // to the bare trailing slash URL, i.e. /features/index.html redirects to /features/
      if (req.originalUrl.slice(-1 * options.defaultPage.length) === options.defaultPage) {
        destUrl = req.originalUrl.slice(0, -1 * options.defaultPage.length);
      } else if (extName === options.defaultFileExtension) {
        // If the file has a .html extension, 301 redirect to the extensionless version.
        destUrl = req.originalUrl.slice(0, -1 * options.defaultFileExtension.length);
      } else if (req.originalUrl.slice(-5) === 'index') {
        // If the pageName is 'index' then strip it off.
        destUrl = req.originalUrl.slice(0, -5);
      }

      if (destUrl) {
        res.set('Cache-Control', 'no-cache');
        return res.redirect(301, destUrl + req.querystring);
      }
    }

    req.ext.requestHandler = 'webpage';

    var error = helper.requiredOptionsError(req.ext, 'virtualApp', 'virtualAppVersion');
    if (error) return next(Error.http(400, error));

    // Check if the webPagePath was already set by other middleware further up the stack.
    if (!req.ext.webPagePath) {
      if (options.pushState === true || req.originalUrl === '/') {
        req.ext.webPagePath = options.defaultPage;
      } else {
        req.ext.webPagePath = req.originalUrl;
      }
    }

    // If the path has a trailing slash, append the default page
    if (req.ext.webPagePath.slice(-1) === '/') {
      req.ext.webPagePath = req.ext.webPagePath + options.defaultPage;
    }

    // Chop off the leading slash
    if (req.ext.webPagePath[0] === '/') {
      req.ext.webPagePath = req.ext.webPagePath.slice(1);
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
    instrument.start(req, 's3-readstream');
    stream.on('missing', function() {
      debug('page %s is missing', req.ext.webPagePath);
      webpageFallback(req, res, next);
    })
    .on('readError', function(err) {
      return next(new Error('Could not read page ' + req.ext.webPagePath
        + ' from storage: ' + err.stack));
    })
    .on('end', function() {
      instrument.finish(req, 's3-readstream');
    });

    return stream;
  }
};
