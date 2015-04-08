var _ = require('lodash');

module.exports = function(options) {
  options = _.defaults(options || {}, {
    errors: {}
  });

  return function(err, req, res, next) {
    // Some errors should not show a custom error page. For example the
    // dev-sandbox sets this property to true.
    if (err.bypassCustomErrorPage === true)
      return next(err);

    // Can't render a custom error page if the virtualApp
    // or virtualAppVersion is not known.
    if (!req.ext.virtualApp || !req.ext.virtualAppVersion)
      return next();

    // Look for a custom error page specific to this statusCode
    var errorPage = options.errors[err.status];
    if (!errorPage) {
      debug("no custom error page for status code %s", err.status);
      next(err);
    }

    // If there is an error code, write it as a header
    if (err.code)
      res.set('Error-Code', err.code);

    res.set('Content-Type', 'text/html');
    res.set('Cache-Control', 'no-cache');
    res.status(err.code);

    if (_.isFunction(req.ext.createReadStream)) {
      req.ext.createReadStream(errorPage, function(streamErr, stream) {
        // Important that we call next with the original err, not streamErr.
        if (err) return next(err);

        streamResponse(stream);
      });
    }
    else {
      streamResponse(options.assetStorage.createReadStream(
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
        if (missingEventFired === true) return;
        // Important that we call next with the original error, not streamErr
        return next(err);
      });

      // Pipe the custom error page to the response
      pageStream.pipe(res);
    }
  };
};
