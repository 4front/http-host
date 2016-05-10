var debug = require('debug')('4front:http-host:instrument');
var onFinished = require('on-finished');

module.exports.middleware = function(middleware, name) {
  // Wrap the middleware execution with instrumentation
  debug('instrument wrapper for %s', name);
  return function(req, res, next) {
    if (!req.__timings) return middleware(req, res, next);

    req.__timings.start(name);

    middleware(req, res, function(err) {
      req.__timings.finish(name);
      next(err);
    });
  };
};

module.exports.start = function(req, key) {
  if (!req.__timings) return;
  req.__timings.start(key);
};

module.exports.finish = function(req, key) {
  if (!req.__timings) return;
  req.__timings.finish(key);
};

module.exports.init = function(settings) {
  // Middleware to initialize the timings
  return function(req, res, next) {
    // Only enable instrumentation if special querystring provided
    if (!req.query.__instrument) return next();

    req.__timings = new Timings();

    onFinished(res, function(err) {
      // Report the results.
      // Any timers that don't have a duration should be marked as complete now.
      req.__timings.finishAll();

      // Log the JSON profile dump
      settings.logger.info('instrumentation', {
        code: 'requestTimings',
        timings: req.__timings.toJSON()
      });
    });

    next();
  };
};

function Timings() {
  debug('initialize _root node');
  this._root = new TimingNode('_root');
  this._currentContext = this._root;
  this._contextStack = [this._currentContext];
}

Timings.prototype.start = function(key) {
  debug('start %s', key);
  var lastContext = this._contextStack[this._contextStack.length - 1];
  var newContext = new TimingNode(key);
  lastContext.append(newContext);
  this._contextStack.push(newContext);
};

Timings.prototype.finish = function(key) {
  debug('finish %s', key);

  // Search down the stack looking for a match.
  var keyIndex = -1;
  for (var i = this._contextStack.length - 1; i >= 0; i--) {
    if (this._contextStack[i].key === key) {
      keyIndex = i;
      break;
    }
  }

  if (keyIndex === -1) {
    throw new Error('No timing key for ' + key);
  }

  var currentContext = this._contextStack[keyIndex];

  // Remove the matching key from the stack
  this._contextStack.splice(keyIndex, 1);
  currentContext.finish();
};

Timings.prototype.finishAll = function() {
  while (this._contextStack.length) {
    this.finish(this._contextStack[this._contextStack.length - 1].key);
  }
};

Timings.prototype.toJSON = function() {
  return this._root.toJSON();
};

function TimingNode(key) {
  this.key = key;
  this.start = Date.now();
}

TimingNode.prototype.append = function(nestedNode) {
  if (!this.nested) this.nested = [];
  this.nested.push(nestedNode);
};

TimingNode.prototype.finish = function() {
  this.finish = Date.now();
};

TimingNode.prototype.toJSON = function() {
  var json = {key: this.key, time: this.finish - this.start};
  if (this.nested) {
    json.nested = this.nested.map(function(nested) {
      return nested.toJSON();
    });
  }
  return json;
};
