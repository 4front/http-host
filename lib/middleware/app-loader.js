var _ = require('lodash');
var debug = require('debug')('4front:apphost:app-loader');

require('simple-errors');

exports = module.exports = function(options) {
  options = _.defaults(options || {}, {});

  var requiredOptions = ['findApp', 'virtualHostDomain'];
  for (var i=0;i<requiredOptions.length;i++) {
    if (_.isUndefined(options[requiredOptions[i]]))
      throw new Error("Required option " + requiredOptions[i] + " not provided");
  }

  return function(req, res, next) {
    debug("virtualAppLoader middleware");

    if (_.isEmpty(req.hostname))
      return next(Error.http(404, "Missing Host header"));

    var appName;
    var virtualHost = req.hostname.toLowerCase();
    debug('virtualHost=%s', virtualHost);

    determineVirtualEnv(req);

    debug('virtualEnv=%s', req.ext.virtualEnv);

    // If the virtualHost does not contain the virtualHostDomain, then it must be a custom domain.
    if (req.ext.virtualHost.indexOf(options.virtualHostDomain) === -1) {
      debug("find app by custom domain %s", virtualHost);
      options.findApp({domain: req.ext.virtualHost}, findAppCallback);
    }
    else {
      // The app name is assumed to be the first part of the vhost, i.e. appname.virtualhost.com.
      var appName = req.ext.virtualHost.split('.')[0];
      debug("find app by name %s", appName);
      options.findApp({name: appName}, findAppCallback);
    }

    function findAppCallback(err, virtualApp) {
      if (err)
        return next(err);

      if (!virtualApp) {
        debug("virtual app %s not found", appName);
        return next(Error.http(404, 'Virtual application ' + appName + ' not found'));
      }

      // If this app requires SSL and this request is not secure, then 
      if (virtualApp.requireSsl === true) {
        debug("app must be requested via SSL");
        if (req.secure !== true) {
          return res.redirect('https://' + req.hostname + req.url);
        }
      }

      // Store the app in the req object for subsequent middleware
      req.ext.virtualApp = virtualApp;
      if (_.isObject(virtualApp.configSettings) === true) {
        if (_.isObject(req.ext.configSettings) === false)
          req.ext.configSettings = {};
        if (_.isObject(req.ext.clientConfig) === false)
          req.ext.clientConfig = {};
        if (_.isObject(req.ext.clientConfig.settings) === false)
          req.ext.clientConfig.settings = {};

        loadConfigSettings(req, virtualApp.configSettings._default);
        loadConfigSettings(req, virtualApp.configSettings[req.ext.virtualEnv]);

        // Delete the app's configSettings now that we've gotten the 
        // correct settings for this request's environment.
        virtualApp.configSettings = null;
      }

      // Set a custm 
      res.set('virtual-app-id', virtualApp.appId);

      debug("current virtual application is " + virtualApp.appId);
      next();
    }
  };

  function loadConfigSettings(req, appConfigSettings) {
    if (_.isObject(appConfigSettings) === false)
      return;

    for (var key in appConfigSettings) {
      var setting = appConfigSettings[key];

      if (_.isObject(setting) === false)
        continue;

      var value;
      // If the value looks like an environment variable, i.e. $ENVIRONMENT_VARIABLE
      if (_.isEmpty(setting.value) === false) {
        value = setting.value;
      }
      else if (_.isEmpty(setting.envVariable) === false) {
        // Check if a an envVariable function was provided
        if (_.isFunction(options.envVariable) === true)
          value = options.envVariable(req.ext.virtualApp, setting.envVariable);
        else
          value = process.env[setting.envVariable];
      }

      // If the setting has no value, skip it.
      if (_.isEmpty(value))
        continue;

      // If this value is safe to send to the client add it to the clientSettings
      if (setting.sendToClient === true)
        req.ext.clientConfig.settings[key] = value;

      req.ext.configSettings[key] = value;
    }
  }

  // Look for an environment indicator in the hostname which looks like appname--dev.virtualhost.com.
  // A double hyphen is valid and highly unlikely to conflict with an actual app name.
  // If none found, then assume 'prod'
  function determineVirtualEnv(req) {
    var match = req.hostname.match(/--([a-z]+)\./i);
    if (match && match.length === 2) {
      req.ext.virtualEnv = match[1];
      req.ext.virtualHost = req.hostname.toLowerCase().replace('--' + req.ext.virtualEnv, '');
      return;
    }

    // If no virtualEnv found in the hostname, default to 'prod'
    req.ext.virtualEnv = 'prod';
    req.ext.virtualHost = req.hostname.toLowerCase();
  }
};
