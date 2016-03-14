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

    if (_.isFunction(req.ext.loadPageMiddleware)) {
      req.ext.loadPageMiddleware(req, res, function(streamErr) {
        // Important that we call next with the original err, not streamErr.
        if (_.isError(streamErr)) return next(streamErr);

        decorateStream(req.ext.webPageStream, err, req, res, next);
        streamResponse(err, req, res);
      });
    } else {
      // Load the custom error page from deployments
      req.ext.webPageStream = function() {
        var storagePath = urljoin(req.ext.virtualApp.appId,
          req.ext.virtualAppVersion.versionId,
          req.ext.webPagePath);

        var webPageStream = req.app.settings.storage.readFileStream(storagePath);
        return decorateStream(webPageStream, err, req, res, next);
      };

      streamResponse(err, req, res);
    }
  };

  function streamResponse(err, req, res) {
    // Send the error to the logger. We don't need to log 400 and 404 errors
    if (err.status >= 500) {
      req.app.settings.logger.error(err, req);
    }

    // If there is an error code, write it as a header
    if (err.code) {
      res.set('Error-Code', err.code);
    }

    res.status(err.status);
    pipeResponse(req, res);
  }

  function decorateStream(stream, err, req, res, next) {
    // If the custom error page is missing proceed to the fallback error middleware
    stream.on('missing', function() {
      debug('custom error page %s not found', req.ext.webPagePath);
      // If the requested page was not found, set the status code
      // and advance to the next middleware. If the custom-errors
      // route is configured, it will handle returning the
      // custom error page. Important that we call next with the
      // original error, not streamErr
      return next(err);
    })
    .on('readError', function(streamErr) {
      debug('error reading page stream', streamErr.stack);
      // Important that we call next with the original error, not streamErr
      return next(err);
    });

    return stream;
  }
};
