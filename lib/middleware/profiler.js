var debug = require('debug')('4front:http-host:profiler');
var onFinished = require('on-finished');

module.exports = function(settings) {
  return function(req, res, next) {
    if (!req.query.__profile) return next();

    debug('registering profiler with req.ext');
    req.ext.profiler = new Profiler();

    onFinished(res, function() {
      req.ext.profiler.finishAll();

      // Log the JSON profile dump
      settings.logger.info('request profiler', {
        code: 'requestProfiler',
        profiler: req.ext.profiler.toJSON()
      });
    });

    next();
  };
};

function Profiler() {
  debug('initialize _root node');
  this._root = new ProfilerNode('_root');
  this._currentContext = this._root;
  this._contextStack = [this._currentContext];
}

Profiler.prototype.start = function(key) {
  debug('start %s', key);
  var lastContext = this._contextStack[this._contextStack.length - 1];
  var newContext = new ProfilerNode(key);
  lastContext.append(newContext);
  this._contextStack.push(newContext);
};

Profiler.prototype.finish = function(key) {
  debug('finish %s', key);
  var currentContext = this._contextStack[this._contextStack.length - 1];
  if (key !== currentContext.key) {
    throw new Error('Mismatched context key ' + key);
  }

  currentContext.finish();
  // Pop the context off the stack
  this._contextStack.pop();
};

Profiler.prototype.finishAll = function() {
  while (this._contextStack.length) {
    this.finish(this._contextStack[this._contextStack.length - 1].key);
  }
};

Profiler.prototype.toJSON = function() {
  return this._root.toJSON();
};

function ProfilerNode(key) {
  this.key = key;
  this.start = Date.now();
}

ProfilerNode.prototype.append = function(nestedNode) {
  if (!this.nested) this.nested = [];
  this.nested.push(nestedNode);
};

ProfilerNode.prototype.finish = function() {
  this.finish = Date.now();
};

ProfilerNode.prototype.toJSON = function() {
  var json = {key: this.key, time: this.finish - this.start};
  if (this.nested) {
    json.nested = this.nested.map(function(nested) {
      return nested.toJSON();
    });
  }
  return json;
};
