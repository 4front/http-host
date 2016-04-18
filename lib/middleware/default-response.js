var path = require('path');
var mime = require('mime');
var debug = require('debug')('4front:default-response');

// Renders a default response for specific paths. This should
// be the last middleware before control falls out of the http-host router.
module.exports = function(settings) {
  var cannedResponses = {
    '/favicon.ico': settings.faviconPath || path.join(__dirname, '../../favicon.ico'),
    '/robots.txt': path.join(__dirname, '../../robots.txt')
  };

  return function(req, res, next) {
    var cannedFile = cannedResponses[req.path];
    if (!cannedFile) return next();

    debug('serving default response for %s', req.path);
    var etag = req.ext.virtualAppVersion.versionId;

    res.setHeader('Cache-Control', 'public, no-cache');
    res.setHeader('Content-Type', mime.lookup(req.path));

    var ifNoneMatch = req.get('if-none-match');
    // If the etag is a match return an empty 304 Not Modified response
    if (ifNoneMatch === etag) {
      return res.status(304).end();
    }

    res.setHeader('ETag', etag);
    res.sendFile(cannedFile);
  };
};
