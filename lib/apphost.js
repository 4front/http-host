var express = require('express');
var _ = require('lodash');
var urljoin = require('url-join');
var debug = require('debug')('4front:apphost');

require('simple-errors');

module.exports = function(options) {
  // TODO: Can we just return the router rather than re-constructing it from
  // scratch on each request?
  return function(req, res, next) {
    // The apphost router is only relevant if the hostname either
    // has an additional level domain or is a custom domain, but
    // not simply http://apphost.tld
    if (req.hostname === req.app.settings.virtualHost)
      return next();

    req.ext = {
      clientConfig: {}
    };

    // Create a sub-router for the virtual app.
    var router = express.Router();

    // Intentionally registering this middleware first since there's no need
    // to actually load the virtualApp up into memory.
    router.use(require('./middleware/static-asset')());

    router.use(require('./middleware/app-loader')());

    // The dev-sandbox must be the first middleware after
    // loading the virtual app and env. It loads the manifest
    // from redis which is required by subsequent middleware.
    router.use(require('./middleware/dev-sandbox')());

    router.use(require('./middleware/traffic-control')());

    // This needs to go after the traffic-control middleware above
    // so that the version is known.
    router.use(require('./middleware/static-asset-redirect')());

    router.use(require('./middleware/virtual-router')());

    debug("running the virtual app router");
    router(req, res, next);
  };
};
