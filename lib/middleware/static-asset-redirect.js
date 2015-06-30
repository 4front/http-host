var urljoin = require('url-join');
var debug = require('debug')('4front:apphost:static-asset-redirect');

module.exports = function() {
  var extensionRegex = /\.([0-9a-z]{2,4})$/i;

  return function(req, res, next) {
    if (req.method !== 'GET')
      return next();

    // If the req has an extension, redirect to the staticAssetPath
    var extensionMatch = req.path.match(extensionRegex);
    if (extensionMatch && extensionMatch.length == 2) {

      // If this is an html request and it's not a XHR request, then
      // serve it normally from the apphost.
      if (extensionMatch[1] === 'html' && req.xhr === false)
        return next();

      var redirectUrl = '';

      // If the staticAssetPath does not start with a slash, this
      // indicates that it refers to a CDN hostname. We need to convert
      // it to an absolute URL by prefixing it with the same protocol
      // as the current request.
      if (req.app.settings.deployedAssetsPath[0] !== '/') {
        redirectUrl = (req.secure) ? 'https://' : 'http://';
      }

      redirectUrl += urljoin(req.app.settings.deployedAssetsPath,
        req.ext.virtualApp.appId, req.ext.virtualAppVersion.versionId, req.path);

      debug("redirect asset to %s", redirectUrl);
      return res.redirect(redirectUrl);
    }

    next();
  };
}
