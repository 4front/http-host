
module.exports = function(options) {
  return function(req, res, next) {
    res.set('Content-Type', 'text/plain');
    res.send(options.text);
  };
};