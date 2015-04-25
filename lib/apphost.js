var express = require('express');
var _ = require('lodash');
var debug = require('debug')('4front:apphost');

module.exports = function(options) {
  return function(req, res, next) {
    if (req.hostname === req.app.settings.virtualHost)
      return next();

    if (_.isObject(req.ext) === false)
      req.ext = {};

    // Create a sub-router for the virtual app.
    var router = express.Router();

    router.use(require('./middleware/app-loader')());
    router.use(require('./middleware/traffic-control')());

    // TODO: Put middleware here to redirect static assets to the CDN.

    router.use(require('./middleware/authenticated')());
    router.use(require('./middleware/dev-sandbox')());
    router.use(require('./middleware/virtual-router')());
    router.use(require('./middleware/html-page')());
    router.use(require('./middleware/error-fallback')());

    debug("running the virtual app router");
    router(req, res, next);
  };
};
