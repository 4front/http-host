var _ = require('lodash');
var path = require('path');
var fs = require('fs');
var ejs = require('ejs');
var debug = require('debug')('4front:apphost:error-fallback');

require('simple-errors');

// Final error fallback in the event that the custom-errors middleware is not
// configured for a virtual app or if that middleware is unable to
// handle the error and it falls through.
module.exports = function(options) {
  options = _.defaults(options || {}, {
    errorPage: path.resolve(__dirname, "../../views/error.ejs"),
    title: "4front Error"
  });

  return function(err, req, res, next) {
    res.set('Content-Type', 'text/html');
    res.set('Cache-Control', 'no-cache');
    res.status(err.status);

    var errorPageData = _.extend(Error.toJson(err), {
      title: options.title
    });

    fs.readFile(options.errorPage, function(fsErr, ejsContents) {
      if (fsErr) return finalFinalError(fsErr);

      try {
        // var compiled = ejs.compile(ejsContents, 'utf8'));
        res.send(ejs.render(ejsContents.toString(), errorPageData));
      }
      catch (ejsError) {
        debug("malformed error ejs %s %s %o", ejsContents, ejsError.stack, errorPageData);

        finalFinalError(ejsError);
      }
    });

    // The final error page if rendering the custom error page itself fails.
    function finalFinalError(errorPageError) {
      // Log the error rendering the error page, but without the req this time.
      req.app.settings.logger.error(errorPageError);

      try {
        res.end("<html><body>An error has occurred</body></html>");
      }
      catch (err) {
        console.error("Oops what's going on?: %o", err.stack);
      }
    }
  };
}
