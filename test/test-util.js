var stream = require('stream');

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

module.exports.createReadStream = function(str) {
  var rs = stream.Readable();
  rs._read = function () {
    rs.push(str);
    rs.push(null);
  };
  return rs;
};

module.exports.createMissingStream = function() {
  var rs = stream.Readable();
  rs._read = function () {
    rs.emit('missing');
    rs.push(null);
  };
  return rs;
}
