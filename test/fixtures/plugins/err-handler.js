var _ = require('lodash');
require('simple-errors');

// Test 4 arrity error handling plugin
module.exports = function(options) {
  debugger;
  return function(err, req, res, next) {
    debugger;
    res.set("Error-Handler", 'err-handler');
    res.status(err.status).send(err.message);
  }
};
