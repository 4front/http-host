var _ = require('lodash');
var log = require('../log');
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
    errors: {} // This is a map of status codes to custom error pages
  });

  return function(err, req, res, next) {
    // Some errors should not show a custom error page. For example the
    // dev-sandbox sets this property to true.
    if (err.bypassCustomErrorPage === true)
      return next(err);

    // Can't render a custom error page if the virtualApp
    // or virtualAppVersion is not known.
    if (!req.ext.virtualApp || !req.ext.virtualAppVersion)
      return next(err);

    // Look for a custom error page specific to this statusCode
    var errorPage = options.errors[err.status];
    if (!errorPage) {
      debug("no custom error page for status code %s", err.status);
      return next(err);
    }

    if (_.isFunction(req.ext.createReadStream)) {
      debug("using custom req.ext.createReadStream");
      req.ext.createReadStream(errorPage, function(streamErr, stream) {
        // Important that we call next with the original err, not streamErr.
        if (streamErr) return next(err);

        streamResponse(stream);
      });
    }
    else {
      if (_.isObject(req.app.settings.assetStorage) === false)
        return next(err);

      debug("read stream %s", errorPage);

      streamResponse(req.app.settings.assetStorage.createReadStream(
        req.ext.virtualApp.appId,
        req.ext.virtualAppVersion.versionId,
        errorPage));
    }

    function streamResponse(pageStream) {
      // If the custom error page is missing proceed to the fallback error middleware
      pageStream.on('missing', function() {
        missingEventFired = true;

        debug('custom error page %s not found', errorPage);
        // If the requested page was not found, set the status code
        // and advance to the next middleware. If the custom-errors
        // route is configured, it will handle returning the
        // custom error page. Important that we call next with the
        // original error, not streamErr
        return next(err);
      })
      .on('error', function(streamErr) {
        debug("error reading page stream");
        if (missingEventFired === true) return;
        // Important that we call next with the original error, not streamErr
        return next(err);
      });

      log(err, req);

      // If there is an error code, write it as a header
      if (err.code)
        res.set('Error-Code', err.code);

      res.set('Content-Type', 'text/html');
      res.set('Cache-Control', 'no-cache');
      res.status(err.status);

      // Pipe the custom error page to the response
      debug("piping page to response");

      pageStream.pipe(res);
    }
  };
};
