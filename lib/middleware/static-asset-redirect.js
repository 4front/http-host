var urljoin = require('url-join');
var debug = require('debug')('4front:apphost:static-asset-redirect');

module.exports = function() {
  var extensionRegex = /\.[0-9a-z]{2,4}$/i;

  return function(req, res, next) {
    if (req.method !== 'GET')
      return next();

    // If the req has an extension, redirect to the staticAssetPath
    if (extensionRegex.test(req.path)) {

      var redirectUrl = '';
      
      // If the staticAssetPath does not start with a slash, this
      // indicates that it refers to a CDN hostname. We need to convert
      // it to an absolute URL by prefixing it with the same protocol
      // as the current request.
      if (req.app.settings.staticAssetPath[0] !== '/') {
        debugger;
        redirectUrl = (req.secure) ? 'https://' : 'http://';
      }

      redirectUrl += urljoin(req.app.settings.staticAssetPath,
        req.ext.virtualApp.appId, req.ext.virtualAppVersion.versionId, req.path);

      debug("redirect asset to %s", redirectUrl);
      return res.redirect(redirectUrl);
    }

    next();
  };
}
