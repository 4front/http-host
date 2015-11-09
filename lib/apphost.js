var express = require('express');
var urljoin = require('url-join');

require('simple-errors');

module.exports = function(settings) {
  // Create a sub-router for virtual apps
  var router = express.Router();
  var staticAssetMiddleware = require('./middleware/static-asset')(settings);

  // If the deployed assets are hosted by 4front rather than a CDN, then mount
  // a route handler to serve them. This should happen as early in the pipeline
  // as possible. No need to load the virtualApp since the appId and versionId are
  // already represented in the path.
  if (settings.deployedAssetsPath[0] === '/') {
    router.get(urljoin(settings.deployedAssetsPath, ':appId', ':versionId', '*'), staticAssetMiddleware);
  }

  // Perform gzip compression here rather than at the nginx proxy level so we
  // can maintain control over the etag.
  router.use(require('compression')());

  router.use(require('./middleware/app-loader')(settings));

  // The dev-sandbox must be the first middleware after
  // loading the virtual app and env. It loads the manifest
  // from redis which is required by subsequent middleware.
  router.use(require('./middleware/dev-sandbox')(settings));

  router.use(require('./middleware/traffic-control')(settings));

  router.use(require('./middleware/favicon')(settings));

  router.use(require('./middleware/virtual-router')(settings));

  return function(req, res, next) {
    // The apphost router is only relevant if the hostname either
    // has an additional level domain or is a custom domain, but
    // not simply http://apphost.tld
    if (req.hostname === req.app.settings.virtualHost) return next();

    req.ext = {
      clientConfig: {}
    };

    router(req, res, next);
  };
};
