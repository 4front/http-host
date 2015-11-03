var isStaticAsset = require('../is-static-asset');

// Serve static assets. Generally static assets should be pointed directly to a CDN
// but for internal installations where a CDN isn't available or necessary, then
// serve the assets from the virtual apphost itself.
module.exports = function() {
  return function(req, res, next) {
    // If there are appId and versionId parameters then we can safely
    // set a far future expires date.
    if (req.params.appId && req.params.versionId) {
      var pathParts = req.path.split('/');
      var filePath = pathParts.slice(pathParts.indexOf(req.params.versionId) + 1).join('/');
      return req.app.settings.deployer.serve(req.params.appId, req.params.versionId, filePath, res, next);
    }

    if (isStaticAsset.anyExceptHtml(req) === false) return next();

    if (req.ext.virtualEnv === 'dev') {
      return res.redirect((req.secure ? 'https://' : 'http://') + 'localhost:' + req.ext.devOptions.port + req.path);
    }

    // Serve the asset directly
    var ifNoneMatch = req.get('if-none-match');
    // If the request is for a non-html static asset,
    if (ifNoneMatch === req.ext.virtualAppVersion.versionId) {
      return res.status(304).end();
    }

    // If the versionId is not part of the asset URL, then we can't set a far-future expires
    // date. But we can at least set an ETag with the versionId.
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', req.ext.virtualAppVersion.versionId);

    return req.app.settings.deployer.serve(req.ext.virtualApp.appId,
      req.ext.virtualAppVersion.versionId, req.path.substr(1), res, next);
  };
};
