var express = require('express');
var _ = require('lodash');
var debug = require('debug')('4front:apphost');

require('simple-errors');

module.exports = function(options) {
  return function(req, res, next) {
    if (req.hostname === req.app.settings.virtualHost)
      return next();

    req.ext = {
      clientConfig: {}
    };

    // Create a sub-router for the virtual app.
    var router = express.Router();

    router.use(require('./middleware/app-loader')());
    router.use(require('./middleware/traffic-control')());

    // TODO: Put middleware here to redirect static assets to the CDN.

    router.use(require('./middleware/authenticated')());
    router.use(require('./middleware/virtual-router')());

    // Put the dev-sandbox immediately before the html-page
    router.use(require('./middleware/dev-sandbox')());
    router.use(require('./middleware/html-page')());

    router.all('*', function(req, res, next) {
      // If we fell all the way through, then raise a 404 error
      next(Error.http(404, "Page not found"));
    });

    router.use(require('./middleware/error-fallback')());

    debug("running the virtual app router");
    router(req, res, next);
  };
};
