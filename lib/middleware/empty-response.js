var _ = require('lodash');
var debug = require('debug')('4front:http-host:empty-response');

// Return an empty response for .asp and .php requests. Without this
// middleware they would result in 404 errors but if there are large
module.exports = function(settings) {
  var pattern;
  if (_.isString(settings.ignoreRequestPathPattern)) {
    try {
      pattern = new RegExp(settings.ignoreRequestPathPattern);
    } catch (err) {
      pattern = null;
    }
  }

  return function(req, res, next) {
    if (req.method === 'HEAD') {
      return res.status(204).end();
    }

    if (!pattern) return next();

    // Return an empty response if the req path is a match
    // for the pattern.
    if (pattern.test(req.path) === true) {
      debug('ignoring request for %s', req.path);
      return res.status(204).end();
    }
    next();
  };
};
