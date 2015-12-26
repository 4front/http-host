var zlib = require('zlib');
var debug = require('debug')('4front:compress');
var compressible = require('compressible');
var accepts = require('accepts');
var vary = require('vary');
var through = require('through2');

module.exports = function() {
  return function(req, res, next) {
    var ended = false;
    var write = res.write;
    var on = res.on;
    var end = res.end;
    var responseStream;

    on.call(res, 'drain', function() {
      ensureResponseStream();
      responseStream.resume();
    });

    function ensureResponseStream() {
      if (responseStream) return;

      var contentType = res.getHeader('Content-Type');
      if (!compressible(contentType)) {
        noCompress('Content-Type ' + contentType + ' is not compressible');
        responseStream = through();
      } else if (req.method === 'HEAD') {
        noCompress('no compression of head requests');
        responseStream = through();
      } else {
        var contentEncoding = res.getHeader('Content-Encoding');
        var clientAcceptsGzip = accepts(req).encoding(['gzip']) === 'gzip';
        if (contentEncoding === 'gzip' && !clientAcceptsGzip) {
          // If the response is gzipped but the client doesn't accept, we need to gunzip.
          res.removeHeader('Content-Encoding');
          responseStream = zlib.createGunzip();
        } else if (contentEncoding !== 'gzip' && clientAcceptsGzip) {
          res.setHeader('Content-Encoding', 'gzip');
          responseStream = zlib.createGzip();
        } else {
          noCompress('No action necessary');
          responseStream = through();
        }
      }

      responseStream.on('data', function(chunk) {
        if (write.call(res, chunk) === false) {
          responseStream.pause();
        }
      });

      responseStream.on('end', function() {
        end.call(res);
      });

      res.removeHeader('Content-Length');
      vary(res, 'Accept-Encoding');
    }

    res.write = function(chunk, enc) {
      ensureResponseStream();

      if (ended) {
        return false;
      }

      responseStream.write(new Buffer(chunk, enc));
    };

    res.end = function(chunk, enc) {
      ensureResponseStream();
      ended = true;
      return chunk
        ? responseStream.end(new Buffer(chunk, enc))
        : responseStream.end();
    };

    res.flush = function() {
      ensureResponseStream();
      responseStream.flush();
    };

    next();
  };
};

function noCompress(msg) {
  debug('no compression: %s', msg);
}
