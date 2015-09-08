var express = require('express');

require('simple-errors');

module.exports = function(options) {
  // Create a sub-router for virtual apps
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

  router.use(require('./middleware/virtual-router')(options));

  return function(req, res, next) {
    // The apphost router is only relevant if the hostname either
    // has an additional level domain or is a custom domain, but
    // not simply http://apphost.tld
    if (req.hostname === req.app.settings.virtualHost)
      return next();

    req.ext = {
      clientConfig: {}
    };

    router(req, res, next);
  };
};
