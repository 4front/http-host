var _ = require('lodash');
var bunyan = require('bunyan');

require('simple-errors');

var log = bunyan.createLogger({
  name: 'apphost-errors',
  streams: [
    {
      level: 'error',
      // Per 12 factor app log errors directly to stderr
      stream: process.stderr,
      serializers: {req: bunyan.stdSerializers.req}
    },
    {
      level: 'warn',
      // Per 12 factor app log errors directly to stderr
      stream: process.stderr,
      serializers: {req: bunyan.stdSerializers.req}
    }
  ]
});

module.exports = function(err, req) {
  // If the error for this request has already been logged, don't repeat.
  if (req.ext.errorLogged === true)
    return;

  if (_.isNumber(err.status) === false)
    err.status = 500;

  var logRecord = {
    // Only log errors that are not http errors or http errors with a
    // status of 500 or higher. No need to bloat the logs with deliberate 400 errors, etc.
    level: (err.status >= 500) ? 'error' : 'warn',
    err: Error.toJson(err)
  };

  // Augment the log record with some additional properties
  if (req.ext.virtualApp)
    logRecord.virtualApp = _.pick(req.ext.virtualApp, 'id', 'name');

  if (req.ext.virtualEnv)
    logRecord.virtualEnv = req.ext.virtualEnv;

  if (req.ext.virtualAppVersion)
    logRecord.virtualAppVersion = _.pick(req.ext.virtualAppVersion, 'versionId', 'name');

  // Indicate that this error has already been logged in case the next()
  // function is invoked.
  req.ext.errorLogged = true;
  log(logRecord);
};
