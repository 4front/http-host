var _ = require('lodash');
var debug = require('debug')('4front:apphost:app-loader');

require('simple-errors');

exports = module.exports = function(options) {
  options = _.defaults(options || {});

  return function(req, res, next) {
    debug('virtualAppLoader middleware');

    if (_.isEmpty(req.hostname)) {
      return next(Error.http(404, 'Missing Host header'));
    }

    var appName;
    var virtualHost = req.hostname.toLowerCase();
    debug('virtualHost=%s', virtualHost);

    determineVirtualEnv(req);

    debug('virtualEnv=%s', req.ext.virtualEnv);

    // If the req hostname does not contain the virtualHost for this 4front
    // instance, then it must be a custom domain.
    if (req.ext.virtualHost.indexOf(req.app.settings.virtualHost) === -1) {
      debug('find app by custom domain %s', virtualHost);
      req.app.settings.virtualAppRegistry.getByDomain(req.ext.virtualHost, appRegistryCallback);
    } else {
      // The app name is assumed to be the first part of the vhost, i.e. appname.virtualhost.com.
      appName = req.ext.virtualHost.split('.')[0];
      debug('find app by name %s', appName);
      req.app.settings.virtualAppRegistry.getByName(appName, appRegistryCallback);
    }

    function appRegistryCallback(err, virtualApp) {
      if (err) {
        return next(err);
      }

      if (!virtualApp) {
        debug('virtual app %s not found', appName);
        return next(Error.http(404, 'Virtual application ' + appName + ' not found'));
      }

      if (virtualApp.domain && virtualApp.domain.action === 'redirect') {
        debug('redirect domain %s to %s', virtualApp.domain.domain, virtualApp.url);
        return res.redirect(301, virtualApp.url);
      }

      // If this app requires SSL and this request is not secure, then
      if (virtualApp.requireSsl === true) {
        debug('app must be requested via SSL');
        if (req.secure !== true) {
          return res.redirect('https://' + req.hostname + req.url);
        }
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

      // Store the app in the req object for subsequent middleware
      req.ext.virtualApp = virtualApp;

      // If this app belongs to an org, store the orgId on the extended request.
      if (virtualApp.orgId) {
        debug('orgId=%s', virtualApp.orgId);
        req.ext.orgId = virtualApp.orgId;
      }

      // Set a custom virtual-app-id header
      res.set('virtual-app-id', virtualApp.appId);

      debug('current virtual application is ' + virtualApp.appId);
      next();
    }
  };

  // Look for an environment indicator in the hostname which looks
  // like appname--dev.virtualhost.com. A double hyphen is valid and
  // highly unlikely to conflict with an actual app name.
  // If none found, then assume 'prod'
  function determineVirtualEnv(req) {
    var match = req.hostname.match(/--([a-z]+)\./i);
    if (match && match.length === 2) {
      req.ext.virtualEnv = match[1];
      req.ext.virtualHost = req.hostname.toLowerCase().replace('--' + req.ext.virtualEnv, '');
      return;
    }

    // If no virtualEnv found in the hostname, default to the global setting
    // for this 4front instance.
    req.ext.virtualEnv = req.app.settings.defaultVirtualEnvironment;
    req.ext.virtualHost = req.hostname.toLowerCase();
  }
};
