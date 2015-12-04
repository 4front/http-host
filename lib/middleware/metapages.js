var _ = require('lodash');
var urljoin = require('url-join');

// Serve static metapages like sitemap.xml, robots.txt, and humans.txt
module.exports = function(settings) {
  var validMetaPages = ['/sitemap.xml', '/robots.txt', '/humans.txt'];

  return function(req, res, next) {
    if (!_.contains(validMetaPages, req.path)) return next();

    // In developer sandbox mode static assets get redirected back to localhost
    if (req.ext.virtualEnv === 'local') {
      return res.redirect((req.secure ? 'https://' : 'http://') + 'localhost:' + req.ext.devOptions.port + req.path);
    }

    var versionId = req.ext.virtualAppVersion.versionId;

    // If the client already has this version, just return a 304 Not Modified
    if (req.get('if-none-match') === versionId) {
      return res.status(304).end();
    }

    var storagePath = urljoin(req.ext.virtualApp.appId, versionId, req.path);
    var readStream = settings.storage.readFileStream(storagePath);

    readStream.on('metadata', function(metadata) {
      res.set('Content-Type', metadata.contentType);
      if (metadata.contentEncoding) {
        res.set('Content-Encoding', metadata.contentEncoding);
      }
      // Intentionally ignoring the cacheControl metadata. Because this
      // file is not being served from a fingerprinted url, we can't
      // set a max-age header. Instead relying on etags.
    });

    readStream.on('missing', function() {
      return next();
    });

    res.setHeader('Cache-Control', 'no-cache');

    // Generate an etag based on the versionId
    res.set('ETag', versionId);

    readStream.pipe(res);
  };
};
