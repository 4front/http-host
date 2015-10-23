var _ = require('lodash');

// Serve static assets. Generally static assets should be pointed directly to a CDN
// but for internal installations where a CDN isn't available or necessary, then
// serve the assets from the virtual apphost itself.
module.exports = function() {
  return function(req, res, next) {
    var assetsPath = req.app.settings.deployedAssetsPath;

    // This middleware is only applicable if the deployedAssetsPath
    // is relative to the root of the virtual app.
    if (assetsPath[0] !== '/') return next();

    // If the request path does not begin with the deployedAssetsPath, skip
    // to the next middleware.
    if (req.path.slice(0, assetsPath.length) !== assetsPath) return next();

    var pathParts = _.compact(req.path.slice(assetsPath.length).split('/'));
    if (pathParts.length < 3) return next();

    var appId = pathParts[0];
    var versionId = pathParts[1];
    var filePath = pathParts.slice(2).join('/');

    req.app.settings.deployer.serve(appId, versionId, filePath, res);
  };
};
