var debug = require('debug')('4front:plugins:passthrough');

// Simple test plugin which just appends some text to a layers array.
module.exports = function(options) {
  return function(req, res, next) {
    debug('executing plugin with value %s', options.value);
    req.ext.plugins.push(options.value);
    next();
  };
};
