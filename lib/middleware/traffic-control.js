var _ = require('lodash');
var async = require('async');
var querystring = require('querystring');
var versionRouter = require('../version-router');
var debug = require('debug')('4front:apphost:traffic-control');

require('simple-errors');

exports = module.exports = function(settings) {
  _.defaults(settings || {}, {
    versionCookieName: '_version',
    versionQueryParam: '_version',
    resetCommand: 'reset'
  });

  return function(req, res, next) {
    debug('traffic-control middleware');

    // Traffic rules are not applicable in development mode
    if (req.ext.virtualEnv === 'development' || req.ext.virtualEnv === 'dev') {
      return next();
    }

    var versionCookieName = (settings.cookiePrefix || '') + settings.versionCookieName;

    // Look for an explicit version
    if (_.isEmpty(req.query[settings.versionQueryParam]) === false) {
      var versionParam = req.query[settings.versionQueryParam];

      // If the version parameter has the special value 'reset', clear the cookie and redirect
      if (versionParam === settings.resetCommand) {
        res.clearCookie(versionCookieName);
        return res.redirect(getRedirectUrl(req));
      }

      // Set a cookie with the version info and redirect to
      // this same URL without the _version
      res.cookie(versionCookieName, JSON.stringify({
        versionId: req.query[settings.versionQueryParam],
        method: 'urlOverride'
      }), {httpOnly: true});

      return res.redirect(getRedirectUrl(req));
    }

    var selectedVersion;
    var versionId;
    var appId = req.ext.virtualApp.appId;

    async.series([
      function(cb) {
        // First look for a version in the cookie
        if (!_.isObject(req.cookies)) return cb();

        var versionInfo = req.cookies[versionCookieName];
        if (_.isEmpty(versionInfo)) return cb();

        try {
          versionInfo = JSON.parse(versionInfo);
        } catch (err) {
          res.clearCookie(versionCookieName);
          debug('invalid version cookie');
          return cb();
        }

        versionId = versionInfo.versionId;
        settings.database.getVersion(appId, versionId, function(err, version) {
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
        if (_.isArray(trafficRules) === false || trafficRules.length === 0) {
          return cb(Error.http(404, 'No version deployed to the ' + req.ext.virtualEnv + ' environment.', {
            virtualEnv: req.ext.virtualEnv,
            code: 'noDeployedVersion'
          }));
        }

        debug('selecting version based on traffic rules: %o', trafficRules);
        try {
          versionId = versionRouter(trafficRules);
        } catch (err) {
          return cb(Error.http(404, err.message, err.data));
        }

        settings.database.getVersion(appId, versionId, function(err, versionInfo) {
          if (err) return cb(err);

          if (!versionInfo) {
            return cb(Error.http(404, 'Invalid versionId ' + versionId, {
              versionId: versionId,
              code: 'invalidVersionId'
            }));
          }

          selectedVersion = versionInfo;
          selectedVersion.method = 'trafficRules';

          cb();
        });
      }
    ], function(err) {
      if (err) return next(err);

      if (!selectedVersion) {
        return next(Error.http(404, 'Could not find a version of the app'));
      }

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

      debug('settings virtual app version to %s', selectedVersion.versionId);
      req.ext.virtualAppVersion = selectedVersion;

      next();
    });
  };

  function getRedirectUrl(req) {
    var query = _.omit(req.query, settings.versionQueryParam);

    var redirectUrl = req.secure ? 'https' : 'http' + '://' + req.hostname + req.path;
    if (_.isEmpty(query) === false) {
      redirectUrl += '?' + querystring.stringify(query);
    }

    return redirectUrl;
  }
};
