var log = require('../log');

// Final error fallback in the event that the custom-errors middleware is not
// configured for a virtual app or if that middleware is unable to
// handle the error and it falls through.
module.exports = function(options) {
  options = _.defaults(options || {}, {
    errorPage: "../"
  });

  return function(err, req, res, next) {
    // Log the error
    log(err, req);

    res.set('Content-Type', 'text/html');
    res.set('Cache-Control', 'no-cache');
    res.status(err.code);

    if (options.errorPage)
      res.render(options.errorPage);
    else
      res.render("../error.ejs");
  };
}
