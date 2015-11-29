var _ = require('lodash');
var mime = require('mime');
var urljoin = require('url-join');

// Serve static metapages like sitemap.xml, robots.txt, and humans.txt
module.exports = function(settings) {
  var validMetaPages = ['/sitemap.xml', '/robots.txt', '/humans.txt'];

  return function(req, res, next) {
    if (!_.contains(validMetaPages, req.path)) return next();

    // In developer sandbox mode static assets get redirected back to localhost
    if (req.ext.virtualEnv === 'dev') {
      return res.redirect((req.secure ? 'https://' : 'http://') + 'localhost:' + req.ext.devOptions.port + req.path);
    }

    var versionId = req.ext.virtualAppVersion.versionId;

    // If the client already has this version, just return a 304 Not Modified
    if (req.get('if-none-match') === versionId) {
      return res.status(304).end();
    }

    res.set('Content-Type', mime.lookup(req.path));
    // Generate an etag based on the versionId
    res.set('ETag', versionId);

    var storagePath = urljoin(req.ext.virtualApp.appId, versionId, req.path);
    var readStream = settings.storage.readFileStream(storagePath);

    // If the stream could not be found, move on to the next middleware.
    readStream.on('missing', function() {
      return next();
    });

    readStream.pipe(res);
  };
};
