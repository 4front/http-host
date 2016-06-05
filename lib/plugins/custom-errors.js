var _ = require('lodash');
var urljoin = require('url-join');
var debug = require('debug')('4front-apphost:custom-errors');

// Middleware for declaring custom error pages for different
// http status codes.
// Configure in the _virtualApp section of package.json like so:
// router: [
//   {
//     module: "custom-errors",
//     options: {
//       errors: {
//         500: "errors/500.html",
//         404: "errors/404.html",
//         401: "errors.401.html"
//       }
//     }
//   }
// ]
module.exports = function(options) {
  options = _.defaults(options || {}, {
    htmlprep: true,
    errors: {} // This is a map of status codes to custom error pages
  });

  var pipeResponse = require('../middleware/pipe-response')(options);

  return function(err, req, res, next) {
    // Some errors should not show a custom error page. For example the
    // dev-sandbox sets this property to true.
    if (err.bypassCustomErrorPage === true) return next(err);

    // Can't render a custom error page if the virtualApp
    // or virtualAppVersion is not known.
    if (!req.ext.virtualApp || !req.ext.virtualAppVersion || !err.status) return next(err);

    // Look for a custom error page specific to this statusCode
    req.ext.webPagePath = options.errors[err.status] || options.errors[err.status.toString()];
    if (!req.ext.webPagePath) {
      debug('no custom error page for status code %s', err.status);
      return next(err);
    }

    // Send the error to the logger. We don't need to log 400 and 404 errors
    if (err.status >= 500) {
      req.app.settings.logger.error(err, req);
    }

    // Set the status code
    res.status(err.status);

    // If there is an error code, write it as a header
    if (err.code) {
      res.set(req.app.settings.customHttpHeaderPrefix + 'error-code', err.code);
    }

    // Load the custom error page from deployments
    var storagePath = urljoin(req.ext.virtualApp.appId,
      req.ext.virtualAppVersion.versionId,
      req.ext.webPagePath);

    req.app.settings.storage.fileExists(storagePath, function(_err, exists) {
      if (_err) return next(_err);

      if (exists) {
        req.ext.webPageStream = req.app.settings.storage.readFileStream(storagePath)
          .on('readError', function(streamErr) {
            req.app.settings.logger.warn('Error reading custom error page', {
              error: streamErr.message,
              appId: req.ext.virtualApp.appId,
              code: 'errorReadingCustomErrorPage'
            });

            // Important that we call next with the original error, not streamErr
            return next(err);
          });

        // Clear any Content-Length and explicitly set content-type to html
        res.removeHeader('Content-Length');
        res.set('Content-Type', 'text/html');
        return pipeResponse(req, res, next);
      }

      // If the custom error page is missing proceed to the fallback error middleware
      debug('custom error page %s not found', req.ext.webPagePath);
      return next(err);
    });
  };
};
