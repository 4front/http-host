var _ = require('lodash');

module.exports = function(settings) {
  return function(req, res, next) {
    var keys = _.keys(req.headers);
    keys.forEach(function(key) {
      if (_.startsWith(key, 'x-override-')) {
        req.headers[key.slice(11)] = req.headers[key];
      }
    });

    next();
  };
};
