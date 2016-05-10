var _ = require('lodash');
var async = require('async');
var urlParse = require('url').parse;
var publicSuffixList = require('psl');
var debug = require('debug')('4front:http-host:app-loader');

require('simple-errors');

exports = module.exports = function(settings) {
  return function(req, res, next) {
    debug('virtualAppLoader middleware');

    if (_.isEmpty(req.hostname)) {
      return next(Error.http(404, 'Missing Host header'));
    }

    req.ext.virtualHost = req.hostname.toLowerCase();

    // Check if request is using the shared virtual hostname.
    var isCustomDomain = !_.endsWith(req.ext.virtualHost, settings.virtualHost);

    var loadFunc = isCustomDomain ? loadFromCustomDomain : loadFromSharedDomain;

    loadFunc(req, function(err, virtualApp) {
      if (err) {
        return next(err);
      }

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
        return handleNotFound(appNotFound);
      }

      // Store the app in the req object for subsequent middleware
      req.ext.virtualApp = virtualApp;

      if (req.ext.redirectToApp === true) {
        return redirectRequest(req, res);
      }

      // Check if this is an invalid virtual environment
      var appEnvironments = virtualApp.environments;
      if (_.isArray(appEnvironments) && !_.includes(appEnvironments, req.ext.virtualEnv)) {
        return handleNotFound(virtualEnvNotFound);
      }

      debug('virtualHost=%s virtualEnv=%s', req.ext.virtualHost, req.ext.virtualEnv);

      // If this app requires SSL and this request is not secure, then redirect to the https
      // equivalent.
      if (virtualApp.requireSsl === true && req.secure !== true) {
        debug('app must be requested via SSL');
        return redirectRequest(req, res);
      }

      // Get the environment variables specific to this virtual environment.
      // First take the global values and override with environment specific
      // values.
      if (_.isObject(virtualApp.env)) {
        req.ext.env = _.extend({}, virtualApp.env._global || {},
          virtualApp.env[req.ext.virtualEnv] || {});

        // Now that we have the environment variables
        delete virtualApp.env;
      } else {
        req.ext.env = {};
      }

      // If this app belongs to an org, store the orgId on the extended request.
      if (virtualApp.orgId) {
        debug('orgId=%s', virtualApp.orgId);
        req.ext.orgId = virtualApp.orgId;
      }

      // Set a custom virtual-app-id header
      res.set('virtual-app-id', virtualApp.appId);

      debug('current virtual application is ' + virtualApp.appId);
      next();
    });
  };

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

    // Tricky scenario is if there is a sub-domain without --. This could indicate either
    // an app with a subDomain or an apex domain where the subdomain is the virtualEnv, i.e.
    // test.domain.com. test.domain.com could be the production host for a website or 'test'
    // could be a virtual environment of domain.com. The production host, if it exists, takes
    // precedence.
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
    res.setHeader('Cache-Control', 'no-cache');
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

  function redirectRequest(req, res) {
    var redirectUrl;
    if (_.isObject(req.ext.virtualApp.urls)) {
      redirectUrl = req.ext.virtualApp.urls[req.ext.virtualEnv];
    }
    if (!redirectUrl) redirectUrl = req.ext.virtualApp.url;

    if (req.url !== '/') {
      redirectUrl += req.url;
    }
    res.set('Cache-Control', 'no-cache');
    return res.redirect(302, redirectUrl);
  }
};
