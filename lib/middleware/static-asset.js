var _ = require('lodash');
var accepts = require('accepts');
var zlib = require('zlib');
var path = require('path');
var urljoin = require('url-join');
var mime = require('mime');
var isImage = require('is-image');
var isVideo = require('is-video');
var debug = require('debug')('4front:apphost:static-asset');

// Serve static assets. Generally static assets should be pointed directly to a CDN
// but for internal installations where a CDN isn't available or necessary, then
// serve the assets from the virtual apphost itself.
module.exports = function(settings) {
  _.defaults(settings, {
    staticAssetMaxAge: 60 * 24 * 30 // 30 days
  });

  return function(req, res, next) {
    // If there are appId and versionId parameters then we can safely
    // set a far future expires date.
    if (req.params.appId && req.params.versionId) {
      var pathParts = req.path.split('/');

      // Take everything in the path starting with the appId to the right
      var appIdIndex = pathParts.indexOf(req.params.appId);
      req.ext.staticFilePath = pathParts.slice(appIdIndex).join('/');

      res.setHeader('Cache-Control', 'max-age=' + settings.staticAssetMaxAge);
      res.setHeader('Content-Type', mime.lookup(req.ext.staticFilePath));
      return pipeAssetToResponse(req, res, next);
    }

    // If the request path has no extension then skip this middleware.
    if (path.extname(req.path).length === 0) {
      return next();
    }

    if (req.ext.virtualEnv === 'local') {
      return res.redirect((req.secure ? 'https://' : 'http://') + 'localhost:' + req.ext.devOptions.port + req.path);
    }

    // If this is a request for an image, we can safely redirect to the fingerprinted url
    // containing the appId and versionId. It must be a 302 redirect however since the file
    // could change with the next deployment. We can't do this with non-images that are potentially
    // being fetched via a synchronous XmlHttpRequest and some browsers will not follow redirects
    // of sync XHR requests.
    if (isImage(req.path) || isVideo(req.path)) {
      var redirectUrl = '';
      if (settings.deployedAssetsPath[0] !== '/') {
        redirectUrl = req.secure === true ? 'https://' : 'http://';
      }
      redirectUrl += settings.deployedAssetsPath;
      redirectUrl = urljoin(redirectUrl, req.ext.virtualApp.appId, req.ext.virtualAppVersion.versionId, req.path);
      return res.redirect(302, redirectUrl);
    }

    // Simply use the versionId as the etag since a new deployment guarantees
    // a new etag value.
    var etag = req.ext.virtualAppVersion.versionId;

    // According to the RFC, the server should still send back the same
    // headers that would appear in a 200 response.
    // https://tools.ietf.org/html/rfc7232#section-4.1
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', etag);

    // Serve the asset directly
    var ifNoneMatch = req.get('if-none-match');
    // If the etag is a match return an empty 304 Not Modified response
    if (ifNoneMatch === etag) {
      return res.status(304).end();
    }

    req.ext.staticFilePath = urljoin(req.ext.virtualApp.appId,
      req.ext.virtualAppVersion.versionId, req.path.substr(1));

    res.setHeader('Content-Type', mime.lookup(req.ext.staticFilePath));

    // Only if the Accept-Encoding of the request does not specify gzip
    // should we pull the metadata first. This is to be able to check if
    // the file is encoded at rest to know to pipe the output through
    // gunzip. Finding this out in the 'metadata' event of the storage.readFileStream
    // requires changing the stream pipeline on the fly which leads to all
    // manner of unpredictability and overly opaque code. Typically this will
    // only be some sort of machine generated request as all major browsers
    // support gzip.
    if (accepts(req).encoding(['gzip']) === false) {
      // Retrieve the file metadata to find out if the object is gzip encoded
      req.app.settings.storage.getMetadata(req.ext.staticFilePath, function(err, metadata) {
        if (err) return next(err);
        if (!metadata) return next();
        if (metadata.contentEncoding === 'gzip') {
          settings.storage.readFileStream(req.ext.staticFilePath)
            .pipe(zlib.createGunzip())
            .pipe(res);
        } else {
          pipeAssetToResponse(req, res, next);
        }
      });
    } else {
      pipeAssetToResponse(req, res, next);
    }
  };

  function pipeAssetToResponse(req, res, next) {
    // Pipe the stream from storage to the http response
    settings.storage.readFileStream(req.ext.staticFilePath)
      .on('metadata', function(metadata) {
        // Find out if the file from storage is gzip encoded and pass
        // along in a header.
        if (metadata.contentEncoding === 'gzip') {
          res.setHeader('Content-Encoding', 'gzip');
        }

        // There is also an etag value in metadata, but purposefully ignoring
        // it as we want to use the versionId.
      })
      .on('missing', function() {
        debug('file %s is missing', req.ext.staticFilePath);
        return next();
      })
      .on('readError', function(err) {
        debug('error from storage.createReadStream', err.message);
        return next(err);
      })
      .pipe(res);
  }
};
