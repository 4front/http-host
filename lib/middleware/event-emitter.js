var EventEmitter = require('events');
var util = require('util');

// Middleware that intercepts specific events during the request/response
// lifecycle and raises events that other middleware can subscribe to.
// This needs to declared in the middleware pipeline before the compression
// module which also monkeypatches the res.write and res.end functions.
module.exports = function(settings) {
  return function(req, res, next) {
    req.ext.eventEmitter = new _Emitter();
    var originalWrite = res.write;
    var originalEnd = res.end;

    res.write = function(chunk, encoding) {
      // Emit event with chunk.
      req.ext.eventEmitter.emit('responseWrite', chunk, encoding);
      originalWrite.apply(res, arguments);
    };

    res.end = function(chunk, encoding) {
      if (chunk) {
        req.ext.eventEmitter.emit('responseWrite', chunk, encoding);
      }
      req.ext.eventEmitter.emit('responseEnd');
      originalEnd.apply(res, arguments);
    };

    var originalSetHeader = res.setHeader;
    res.setHeader = function(header, value) {
      req.ext.eventEmitter.emit('responseHeader', header, value);
      originalSetHeader.apply(res, arguments);
    };

    res.status = function(code) {
      req.ext.eventEmitter.emit('responseStatus', code);
      res.statusCode = code;
      return res;
    };

    next();
  };
};

function _Emitter() {
  EventEmitter.call(this);
}

util.inherits(_Emitter, EventEmitter);
