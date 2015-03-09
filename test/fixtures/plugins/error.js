var _ = require('lodash');
require('simple-errors');

module.exports = function(options) {
  _.defaults(options || {}, {
    error: 'error'
  });

  return function(req, res, next) {
    next(Error.http(400, options.error));
  }
};