var _ = require('lodash');
var async = require('async');
var path = require('path');
var urljoin = require('url-join');
var parseUrl = require('url').parse;
var debug = require('debug')('4front:http-host:webpage');
var helper = require('../helper');

require('simple-errors');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    defaultPage: 'index.html',
    htmlprep: true,
    returnUrlCookie: 'returnUrl',
    contentType: 'text/html',
    pushState: false,
    defaultFileExtension: '.html'
  });

  var pipeResponse = require('../middleware/pipe-response')(options);

  return function(req, res, next) {
    debug('executing');

    var extName = path.extname(req.originalUrl);

    // If the url has an extension and it's not .html, skip this plugin.
    if (!_.isEmpty(extName) && extName !== options.defaultFileExtension) {
      return next();
    }

    if (req.originalUrl !== '/') {
      // If the path ends with index.html then strip off the index.html and redirect
      // to the bare trailing slash URL, i.e. /features/index.html redirects to /features/
      if (req.originalUrl.slice(-1 * options.defaultPage.length) === options.defaultPage) {
        return res.redirect(301, req.originalUrl.slice(0, -1 * options.defaultPage.length));
      }

      // If the file has a .html extension, 301 redirect to the extensionless version.
      if (extName === options.defaultFileExtension) {
        return res.redirect(301, req.originalUrl.slice(0, -1 * options.defaultFileExtension.length));
      }
    }

    req.ext.requestHandler = 'webpage';

    var error = helper.requiredOptionsError(req.ext, 'virtualApp', 'virtualAppVersion');
    if (error) return next(Error.http(400, error));

    // req.path returns the path that the route was mounted, which
    // for a value like '/*' will always return '/'. Need to look
    // instead at req.originalUrl.
    var actualUrl = parseUrl(req.originalUrl);

    // Check if the webPagePath was already set by other middleware further up the stack.
    if (!req.ext.webPagePath) {
      if (options.pushState === true || req.originalUrl === '/') {
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
      req.ext.webPagePath = req.ext.webPagePath + options.defaultPage;
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
      debug('page and alternates not found');
      return next();
    }

    stream.on('missing', function() {
      debug('page %s is missing', req.ext.webPagePath);
      // If the file corresponding to the current request url is missing, before
      // returning a 404 look for some common alternatives. If one exists, redirect
      // to it. Do not search for alternates if the request is for the root document.
      if (req.originalUrl === '/') {
        return pageNotFound();
      }

      var alternates = possibleAlternateFiles(req);
      async.detectSeries(alternates, function(alt, cb) {
        debug('check for alternate file %s', alt.filePath);
        var fullPath = urljoin(req.ext.virtualApp.appId,
          req.ext.virtualAppVersion.versionId, alt.filePath);

        // the detectSeries truth test callback just takes a bool, not
        // an error as the first argument.
        req.app.settings.storage.fileExists(fullPath, function(err, exists) {
          cb(!err && exists === true);
        });
      }, function(foundAlternate) {
        if (_.isObject(foundAlternate)) {
          debug('redirecting to alternate page %s', foundAlternate.url);
          return res.redirect(301, foundAlternate.url);
        }
        // If no alternative was found, then give up and return a 404.
        pageNotFound();
      });
    })
    .on('readError', function(err) {
      return next(new Error('Could not read page ' + req.ext.webPagePath
        + ' from storage: ' + err.stack));
    });

    return stream;
  }

  function possibleAlternateFiles(req) {
    var alternates = [];
    var url, filePath;

    // If the req path contains an uppercase character, check if
    // the all lowercase version exists.
    if (/[A-Z]+/.test(req.originalUrl)) {
      url = req.originalUrl.toLowerCase();
      filePath = url + options.defaultFileExtension;
      alternates.push({url: url, filePath: filePath});
    }

    // If url has a trailing slash, look if chopping off the slash would yield a hit.
    // Coversely if the request does not have a trailing slash, check if tacking on
    // a trailing slash would yield a hit. For example:
    // /docs/custom-error-pages/ -> /docs/custom-error-pages if docs/custom-error-page.html exists
    // /docs/custom-error-pages -> /docs/custom-error-pages/ if docs/custom-error-pages/index.html exists
    if (req.originalUrl.slice(-1) === '/') {
      url = req.originalUrl.slice(0, -1);
      filePath = url + options.defaultFileExtension;
      alternates.push({url: url, filePath: filePath});
    } else {
      // try tacking on a trailing slash
      url = req.originalUrl + '/';
      filePath = url + options.defaultPage;
      alternates.push({url: url, filePath: filePath});
    }

    return alternates;
  }
};
