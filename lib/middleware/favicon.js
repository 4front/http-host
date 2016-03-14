var urljoin = require('url-join');
var fs = require('fs');

module.exports = function(settings) {
  return function(req, res, next) {
    if (req.path !== '/favicon.ico') return next();

    // In developer sandbox mode static assets get redirected back to localhost
    if (req.ext.virtualEnv === 'local') {
      // Special case for favicon. If this line is hit then it means the sandbox
      // was not able to serve the favicon so just render the default one.
      if (req.query.default === '1') {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Content-Type', 'image/x-icon');
        return fs.createReadStream(settings.faviconPath).pipe(res);
      }
      return res.redirect((req.secure ? 'https://' : 'http://') + 'localhost:' + req.ext.devOptions.port + req.path);
    }

    if (req.get('If-None-Match') === req.ext.virtualAppVersion.versionId) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', 'image/x-icon');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', req.ext.virtualAppVersion.versionId);

    var storagePath = urljoin(req.ext.virtualApp.appId,
      req.ext.virtualAppVersion.versionId, 'favicon.ico');

    // Pipe the stream from storage to the http response
    settings.storage.readFileStream(storagePath)
      .on('metadata', function(metadata) {
        // Find out if the file from storage is gzip encoded and pass
        // along in a header.
        if (metadata.contentEncoding === 'gzip') {
          res.setHeader('Content-Encoding', 'gzip');
        }
      })
      .on('missing', function() {
        fs.createReadStream(settings.faviconPath).pipe(res);
      })
      .on('readError', function(err) {
        return next(err);
      })
      .pipe(res);
  };
};
