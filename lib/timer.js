var _ = require('lodash');
var onFinished = require('on-finished');

module.exports = function(settings) {
  return {
    init: function(req, res, next) {
      req.ext.timers = {};

      onFinished(res, function(err) {
        // Report the results.
        // Any timers that don't have a duration should be marked as complete now.

        var now = Date.now();
        _.each(req.ext.timers, function(value) {
          if (!value.duration) {
            value.duration = now - value.started;
          }
        });

        settings.logger.info('Middleware timings', req.ext.timers);
      });

      next();
    },

    instrument: function(middleware, name) {
      return function(req, res, next) {
        var startTime = Date.now();
        req.ext.timers[name] = {started: startTime};

        middleware(req, res, function(err) {
          req.ext.timers[name].duration = Date.now() - startTime;
          next(err);
        });
      };
    }
  };
};
