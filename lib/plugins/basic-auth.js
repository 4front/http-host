var auth = require('basic-auth');

module.exports = function(options) {
  return function(req, res, next) {
    var credentials = auth(req);

    var valid = credentials &&
      credentials.name === options.username &&
      credentials.pass === options.password;

    if (valid !== true) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="' + (options.realm || req.hostname) + '"'
      });

      return res.end('Access denied');
    }

    next();
  };
};
