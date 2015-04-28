var _ = require('lodash');
var async = require('async');
var querystring = require('querystring');
var versionRouter = require('../version-router');
var debug = require('debug')('4front:apphost:traffic-control');

require('simple-errors');

exports = module.exports = function(options) {
  options = _.defaults(options || {}, {
    versionCookieName: '_version',
    versionQueryParam: '_version',
    resetCommand: 'reset'
  });

  return function(req, res, next) {
    debug("traffic-control middleware");

    // Traffic rules are not applicable in development mode
    if (req.ext.virtualEnv === 'development' || req.ext.virtualEnv === 'dev')
      return next();

    // Look for an explicit version
    if (_.isEmpty(req.query[options.versionQueryParam]) === false) {
      var versionParam = req.query[options.versionQueryParam];

      // If the version parameter has the special value 'reset', clear the cookie and redirect
      if (versionParam === options.resetCommand) {
        res.clearCookie(options.versionCookieName);
        return res.redirect(getRedirectUrl(req));
      }

      // Set a cookie with the version info and redirect to
      // this same URL without the _version
      res.cookie(options.versionCookieName, JSON.stringify({
        versionId: req.query[options.versionQueryParam],
        method: 'urlOverride'
      }), {httpOnly: true});

      return res.redirect(getRedirectUrl(req));
    }

    var selectedVersion;

    async.series([
      function(cb) {
        // First look for a version in the cookie
        var versionInfo = req.cookies[options.versionCookieName];
        if (_.isEmpty(versionInfo))
          return cb();

        try {
          versionInfo = JSON.parse(versionInfo);
        }
        catch (err) {
          res.clearCookie(options.versionCookieName);
          debug("invalid version cookie");
          return cb();
        }

        req.app.settings.database.getVersion(req.ext.virtualApp.appId, versionInfo.versionId, function(err, version) {
          if (err) return cb(err);

          selectedVersion = version;
          if (!selectedVersion) {
            debug('version from cookie is not valid');
            return cb();
          }

          selectedVersion.method = versionInfo.method;
          cb();
        });
      },
      function(cb) {
        if (selectedVersion) return cb();

        var trafficRules = req.ext.virtualApp.trafficRules[req.ext.virtualEnv];

        // If there are no traffic rules configured for this environment, we have
        // no way to know which version to use, so throw a 404.
        if (_.isArray(trafficRules) === false || trafficRules.length == 0)
          return cb(Error.http(404, "No traffic rules configured for environment " + req.ext.virtualEnv, {code:"noTrafficRulesForEnvironment"}));

        debug("selecting version based on traffic rules");
        var versionId;
        try {
          versionId = versionRouter(trafficRules);
        }
        catch (err) {
          return cb(Error.http(404, err.message, err.data));
        }

        req.app.settings.database.getVersion(req.ext.virtualApp.appId, versionId, function(err, versionInfo) {
          if (err) return cb(err);

          debugger;
          if (!versionInfo)
            return cb(Error.http(404, "Version " + versionId + " from trafficRules is not valid", {code:"versionNotFound"}));

          selectedVersion = versionInfo;
          selectedVersion.method = 'trafficRules';

          cb();
        });
      }
    ], function(err) {
      if (err) return next(err);

      if (!selectedVersion)
        return next(Error.http(404, "Could not find a version of the app"));

      // Tack the version info onto the clientConfig
      if (req.ext.clientConfig) {
        _.extend(req.ext.clientConfig, {
          versionId: selectedVersion.versionId,
          versionName: selectedVersion.versionName,
          versionMethod: selectedVersion.method
        });
      }

      // Set custom http headers with the version info
      res.set('Virtual-App-Version-Id', selectedVersion.versionId);
      res.set('Virtual-App-Version-Name', selectedVersion.versionName);
      res.set('Virtual-App-Version-Method', selectedVersion.method);

      req.ext.virtualAppVersion = selectedVersion;

      next();
    });
  };

  function getRedirectUrl(req) {
    var query = _.omit(req.query, options.versionQueryParam);

    var redirectUrl = req.secure ? 'https' : 'http' + '://' + req.hostname + req.path;
    if (_.isEmpty(query) == false)
      redirectUrl += '?' + querystring.stringify(query);

    return redirectUrl;
  }
};
