var _ = require('lodash');
var path = require('path');

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

    res.render(options.errorPage, _.extend(Error.toJson(err), {
      title: options.title
    }));
  };
}
