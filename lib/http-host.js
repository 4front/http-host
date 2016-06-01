var express = require('express');
var urljoin = require('url-join');
var _ = require('lodash');
var compressible = require('compressible');
var instrument = require('./instrument');

require('simple-errors');

module.exports = function(settings) {
  _.defaults(settings, {
    noCacheHttpHeader: 'public, max-age=31536000, no-cache'
  });

  // Create a sub-router for virtual apps
  var router = express.Router();

  // Initialize the middleware instrumentation
  router.use(instrument.init(settings));

  // Must come BEFORE the compression middleware. The event-emitter
  // monkeypatches the res.write and res.end functions.
  router.use(require('./middleware/event-emitter')(settings));

  // Must be declared early in the middleware pipeline because it overrides
  // headers.
  router.use(require('./middleware/override-headers')(settings));

  var staticAssetMiddleware = instrument.middleware(
    require('./middleware/static-asset')(settings),
    'static-asset');

  // Perform gzip compression here rather than at the nginx proxy level so we
  // can maintain control over the etag.
  router.use(require('compression')({
    filter: function(req, res) {
      // Don't perform compression if the response content came from server cache.
      return req.ext.cacheHit !== true && compressible(res.get('Content-Type'));
    }
  }));

  // If the deployed assets are hosted by 4front rather than a CDN, then mount
  // a route handler to serve them. This should happen as early in the pipeline
  // as possible. No need to load the virtualApp since the appId and versionId are
  // already represented in the path.
  if (settings.deployedAssetsPath[0] === '/') {
    var routePath = urljoin(settings.deployedAssetsPath, ':appId', ':versionId', '*');
    router.get(routePath, staticAssetMiddleware);
  }

  router.use(function(req, res, next) {
    req.ext.contentCacheEnabled =
      _.isFunction(settings.enableContentCache) &&
      settings.enableContentCache(req) === true;

    req.ext.appCacheEnabled =
      _.isFunction(settings.enableAppCache) &&
      settings.enableAppCache(req) === true;

    next();
  });

  router.use(instrument.middleware(
    require('./middleware/app-context-loader')(settings), 'app-context-loader'));

  // Only honor HEAD requests for the root of the website. The response will include
  // the custom headers with the appId, versionId, etc. set by the app-context-loader
  router.head('/', function(req, res, next) {
    res.set('Cache-Control', settings.noCacheHttpHeader);
    res.status(200).end();
  });

  // The dev-sandbox must be the first middleware after
  // loading the virtual app and env. It loads the manifest
  // from redis which is required by subsequent middleware.
  router.use(require('./middleware/dev-sandbox')(settings));

  // Spit out the JSON manifest for the current version
  router.get('/__metadata', function(req, res, next) {
    res.set('Cache-Control', settings.noCacheHttpHeader);
    res.json({
      virtualApp: _.omit(req.ext.virtualApp, 'env'),
      version: req.ext.virtualAppVersion
    });
  });

  router.use(instrument.middleware(
    require('./middleware/virtual-router')(settings),
    'virtual-router'));

  return function(req, res, next) {
    // The http-host router is only relevant if the hostname either
    // has an additional level domain or is a custom domain, but
    // not simply http://apphost.tld
    if (req.hostname === req.app.settings.virtualHost) return next();

    if (!req.ext) req.ext = {};
    req.ext.clientConfig = {};

    router(req, res, next);
  };
};
