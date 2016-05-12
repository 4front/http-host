var _ = require('lodash');
var async = require('async');
var querystring = require('querystring');
var versionRouter = require('../version-router');
var debug = require('debug')('4front:http-host:traffic-control');

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
    if (req.ext.virtualEnv === 'local') {
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

          if (!version) {
            debug('version from cookie is not valid');
            return cb();
          }

          selectedVersion = version;
          selectedVersion.method = versionInfo.method;
          cb();
        });
      },
      function(cb) {
        if (selectedVersion) return cb();

        getVersionFromTrafficRules(req, function(err, version) {
          if (err) return cb(err);

          if (version) {
            selectedVersion = version;
            selectedVersion.method = 'trafficRules';
          }
          cb();
        });
      }
    ], function(err) {
      if (err) return next(err);

      if (!selectedVersion) {
        var msg = 'No version deployed to the ' + req.ext.virtualEnv + ' environment.';
        return next(Error.http(404, msg, {
          virtualEnv: req.ext.virtualEnv,
          code: 'noDeployedVersion'
        }));
      }

      // Tack the version info onto the clientConfig
      if (req.ext.clientConfig) {
        _.extend(req.ext.clientConfig, {
          versionId: selectedVersion.versionId,
          versionName: selectedVersion.versionName,
          versionMethod: selectedVersion.method
        });
      }

      debug('settings virtual app version to %s', selectedVersion.versionId);
      req.ext.virtualAppVersion = selectedVersion;

      // Tack on custom headers with the version info
      var headerPrefix = settings.customHttpHeaderPrefix;
      res.set(headerPrefix + 'version-id', selectedVersion.versionId);
      res.set(headerPrefix + 'version-method', selectedVersion.method);
      if (!_.isEmpty(selectedVersion.name)) {
        res.set(headerPrefix + 'version-name', selectedVersion.name);
      }

      next();
    });
  };

  function getVersionFromTrafficRules(req, callback) {
    debug('get selected version from traffic rules');

    var trafficRules = req.ext.virtualApp.trafficRules;

    // If there are no traffic rules defined at all, then use the most recent version.
    if (!trafficRules) {
      debug('no traffic rules defined, use most recent version');
      return settings.database.mostRecentVersion(req.ext.virtualApp.appId, callback);
    }

    // Get the environment specific rules
    var envTrafficRules = trafficRules[req.ext.virtualEnv];

    // If there are traffic rules defined for the current virtual env.
    if (!envTrafficRules) {
      debug('No traffic rules defined for virtual env %s', req.ext.virtualEnv);
      return callback(null);
    }

    debug('selecting version based on traffic rules: %o', envTrafficRules);
    var versionId;
    try {
      versionId = versionRouter(envTrafficRules);
    } catch (err) {
      return callback(Error.http(404, err.message, err.data));
    }

    if (!versionId) {
      return callback(Error.http(404, 'No version found', {
        code: 'noVersionConfigured'
      }));
    }

    settings.database.getVersion(req.ext.virtualApp.appId, versionId, function(err, version) {
      if (err) return callback(err);

      if (!version) {
        return callback(Error.http(404, 'Invalid versionId ' + versionId, {
          versionId: versionId,
          code: 'invalidVersionId'
        }));
      }

      callback(null, version);
    });
  }

  function getRedirectUrl(req) {
    var query = _.omit(req.query, settings.versionQueryParam);

    var redirectUrl = req.secure ? 'https' : 'http' + '://' + req.hostname + req.path;
    if (_.isEmpty(query) === false) {
      redirectUrl += '?' + querystring.stringify(query);
    }

    return redirectUrl;
  }
};
