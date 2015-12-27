/* eslint no-console: 0 */
var EventEmitter = require('events');
var util = require('util');

// Test utility functions
module.exports.errorHandler = function(err, req, res, next) {
  if (!err.status) err.status = 500;

  res.statusCode = err.status;
  if (res.statusCode === 500) {
    console.log(err.stack);
    res.end(err.stack);
  } else {
    if (err.code) {
      res.set('Error-Code', err.code);
    }
    res.send(err.toString());
  }
};

function MockEventEmitter() {
  // Initialize necessary properties from `EventEmitter` in this instance
  EventEmitter.call(this);
}

// Inherit functions from `EventEmitter`'s prototype
util.inherits(MockEventEmitter, EventEmitter);

module.exports.EventEmitter = MockEventEmitter;
