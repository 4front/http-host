var _ = require('lodash');
var express = require('express');
var etag = require('etag');
var accepts = require('accepts');
var onHeaders = require('on-headers');
var bytes = require('bytes');
var helper = require('../helper');
var debug = require('debug')('4front:http-host:cache');

// TODO: Should we also cache 404 responses?? If so need to think
// about how to not create a seperate cache key for every 404 URL.
var cacheStatusCodes = [200, 301, 302];

var HIT_RATE_METRIC = 'content-cache-hitrate';

// https://developers.google.com/web/fundamentals/performance/optimizing-content-efficiency/http-caching?hl=en#defining-optimal-cache-control-policy
module.exports = function(settings) {
  _.defaults(settings, {
    customHttpHeaderPrefix: 'x-4front-',
    maxContentLength: bytes.parse('500kb'), // max uncompressed size to cache
    cacheControl: 'public, max-age=31536000, no-cache',
    metrics: nullMetrics()
  });

  function nullMetrics() {
    return {
      increment: function() {}
    };
  }

  var customHeader = settings.customHttpHeaderPrefix + 'server-cache';

  var preserveHeaders = [
    'content-type',
    'cache-control',
    'content-encoding',
    'etag',
    'location'
  ];

  return function(req, res, next) {
    if (bypassCache(req, res) === true) {
      return next();
    }

    req.__etag = generateETag(req);

    var router = express.Router();
    router.use(conditionalGet);

    var shouldWriteToCache;
    onHeaders(res, function() {
      // Set the ETag header for 200
      if (res.statusCode === 200) {
        res.setHeader('ETag', req.__etag);
      }

      // The Cache-Control may have already been specified earlier by
      // the http-headers plugin.
      if (!res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', settings.cacheControl);
      }

      // Determine if this response should be cached
      shouldWriteToCache = shouldCache(req, res);
    });

    if (req.ext.contentCacheEnabled === true) {
      // Chop off the surrounding quotes from the etag header
      req.__cacheKey = req.__etag.slice(1, -1);

      // Array args for the cache hmset call
      var hmsetArgs = [req.__cacheKey + '-headers'];

      // Need to use the eventEmitter 'responseHeader' rather than the onHeaders
      // block above in order to capture the Content-Encoding set by the compression
      // middleware.
      req.ext.eventEmitter.on('responseHeader', function(header, value) {
        // We don't know yet if shouldWriteToCache is true or not, so do
        // this no matter what.
        if (preserveHeaderInCache(header)) {
          // If this is the Location header, strip off the querystring before caching.
          // When a subsequent request uses the cached response, that request's
          // querystring will be appended.
          if (header.toLowerCase() === 'location') {
            value = helper.stripQuerystring(value);
          }
          hmsetArgs.push(header, value);
        }
      });

      var contentWriteStream;
      var responseEnded;
      var cacheWrittenLength = 0;
      var cachedContentTooLarge = false;

      req.ext.eventEmitter.on('responseWrite', function(chunk, encoding) {
        // Specifically check for a 200 code for writing the body to the cache.
        // We still write the headers for 301 and 302 responses to the cache.
        if (!shouldWriteToCache || res.statusCode !== 200 || responseEnded === true) return;

        var cacheKey = req.__cacheKey + '-content';
        // lazy create the cache writestream
        if (!contentWriteStream) {
          contentWriteStream = settings.contentCache.writeStream(cacheKey);
        }

        // Keep track of how many bytes we've written and stop if a threshold
        // is reached. If the content is too large, stop writing.
        if (cachedContentTooLarge !== true) {
          cacheWrittenLength += chunkLength(chunk, encoding);
          if (cacheWrittenLength > settings.maxContentCacheLength) {
            debug('content size greater than %s, stop writing', settings.maxContentCacheLength);
            cachedContentTooLarge = true;
          } else {
            contentWriteStream.write(chunk);
          }
        }
      });

      req.ext.eventEmitter.on('responseEnd', function() {
        if (!shouldWriteToCache) return;

        responseEnded = true;

        // If the cached content grew too large, we still need to end the stream.
        // But then immedieately delete it.
        if (cachedContentTooLarge === true) {
          debug('content too large, delete from cache');
          if (contentWriteStream) contentWriteStream.end();
          // Need to give a few ms for redisWStream to rename the key
          setTimeout(function() {
            settings.contentCache.del(req.__cacheKey + '-content');
          }, 10);
        } else {
          // Tack on the statusCode to the headers to store in the cache
          // and write it.
          hmsetArgs.push('statusCode', res.statusCode.toString());
          settings.contentCache.hmset(hmsetArgs);

          // If we have a contentWriteStream, now is the time to close it.
          if (contentWriteStream) contentWriteStream.end();
        }
      });

      router.use(loadHeadersFromCache);
      router.use(serveContentFromCache);
    }

    router(req, res, next);
  };

  function bypassCache(req, res) {
    if (req.method !== 'GET') return true;

    // Don't serve from cache if previous middleware has explicitly
    // set the statusCode to a non-200 value.
    if (_.isNumber(res.statusCode) && res.statusCode !== 200) return true;

    // if the special __nocache querystring parameter is set.
    if (req.query.__nocache === '1') return true;

    if (req.ext.user || req.ext.virtualEnv === 'local') return true;

    return false;
  }

  function generateETag(req) {
    // The etag is determined by hashing the stringified JSON versionId, and env variables.
    // Taken together they represent a unique hash of the html page response. The reason
    // the env variables are included is that they can change outside of a new version deployment.
    // Include the minimal amount of contextual data to maximize the cache hit rate.

    // TODO: Do we need to look at the Vary header?
    var normalizedUrl = req.protocol + '://' + req.hostname +
      helper.stripQuerystring(req.originalUrl);

    var accept = accepts(req);
    return etag(JSON.stringify({
      versionId: req.ext.virtualAppVersion.versionId,
      env: req.ext.env,
      url: normalizedUrl,
      encoding: accept.encoding(['gzip', 'deflate', 'identity'])
    }));
  }

  function shouldCache(req, res) {
    if (req.ext.contentCacheEnabled !== true) {
      debug('content cache is not enabled');
      return false;
    }

    // Only write certain status codes to cache
    if (!_.includes(cacheStatusCodes, res.statusCode)) {
      debug('status code %s not valid for caching', res.statusCode);
      return false;
    }

    // If the current response was already served from cache, don't write it again.
    if (req.ext.cacheHit === true) {
      debug('response already being served from cache');
      return false;
    }

    return true;
  }

  function preserveHeaderInCache(header) {
    if (_.includes(preserveHeaders, header.toLowerCase())) return true;
    if (_.startsWith(header, settings.customHttpHeaderPrefix) &&
      !_.endsWith(header, 'server-cache')) return true;
    return false;
  }

  // Return a 304 response if the content has not changed
  function conditionalGet(req, res, next) {
    // If the etag matches the if-none-match header,
    // return a 304 Not Modified response.
    if (req.get('if-none-match') === req.__etag) {
      // According to the RFC, the server should still send back the same
      // headers that would appear in a 200 response.
      // https://tools.ietf.org/html/rfc7232#section-4.1
      res.set('Cache-Control', 'no-cache');
      res.set('ETag', req.__etag);
      return res.status(304).end();
    }
    next();
  }

  function loadHeadersFromCache(req, res, next) {
    var cacheKey = req.__cacheKey + '-headers';
    debug('load headers key=%s', cacheKey);
    settings.contentCache.hgetall(cacheKey, function(err, headers) {
      if (err) return next(err);


      if (!headers) {
        debug('headers for %s do not exist', cacheKey);
        req.ext.cacheHit = false;
        settings.metrics.miss(HIT_RATE_METRIC);
        res.set(customHeader, 'miss ' + req.__cacheKey);
        return next();
      }

      // Convert the hash buffer values to strings
      headers = _.mapValues(headers, function(value) {
        return value.toString();
      });

      // If the cached header is a redirect.
      if (headers.statusCode === '301' || headers.statusCode === '302') {
        debug('following cached %s redirect to %s', headers.statusCode, headers.Location);
        settings.metrics.hit(HIT_RATE_METRIC);
        res.set(customHeader, 'hit ' + req.__cacheKey);

        // Strip querystring off of headers.Location. It should've already been stripped off
        // before caching, but just in case. Then tack on the current request's querystring
        // if there is one. We can do this because the querystring doesn't impact the server
        // response.
        var redirectUrl = helper.copyQuerystring(req.originalUrl,
          helper.stripQuerystring(headers.Location));

        return res.redirect(parseInt(headers.statusCode, 10), redirectUrl);
      }

      req.__headers = headers;
      next();
    });
  }

  function serveContentFromCache(req, res, next) {
    if (!req.__headers || req.__headers.statusCode !== '200') return next();

    var cacheKey = req.__cacheKey + '-content';
    debug('check if content exists in cache with key %s', req.__cacheKey);

    // Make sure the content exists in a seperate blob. It's possible that it got
    // purged and the headers entry was not.
    settings.contentCache.exists(cacheKey, function(err, exists) {
      if (err) return next(err);

      if (exists !== 1) {
        debug('cached content %s does not exist');
        settings.metrics.miss(HIT_RATE_METRIC);
        req.ext.cacheHit = false;
        res.set(customHeader, 'miss ' + req.__cacheKey);
        return next();
      }

      // Set the cached headers
      res.status(200);
      _.each(req.__headers, function(value, key) {
        if (key !== 'statusCode') res.set(key, value);
      });

      res.set(customHeader, 'hit ' + req.__cacheKey);
      debug('webpage read from cache with key %s', cacheKey);
      settings.metrics.hit(HIT_RATE_METRIC);
      req.ext.cacheHit = true;
      settings.contentCache.readStream(cacheKey).pipe(res);
    });
  }

  // Borrowed from https://github.com/expressjs/compression/blob/master/index.js
  function chunkLength(chunk, encoding) {
    if (!chunk) return 0;

    return !Buffer.isBuffer(chunk)
      ? Buffer.byteLength(chunk, encoding)
      : chunk.length;
  }
};
