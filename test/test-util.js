
// Test utility functions
module.exports.errorHandler = function(err, req, res, next) {
  res.statusCode = err.status || 500;
  if (res.statusCode === 500) {
    console.log(err.stack);
    res.end(err.stack);
  }
  else {
    if (err.code)
      res.set('Error-Code', err.code);
    res.send(err.toString());
  }
};
