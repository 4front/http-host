var debug = require('debug')('4front:plugins:echo-options');

// Simple test plugin which just appends some text to a layers array.
module.exports = function(options) {
  return function(req, res, next) {
    res.json(options);
  };
};
