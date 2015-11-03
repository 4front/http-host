require('simple-errors');

// Test 4 arrity error handling plugin
module.exports = function(options) {
  return function(err, req, res, next) {
    res.set('Error-Handler', 'err-handler');
    res.status(err.status).send(err.message || err.text || 'unhandled error');
  };
};
