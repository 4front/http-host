
module.exports = function(options) {
  return function(req, res, next) {
    res.set('Content-Type', 'text/html');
    res.send('<html><head></head></html>');
  };
};
