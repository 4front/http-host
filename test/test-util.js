/* eslint no-console: 0 */
var EventEmitter = require('events');
var util = require('util');
var sinon = require('sinon');
var metricDebug = require('debug')('metrics');

require('simple-errors');

// Test utility functions
module.exports.errorHandler = function(err, req, res, next) {
  if (!err.status) err.status = 500;

  res.statusCode = err.status;
  if (res.statusCode === 500 && err.log !== false) {
    console.log(err.stack);
    res.json(Error.toJson(err));
  } else {
    if (err.code) {
      res.set('Error-Code', err.code);
    }
    res.json(Error.toJson(err));
  }
};

module.exports.debugMetrics = function() {
  return {
    hit: sinon.spy(function(key) {
      metricDebug('hit %s', key);
    }),
    miss: sinon.spy(function(key) {
      metricDebug('miss %s', key);
    }),
    increment: sinon.spy(function(key) {
      metricDebug('increment %s', key);
    }),
    timing: function(key, ms) {
      metricDebug('timing %s - %s ms', key, Math.round(ms * 100) / 100);
    }
  };
};

function MockEventEmitter() {
  // Initialize necessary properties from `EventEmitter` in this instance
  EventEmitter.call(this);
}

// Inherit functions from `EventEmitter`'s prototype
util.inherits(MockEventEmitter, EventEmitter);

module.exports.EventEmitter = MockEventEmitter;
