var _ = require('lodash');
var isStaticAsset = require('../is-static-asset');
var urljoin = require('url-join');
var mime = require('mime');
var zlib = require('zlib');
var accepts = require('accepts');
// var through = require('through2');
var debug = require('debug')('4front:apphost:static-asset');

var extensionlessRegex = /\.[a-z0-9]{2,4}$/i;
var htmlExtensionRegex = /\.html$/i;

// Serve static assets. Generally static assets should be pointed directly to a CDN
// but for internal installations where a CDN isn't available or necessary, then
// serve the assets from the virtual apphost itself.
module.exports = function(settings) {
  _.defaults(settings, {
    staticAssetMaxAge: 31557600 // one year
  });

  return function(req, res, next) {
    var filePath;

    // If there are appId and versionId parameters then we can safely
    // set a far future expires date.
    if (req.params.appId && req.params.versionId) {
      var pathParts = req.path.split('/');

      // Take everything in the path starting with the appId to the right
      var appIdIndex = pathParts.indexOf(req.params.appId);
      filePath = pathParts.slice(appIdIndex).join('/');

      res.setHeader('Cache-Control', 'max-age=' + settings.staticAssetMaxAge);
      return pipeAssetToResponse(filePath, req, res, next);
    }

    // If the request has no extension or a .html extension, let the
    // request be handled by the webpage plugin.
    if (htmlExtensionRegex.test(req.path) || !extensionlessRegex.test(req.path)) {
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
    if (isStaticAsset.image(req) || isStaticAsset.video(req)) {
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

    filePath = urljoin(req.ext.virtualApp.appId,
      req.ext.virtualAppVersion.versionId, req.path.substr(1));

    pipeAssetToResponse(filePath, req, res, next);
  };

  function pipeAssetToResponse(filePath, req, res, next) {
    var gunzipStream = false;
    var nextInvoked = false;

    // Pipe the stream from storage to the http response
    settings.storage.readFileStream(filePath)
      .on('metadata', function(metadata) {
        // If the contentEncoding of the file from storage is gzip but
        // the client does not accept gzip encoding, then set a flag
        // indicating the content needs to be gunzipped before
        // piping to the response.
        if (metadata.contentEncoding === 'gzip') {
          if (accepts(req).encoding(['gzip', 'none']) === 'none') {
            gunzipStream = true;
          } else {
            res.setHeader('Content-Encoding', 'gzip');
          }
        }

        // There is also an etag value in metadata, but purposefully ignoring
        // it as we want to use the versionId.

        // Use the contentType from metadata if it exists, otherwise
        // fallback to looking in up in the mime registry.
        res.setHeader('Content-Type', metadata.contentType || mime.lookup(filePath));
      })
      .on('stream', function(readStream) {
        if (gunzipStream === true) {
          readStream.pipe(zlib.createGunzip()).pipe(res);
        } else {
          readStream.pipe(res);
        }
      })
      .on('missing', function() {
        if (nextInvoked) return;
        debug('file %s is missing', filePath);
        nextInvoked = true;
        next();
      })
      .on('error', function(err) {
        if (nextInvoked) return;
        debug('error from storage.createReadStream', err.message);
        nextInvoked = true;
        next(err);
      });
  }
};
