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
        return res.redirect(301, destUrl + req.querystring);
      }
    }

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

    var storage = req.app.settings.storage;
    var storagePath = urljoin(req.ext.virtualApp.appId, versionId, req.ext.webPagePath);
    storage.fileExists(storagePath, function(err, exists) {
      if (err) return next(err);

      if (exists) {
        debug('load page %s', req.ext.webPagePath);
        instrument.start(req, 'storage-readstream');
        req.ext.webPageStream = storage.readFileStream(storagePath)
          .on('readError', function(readError) {
            return next(new Error('Could not read page ' + req.ext.webPagePath
              + ' from storage: ' + readError.message));
          })
          .on('end', function() {
            instrument.finish(req, 'storage-readstream');
          });

        return pipeResponse(req, res, next);
      }

      debug('page %s is missing, check fallbacks', req.ext.webPagePath);
      // Remove the content-type since the fallback might not be html
      res.removeHeader('Content-Type');
      webpageFallback(req, res, next);
    });
  };
};
