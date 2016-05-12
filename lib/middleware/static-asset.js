var _ = require('lodash');
var accepts = require('accepts');
var zlib = require('zlib');
var path = require('path');
var urljoin = require('url-join');
var mime = require('mime');
var replaceStream = require('replacestream');
var debug = require('debug')('4front:apphost:static-asset');

require('simple-errors');

// Serve static assets. Generally static assets should be pointed directly to a CDN
// but for internal installations where a CDN isn't available or necessary, then
// serve the assets from the virtual apphost itself.
module.exports = function(options) {
  options = _.defaults({}, options, {
    staticAssetMaxAge: 60 * 24 * 30, // 30 days
    replaceBaseUrlFileExtensions: ['.xml', '.json'],
    baseUrlPlaceholder: 'https://__baseurl__'
  });

  var baseUrlRegex = new RegExp(options.baseUrlPlaceholder + '\/*', 'gi');
  var customHeaders = require('./custom-headers')(options);

  return function(req, res, next) {
    debug('executing');

    var reqPath = req.ext.path || req.path;
    _.assign(req.ext, {
      path: reqPath,
      extName: path.extname(reqPath)
    });

    // If there are appId and versionId parameters then we can safely
    // set a far future expires date.
    if (req.params.appId && req.params.versionId) {
      var pathParts = req.ext.path.split('/');

      // Take everything in the path starting with the appId to the right
      var appIdIndex = pathParts.indexOf(req.params.appId);
      req.ext.staticFilePath = pathParts.slice(appIdIndex).join('/');

      res.setHeader('Cache-Control', 'max-age=' + options.staticAssetMaxAge);
      res.setHeader('Content-Type', mime.lookup(req.ext.staticFilePath));
      return pipeAssetToResponse(req, res, next);
    }

    // If the request path has no extension or the extension is .html, skip this middleware.
    if (req.ext.extName.length === 0 || req.ext.extName === '.html') {
      return next();
    }

    // Explictly deny access to package.json
    if (req.ext.path === '/package.json') {
      return next(Error.http(404, 'Page not found'));
    }

    if (req.ext.virtualEnv === 'local') {
      return res.redirect((req.secure ? 'https://' : 'http://') +
        'localhost:' + req.ext.devOptions.port + req.ext.path);
    }

    req.ext.staticFilePath = urljoin(req.ext.virtualApp.appId,
      req.ext.virtualAppVersion.versionId, req.ext.path.substr(1));

    // The Content-Type may have been set earlier by the http-headers plugin
    if (!res.get('Content-Type')) {
      res.set('Content-Type', mime.lookup(req.ext.staticFilePath));
    }

    customHeaders(req, res, function(err) {
      if (err) return next(err);

      var acceptsGzip = accepts(req).encoding(['gzip']);

      // Only if the Accept-Encoding of the request does not specify gzip
      // should we pull the metadata first. This is to be able to check if
      // the file is encoded at rest to know to pipe the output through
      // gunzip. Finding this out in the 'metadata' event of the storage.readFileStream
      // requires changing the stream pipeline on the fly which leads to all
      // manner of unpredictability and overly opaque code. Typically this will
      // only be some sort of machine generated request as all major browsers
      // support gzip.
      if (!acceptsGzip || _.includes(options.replaceBaseUrlFileExtensions, req.ext.extName)) {
        maybeUnzipBeforeResponse(req, res, next);
      } else {
        pipeAssetToResponse(req, res, next);
      }
    });
  };

  function maybeUnzipBeforeResponse(req, res, next) {
    // Retrieve the file metadata to find out if the object is gzip encoded
    req.app.settings.storage.getMetadata(req.ext.staticFilePath, function(err, metadata) {
      if (err) return next(err);
      if (metadata && metadata.contentEncoding === 'gzip') {
        if (metadata.contentLength) {
          res.set('Content-Length', metadata.contentLength);
        }
        return req.app.settings.storage.readFileStream(req.ext.staticFilePath)
          .pipe(zlib.createGunzip())
          .pipe(res);
      }
      pipeAssetToResponse(req, res, next);
    });
  }

  function pipeAssetToResponse(req, res, next) {
    var isGzipped;
    // Pipe the stream from storage to the http response
    debug('readFileStream %s', req.ext.staticFilePath);
    var fileStream = req.app.settings.storage.readFileStream(req.ext.staticFilePath)
      .on('metadata', function(metadata) {
        // Find out if the file from storage is gzip encoded and pass
        // along in a header.
        if (metadata.contentEncoding === 'gzip') {
          isGzipped = true;
          res.setHeader('Content-Encoding', 'gzip');
        }

        if (metadata.contentLength) {
          res.setHeader('Content-Length', metadata.contentLength);
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
      });

    // For xml and json files, replace the https://__baseurl__ using the replacestream.
    // Make sure double slashes are accounted for.
    if (_.includes(options.replaceBaseUrlFileExtensions, req.ext.extName) && isGzipped !== true) {
      var baseUrl = (req.secure ? 'https' : 'http') + '://' + req.hostname;

      debug('replacestream baseurl then pipe to res');
      fileStream
        .pipe(replaceStream(baseUrlRegex, function(match) {
          if (_.endsWith(match, '/')) {
            return baseUrl + '/';
          }
          return baseUrl;
        }))
        .pipe(res);
    } else {
      fileStream.pipe(res);
    }
  }
};
