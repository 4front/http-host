var _ = require('lodash');
var express = require('express');
var async = require('async');
var ms = require('ms');
var urlParse = require('url').parse;
var urljoin = require('url-join');
var versionRouter = require('../version-router');
var publicSuffixList = require('psl');
// var helper = require('../helper');
var debug = require('debug')('4front:http-host:app-context-loader');

require('simple-errors');

var CACHE_HIT_RATE_METRIC = 'app-cache-hitrate';
var CONTEXT_CACHE_PROPS = ['virtualApp', 'virtualAppVersion',
  'virtualEnv', 'subDomain', 'apexDomain', 'virtualHost', 'env'];

var CACHE_TTL = ms('72h') / 1000;

exports = module.exports = function(settings) {
  return function(req, res, next) {
    if (_.isEmpty(req.hostname)) {
      return next(Error.http(404, 'Missing Host header'));
    }

    req.ext.virtualHost = req.hostname.toLowerCase();

    var router = express.Router();
    router.use(loadContextFromCache);
    router.use(loadApplication);
    router.use(loadVersion);
    router.use(writeToCache);
    router.use(finalizeContext);
    router(req, res, next);
  };

  function loadContextFromCache(req, res, next) {
    if (req.ext.appCacheEnabled !== true) return next();

    var cacheKey = req.ext.virtualHost;
    debug('check cache for app context %s', cacheKey);
    settings.cache.get(cacheKey, function(err, json) {
      if (err || !json) {
        if (err) {
          settings.logger.warn('Error fetching app from cache: %s', err.message);
        } else {
          debug('app context %s not in cache', cacheKey);
        }
        req.ext.appCacheHit = false;
        settings.metrics.miss(CACHE_HIT_RATE_METRIC);
        return next();
      }

      var appContext;
      debug('try parsing cache value as json');
      try {
        appContext = JSON.parse(json);
      } catch (jsonError) {
        settings.logger.error('Error parsing app json', {virtualHost: req.ext.virtualHost});
        return next();
      }

      req.ext.appCacheHit = true;
      settings.metrics.hit(CACHE_HIT_RATE_METRIC);

      if (appContext.redirect) {
        var redirectUrl = urljoin(appContext.redirect.location, req.originalUrl);
        return res.redirect(appContext.redirect.statusCode, redirectUrl);
      }

      // If this app requires SSL and this request is not secure, then redirect to the https
      // equivalent.
      if (appContext.virtualApp.requireSsl === true && req.secure !== true) {
        debug('app must be requested via SSL');
        return redirectRequest(req, res, false);
      }

      // Extend req.ext with data from the cache
      _.assign(req.ext, _.pick(appContext, CONTEXT_CACHE_PROPS));

      next();
    });
  }

  function writeToCache(req, res, next) {
    // Don't write to the cache wildcard matches
    // since this could cause the cache to be flooded
    // with hundreds, thousands, etc. of permutations of the same app.
    if (req.ext.appCacheHit === true || req.ext.subDomain === '*') {
      debug('do not write app context to cache');
      return next();
    }

    var cacheKey = req.hostname.toLowerCase();
    // Write certain properties to the cache.
    debug('write app context to cache key=%s', cacheKey);
    settings.cache.setex(cacheKey, CACHE_TTL,
      JSON.stringify(_.pick(req.ext, CONTEXT_CACHE_PROPS)));
    next();
  }

  function finalizeContext(req, res, next) {
    // If this app belongs to an org, store the orgId on the extended request.
    if (req.ext.virtualApp.orgId) {
      debug('orgId=%s', req.ext.virtualApp.orgId);
      req.ext.orgId = req.ext.virtualApp.orgId;
    }

    var version = req.ext.virtualAppVersion;

    // Set a custom http headers
    var headerPrefix = settings.customHttpHeaderPrefix;
    res.set(headerPrefix + 'app-id', req.ext.virtualApp.appId);
    res.set(headerPrefix + 'version-id', version.versionId);

    if (process.env.NODE_ENV === 'development') {
      res.set('app-cache', req.ext.appCacheHit ? 'hit' : 'miss');
    }

    if (!_.isEmpty(version.name)) {
      res.set(headerPrefix + 'version-name', version.name);
    }

    // Tack the version info onto the clientConfig
    if (req.ext.clientConfig) {
      _.extend(req.ext.clientConfig, {
        versionId: version.versionId,
        versionName: version.versionName
      });
    }

    debug('current app context appId=%s, versionId=%s, virtualEnv=%s',
      req.ext.virtualApp.appId, version.versionId, req.ext.virtualEnv);
    next();
  }

  function loadApplication(req, res, next) {
    // If we already have the virtualApp, skip this middleware function
    if (req.ext.virtualApp) return next();

    debug('load application %s from registry', req.ext.virtualHost);
    // Check if request is using the shared virtual hostname.
    var isCustomDomain = !_.endsWith(req.ext.virtualHost, settings.virtualHost);

    var loadFunc = isCustomDomain ? loadFromCustomDomain : loadFromSharedDomain;
    loadFunc(req, function(err, virtualApp) {
      if (err) return next(err);

      var handleNotFound = function(notFound) {
        if (isCustomDomain) {
          // Check if there is a custom domain catch-all redirect.
          getCatchAllRedirect(req, function(_err, redirectUrl) {
            if (_err) return next(_err);
            if (redirectUrl) {
              redirectToCatchAll(res, redirectUrl);
            } else {
              notFound(req, res, next);
            }
          });
        } else {
          notFound(req, res, next);
        }
      };

      // If app could not be loaded
      if (!virtualApp) {
        // TODO: Should we cache that this is 404?
        return handleNotFound(appNotFound);
      }

      // Store the app in the req object for subsequent middleware
      req.ext.virtualApp = virtualApp;

      if (req.ext.redirectToApp === true) {
        return redirectRequest(req, res, true);
      }

      // Check if this is an invalid virtual environment
      var appEnvironments = virtualApp.environments;
      if (_.isArray(appEnvironments) && !_.includes(appEnvironments, req.ext.virtualEnv)) {
        return handleNotFound(virtualEnvNotFound);
      }

      // If this app requires SSL and this request is not secure, then redirect to the https
      // equivalent.
      if (virtualApp.requireSsl === true && req.secure !== true) {
        debug('app must be requested via SSL');
        return redirectRequest(req, res, false);
      }

      // Get the environment variables specific to this virtual environment.
      // First take the global values and override with environment specific
      // values.
      if (_.isObject(virtualApp.env)) {
        debug('load env variables for virtualEnv %s', req.ext.virtualEnv);
        req.ext.env = _.extend({}, virtualApp.env._global || {},
          virtualApp.env[req.ext.virtualEnv] || {});

        // Now that we have the environment variables
        delete virtualApp.env;
      } else {
        req.ext.env = {};
      }

      next();
    });
  }

  function loadFromSharedDomain(req, callback) {
    // The app name is assumed to be the first part of the vhost, i.e. appname.virtualhost.com.
    var appName = req.ext.virtualHost.split('.')[0];
    if (appName.indexOf('--') !== -1) {
      var parts = appName.split('--');
      appName = parts[0];
      req.ext.virtualEnv = parts[1];
      req.ext.virtualHost = appName + '.' + settings.virtualHost;
    } else {
      req.ext.virtualEnv = settings.defaultVirtualEnvironment;
    }

    debug('find app by name %s', appName);
    settings.virtualAppRegistry.getByName(appName, callback);
  }

  function loadFromCustomDomain(req, callback) {
    var parsedDomain = publicSuffixList.parse(req.ext.virtualHost);
    var domainName = parsedDomain.domain;
    var subDomain = parsedDomain.subdomain || '@';

    if (!domainName) return callback(new Error('Parsed domainName is null'));

    debug('load app from custom domain %s.%s', subDomain, domainName);
    req.ext.domainName = domainName;

    // If this is an apex domain, then it must be production env.
    if (subDomain === '@') {
      req.ext.subDomain = '@';
      return loadFromApexDomain(req, domainName, callback);
    }

    // If the subDomain contains "--" then it must be an app with a subDomain
    // and a virtualEnv like subdomain--test.domain.com.
    if (subDomain.indexOf('--') !== -1) {
      var parts = subDomain.split('--');
      req.ext.virtualEnv = parts[1];
      subDomain = parts[0];

      req.ext.subDomain = subDomain;
      req.ext.virtualHost = parts[0] + '.' + domainName;
      return settings.virtualAppRegistry.getByDomain(domainName, subDomain, callback);
    }
    req.ext.subDomain = subDomain;

    var virtualApp;

    // Tricky scenario is if there is a sub-domain without --. This could indicate one of
    // three different scenarios:
    // 1. Production app mounted to a sub-domain of the custom domain, i.e. appname.domain.com
    // 2. Production app mounted to a wildcard subdomain, i.e. client-name.domain.com
    // 3. Virtual environment of an apex domain, i.e. test.domain.com
    // Evaluate the three scenarios in that order.
    async.series([
      function(cb) {
        settings.virtualAppRegistry.getByDomain(domainName, subDomain, function(err, app) {
          if (err) return callback(err);
          if (app) {
            req.ext.subDomain = subDomain;
            req.ext.virtualEnv = settings.defaultVirtualEnvironment;
            virtualApp = app;
          }
          cb();
        });
      },
      function(cb) {
        if (virtualApp) return cb();
        settings.virtualAppRegistry.getByDomain(domainName, '*', function(err, app) {
          if (err) return cb(err);

          if (app) {
            debug('matched app with wildcard domain');
            req.ext.subDomain = '*';
            req.ext.virtualEnv = settings.defaultVirtualEnvironment;
            virtualApp = app;
          }
          cb();
        });
      },
      function(cb) {
        if (virtualApp) return cb();
        settings.virtualAppRegistry.getByDomain(domainName, '@', function(err, app) {
          if (err) return cb(err);

          if (app) {
            virtualApp = app;

            // Special case for www. Don't treat it as a virtualEnv, instead redirect
            // to the apex.
            if (subDomain === 'www') {
              req.ext.redirectToApp = true;
            } else {
              req.ext.virtualEnv = subDomain;
              req.ext.virtualHost = domainName;
              req.ext.subDomain = '@';
            }
          }
          cb();
        });
      }
    ], function(err) {
      callback(err, virtualApp);
    });
  }

  function loadFromApexDomain(req, domainName, callback) {
    req.ext.apexDomain = true;
    req.ext.virtualEnv = settings.defaultVirtualEnvironment;

    async.waterfall([
      function(cb) {
        settings.virtualAppRegistry.getByDomain(domainName, '@', cb);
      },
      function(app, cb) {
        if (app) return cb(null, app);

        // If there is no website on the apex, look for a subdomain starting with 'www'
        // to redirect to.
        settings.virtualAppRegistry.getByDomain(domainName, 'www', function(err, _app) {
          if (err) return cb(err);

          if (_app) req.ext.redirectToApp = true;
          cb(null, _app);
        });
      }
    ], callback);
  }

  function loadVersion(req, res, next) {
    if (req.ext.virtualAppVersion) return next();

    debug('get selected version from traffic rules');
    var trafficRules = req.ext.virtualApp.trafficRules;

    // If there are no traffic rules defined at all, then use the most recent version.
    if (!trafficRules) {
      debug('no traffic rules defined, use most recent version');
      return settings.database.mostRecentVersion(req.ext.virtualApp.appId, function(err, version) {
        if (err) return next(err);
        req.ext.virtualAppVersion = version;
        return next();
      });
    }

    // Get the environment specific rules
    var envTrafficRules = trafficRules[req.ext.virtualEnv];

    // If there are traffic rules defined for the current virtual env.
    if (_.isEmpty(envTrafficRules)) {
      debug('No traffic rules defined for virtual env %s', req.ext.virtualEnv);
      return next(Error.http(404, 'No version defined for env ' + req.ext.virtualEnv, {
        code: 'noTrafficRulesForEnv'
      }));
    }

    debug('selecting version based on traffic rules: %o', envTrafficRules);
    var versionId;
    try {
      versionId = versionRouter(envTrafficRules);
    } catch (err) {
      return next(Error.http(404, err.message, err.data));
    }

    if (!versionId) {
      return next(Error.http(404, 'No version found', {
        code: 'noVersionConfigured'
      }));
    }

    settings.database.getVersion(req.ext.virtualApp.appId, versionId, function(err, version) {
      if (err) return next(err);

      if (!version) {
        return next(Error.http(404, 'Invalid versionId ' + versionId, {
          versionId: versionId,
          code: 'invalidVersionId'
        }));
      }

      req.ext.virtualAppVersion = version;
      next();
    });
  }

  function getCatchAllRedirect(req, callback) {
    // If this is a custom domain check if the domain has a catchAllRedirect
    debug('look for catch-all redirect for domain %s', req.ext.domainName);
    settings.database.getDomain(req.ext.domainName, function(err, domain) {
      if (err) return callback(err);

      // If the domain doesn't exist or there is not catch-all redirect, return 404.
      if (!domain || _.isEmpty(domain.catchAllRedirect)) {
        return callback();
      }

      var preservePathQuery = urlParse(domain.catchAllRedirect).path === '/';
      var redirectUrl = domain.catchAllRedirect;
      if (preservePathQuery && req.originalUrl !== '/') {
        redirectUrl += req.originalUrl;
      }

      callback(null, redirectUrl);
    });
  }

  function redirectToCatchAll(res, redirectUrl) {
    debug('redirect to catch-all url %s', redirectUrl);
    res.set('Cache-Control', settings.noCacheHttpHeader);
    res.redirect(302, redirectUrl);
  }

  function appNotFound(req, res, next) {
    debug('virtual app %s not found', req.ext.virtualHost);
    return next(Error.http(404, 'Virtual application ' + req.ext.virtualHost + ' not found',
      {code: 'virtualAppNotFound'}));
  }

  function virtualEnvNotFound(req, res, next) {
    debug('invalid environment %s', req.ext.virtualEnv);
    return next(Error.http(404, 'Invalid environment ' + req.ext.virtualEnv, {
      code: 'invalidVirtualEnv'
    }));
  }

  function redirectRequest(req, res, cacheRedirect) {
    var redirectBaseUrl;
    if (_.isObject(req.ext.virtualApp.urls)) {
      redirectBaseUrl = req.ext.virtualApp.urls[req.ext.virtualEnv];
    }
    if (!redirectBaseUrl) redirectBaseUrl = req.ext.virtualApp.url;

    var redirectUrl = redirectBaseUrl;
    if (req.originalUrl !== '/') {
      redirectUrl += req.originalUrl;
    }

    // Write the redirect to the cache.
    if (cacheRedirect === true) {
      debug('write redirect to cache');
      settings.cache.setex(req.ext.virtualHost, CACHE_TTL, JSON.stringify({
        redirect: {
          statusCode: 302,
          location: redirectBaseUrl
        }
      }));
    }

    res.set('Cache-Control', settings.noCacheHttpHeader);
    return res.redirect(302, redirectUrl);
  }
};
