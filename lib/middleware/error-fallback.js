var _ = require('lodash');
var path = require('path');
var fs = require('fs');
var ejs = require('ejs');
var debug = require('debug')('4front-apphost:error-fallback');

// Final error fallback in the event that the custom-errors middleware is not
// configured for a virtual app or if that middleware is unable to
// handle the error and it falls through.
module.exports = function(options) {
  options = _.defaults(options || {}, {
    errorPage: path.resolve(__dirname, "../../views/error.ejs"),
    title: "4front Error"
  });

  return function(err, req, res, next) {
    // Log the error
    req.app.settings.logger.error(err, req);

    res.set('Content-Type', 'text/html');
    res.set('Cache-Control', 'no-cache');
    res.status(err.status);

    var errorPageData = _.extend(Error.toJson(err), {
      title: options.title
    });

    fs.readFile(options.errorPage, function(fsErr, ejsContents) {
      if (fsErr) return finalFinalError(fsErr);

      try {
        return res.send(ejs.compile(ejsContents, {}, errorPageData));
      }
      catch (ejsError) {
        debug("malformed error ejs %s", options.errorPage);
        finalFinalError(ejsError);
      }
    });

    // The final error page if rendering the custom error page itself fails.
    function finalFinalError(errorPageError) {
      // Log the error rendering the error page, but without the req this time.
      req.app.settings.logger.error(errorPageError);

      res.send("<html><body>An error has occurred</body></html>");
    }
  };
}
