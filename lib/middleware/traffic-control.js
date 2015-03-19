var _ = require('lodash');
var async = require('async');
var debug = require('debug')('4front:apphost:traffic-control');

require('simple-errors');

exports = module.exports = function(options) {
  options = _.defaults(options || {}, {
    versionCookieName: '_version',
    versionQueryParam: '_version',
  });

  var requiredOptions = ['versionRepository'];
  for (var i=0;i<requiredOptions.length;i++) {
    if (_.isUndefined(options[requiredOptions[i]]))
      throw new Error("Required option " + requiredOptions[i] + " not provided");
  }

  return function(req, res, next) {
    debug("traffic-control middleware");

    // Traffic rules are not applicable in development mode
    if (req.ext.virtualEnv === 'development' || req.ext.virtualEnv === 'dev')
      return next();

    // Look for an explicit version
    if (_.isEmpty(req.query[options.versionQueryParam]) === false) {
      // Set a cookie then redirect to this same URL without the _version
      res.cookie(options.versionCookieName, req.query[options.versionQueryParam], {httpOnly: true});
      var query = _.omit(req.query, options.versionQueryParam);

      var redirectUrl = req.secure ? 'https' : 'http' + '://' + req.hostname + req.path;
      if (_.isEmpty(query) == false)
        redirectUrl += '?' + querystring.stringify(query);

      return res.redirect(redirectUrl);
    }

    var selectedVersion;
    async.series([
      function(cb) {
        // First look for a version in the cookie
        var versionId = req.cookies[options.versionCookieName];
        if (_.isEmpty(versionId))
          return cb();

        options.versionRepository.getVersionInfo(versionId, function(err, versionInfo) {
          if (err) return cb(err);

          selectedVersion = versionInfo;
          if (!selectedVersion)
            debug('version from cookie is not valid');

          cb();
        });
      },
      function(cb) {
        if (selectedVersion) return cb();

        if (_.isArray(req.ext.trafficControlRules) === false || req.ext.trafficControlRules.length == 0) {
          debug("no traffic control rules defined");
          return cb();
        }

        var versionId = randomlyAssignVersion(req.ext.trafficControlRules);
        options.versionRepository.getVersionInfo(versionId, function(err, versionInfo) {
          if (err) return cb(err);

          if (!versionInfo)
            return cb(Error.http(404, "Version " + versionId + " from trafficControlRules is not valid"));

          selectedVersion = versionInfo;
          cb();
        });
      },
      function(cb) {
        if (selectedVersion) return cb();

        options.versionRepository.mostRecentVersionInfo(req.ext.virtualEnv, function(err, version) {
          if (err) return cb(err);

          selectedVersion = version;
          cb();
        });
      }
    ], function(err) {
      if (err) return next(err);

      if (!selectedVersion)
        return next(Error.http(404, "Could not find a version of the app"));

      req.ext.virtualAppVersion = selectedVersion;
      next();
    });
  };

  function randomlyAssignVersion(trafficControlRules) {
    // Randomly select a version
    debug("randomly assigning a version based on traffic control rules");

    var randomizer = _.random(0, 1, true);
    var start = 0;
    var i = 0;
    while (true) {
      if (randomizer <= start + parseFloat(trafficControlRules[i].traffic)) {
        return trafficControlRules[i].versionId;
        break;
      }

      i++;
      start += parseFloat(trafficControlRules[i].traffic);
    }
  }
};
