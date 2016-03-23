var prerender = require('prerender-node');

prerender.set('prerenderToken', function(req) {
  return req.ext.prerenderOptions.token;
});

prerender.set('whitelisted', function(req) {
  return req.ext.prerenderToken.whitelisted;
});

prerender.set('blacklisted', function(req) {
  return req.ext.prerenderToken.blacklisted;
});

module.exports = function(options) {
  return function(req, res, next) {
    // Stash the options in the req so it can be accessed in the
    // functions above.
    req.ext.prerenderOptions = options;
    prerender(req, res, next);
  };
};
