var urljoin = require('url-join');
var favicon = require('serve-favicon');
var isStaticAsset = require('../is-static-asset');
var debug = require('debug')('4front:apphost:static-asset-redirect');

module.exports = function() {
  return function(req, res, next) {
    if (req.method !== 'GET') return next();

    // If this request is for a static asset or an XHR html request,
    // redirect to the static asset host.
    if (isStaticAsset.anyExceptHtml(req) || isStaticAsset.htmlXhr(req)) {
      var redirectUrl = '';

      // In developer sandbox mode static assets get redirected back to localhost
      if (req.ext.virtualEnv === 'dev') {
        // Special case for favicon. If this line is hit then it means the sandbox
        // was not able to serve the favicon so just render the default one.
        if (req.path === '/favicon.ico' && req.query.default === '1') {
          return favicon(req.app.settings.faviconPath)(req, res, next);
        }

        redirectUrl = (req.secure ? 'https://' : 'http://') + 'localhost:' + req.ext.devOptions.port + req.path;
      } else {
        // If the staticAssetPath does not start with a slash, this
        // indicates that it refers to a CDN hostname. We need to convert
        // it to an absolute URL by prefixing it with the same protocol
        // as the current request.
        if (req.app.settings.deployedAssetsPath[0] !== '/') {
          redirectUrl = (req.secure) ? 'https://' : 'http://';
        }

        redirectUrl += urljoin(req.app.settings.deployedAssetsPath,
          req.ext.virtualApp.appId, req.ext.virtualAppVersion.versionId, req.path);
      }

      debug('redirect asset to %s', redirectUrl);
      return res.redirect(redirectUrl);
    }

    next();
  };
};
