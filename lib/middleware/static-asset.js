var _ = require('lodash');
var isStaticAsset = require('../is-static-asset');
var urljoin = require('url-join');
var mime = require('mime');
var debug = require('debug')('4front:apphost:static-asset');

// Serve static assets. Generally static assets should be pointed directly to a CDN
// but for internal installations where a CDN isn't available or necessary, then
// serve the assets from the virtual apphost itself.
module.exports = function(settings) {
  _.defaults(settings, {
    staticAssetMaxAge: 60 * 24 * 30 // 30 days
  });

  return function(req, res, next) {
    var filePath;
    // If there are appId and versionId parameters then we can safely
    // set a far future expires date.
    if (req.params.appId && req.params.versionId) {
      var pathParts = req.path.split('/');

      // Take everything in the path starting with the appId to the right
      var appIdIndex = pathParts.indexOf(req.params.appId);
      filePath = pathParts.slice(appIdIndex).join('/');

      res.setHeader('Cache-Control', 'max-age=' + settings.staticAssetMaxAge);
      return pipeAssetToResponse(res, filePath, next);
    }

    if (isStaticAsset.anyExceptHtml(req) === false) return next();

    if (req.ext.virtualEnv === 'dev') {
      return res.redirect((req.secure ? 'https://' : 'http://') + 'localhost:' + req.ext.devOptions.port + req.path);
    }

    // If this is a request for an image, we can safely redirect to the fingerprinted url
    // containing the appId and versionId. It must be a 302 redirect however since the file
    // could change with the next deployment. We can't do this with non-images that are potentially
    // being fetched via a synchronous XmlHttpRequest and some browsers will not follow redirects
    // of sync XHR requests.
    if (isStaticAsset.image(req)) {
      return res.redirect(302, urljoin(settings.deployedAssetsPath,
        req.ext.virtualApp.appId, req.ext.virtualAppVersion.versionId, req.path));
    }

    // Serve the asset directly
    var ifNoneMatch = req.get('if-none-match');
    // If the request is for a non-html static asset,
    if (ifNoneMatch === req.ext.virtualAppVersion.versionId) {
      return res.status(304).end();
    }

    filePath = urljoin(req.ext.virtualApp.appId,
      req.ext.virtualAppVersion.versionId, req.path.substr(1));

    // If the versionId is not part of the asset URL, then we can't set a far-future expires
    // date. But we can at least set an ETag with the versionId.
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', req.ext.virtualAppVersion.versionId);

    pipeAssetToResponse(res, filePath, next);
  };

  function pipeAssetToResponse(res, filePath, next) {
    res.setHeader('Content-Type', mime.lookup(filePath));

    // Pipe the stream from storage to the http response
    var readStream = settings.storage.createReadStream(filePath)
     .on('missing', function() {
       debug('file %s is missing', filePath);
       return next();
     })
     .on('readError', function(err) {
       debug('error from storage.createReadStream', err.message);
       return next(err);
     });

    readStream.pipe(res);
  }
};
