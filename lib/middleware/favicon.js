
module.exports = function(settings) {
  var defaultFavicon = require('serve-favicon')(settings.faviconPath);

  return function(req, res, next) {
    if (req.path !== '/favicon.ico') return next();

    // In developer sandbox mode static assets get redirected back to localhost
    if (req.ext.virtualEnv === 'dev') {
      // Special case for favicon. If this line is hit then it means the sandbox
      // was not able to serve the favicon so just render the default one.
      if (req.query.default === '1') {
        return defaultFavicon(req, res, next);
      }
      return res.redirect((req.secure ? 'https://' : 'http://') + 'localhost:' + req.ext.devOptions.port + req.path);
    }

    // Try and serve a custom favicon. If that results in an error, then render the default favicon.
    req.app.settings.deployer.serve(req.ext.virtualApp.appId, req.ext.virtualAppVersion.versionId, 'favicon.ico', res, function(err) {
      return defaultFavicon(req, res, next);
    });
  };
};
