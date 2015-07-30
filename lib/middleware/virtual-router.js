var express = require('express');
var async = require('async');
var debug = require('debug')('4front:apphost:virtual-router');
var _ = require('lodash');
var path = require('path');
var helper = require('../helper');

require('simple-errors');

var VALID_METHODS = ['get', 'put', 'all', 'delete', 'post'];

module.exports = function(options) {
  options = _.defaults(options || {}, {
    autoIncludeWebpagePlugin: true,
    builtInPluginsDir: [path.join(__dirname, "../plugins")]
  });

  var pluginLoader = require('../plugin-loader')(options);

  return function(req, res, next) {
    debug('executing');

    if (!req.ext.virtualAppVersion)
      return next();

    if (_.isObject(req.ext.virtualAppVersion.manifest) === false)
      req.ext.virtualAppVersion.manifest = {};

    var routerConfig = req.ext.virtualAppVersion.manifest.router;

    // If there is no router configured in the manifest, default
    // to just using the webpage module.
    if (_.isArray(routerConfig) === false)
      routerConfig = [];

    // If there is no instance of the webpage module declared in the router,
    // append it to the end of the array with the default options.
    if (options.autoIncludeWebpagePlugin === true && _.any(routerConfig, {module: "webpage"}) === false) {
      routerConfig.push({
        module: "webpage"
      });
    }

    var router = express.Router();

    for (var i=0; i<routerConfig.length; i++) {
      var routeInfo = routerConfig[i];

      debug("module %s", routeInfo.module);

      if (routeInfo.path && _.isString(routeInfo.method) === true) {
        routeInfo.method = routeInfo.method.toLowerCase();
        if (_.contains(VALID_METHODS, routeInfo.method) === false) {
          return next(Error.http(501, "Invalid method " + routeInfo.method + " for virtual route " + routeInfo.path, {
            code: "invalidVirtualRouteMethod"
          }));
        }
      }

      // Lazy instantiate the middleware in a wrapper function
      // so we know the route was a match.
      var wrapper = middlewareFn(routeInfo);

      if (_.isString(routeInfo.path))
        routeInfo.path = [routeInfo.path];

      if (_.isArray(routeInfo.path)) {
        routeInfo.path.forEach(function(path) {
          if (routeInfo.method)
            router[routeInfo.method](routeInfo.path, wrapper);
          else
            router.use(routeInfo.path, wrapper);
        });
      }
      else
        router.use(wrapper);
    }

    router(req, res, next);
  };

  function middlewareFn(routeInfo) {
    // Check if this middleware is a 4-arity error handling function
    var errorMiddleware = (routeInfo.errorHandler === true || routeInfo.module === "custom-errors");
    if (errorMiddleware) {
      return function(err, req, res, next) {
        realMiddleware(err, req, res, next);
      };
    }
    else {
      return function(req, res, next) {
        realMiddleware(null, req, res, next);
      }
    }

    function realMiddleware(_err, _req, _res, _next) {
      debug("load plugin %s", routeInfo.module);

      var optionError = expandOptionValues(routeInfo.options, _req.ext.env);
      if (optionError) {
        return _next(Error.http(501, "Could not expand options", {
          error: optionError.message,
          code: "virtualRouterOptionsError"
        }));
      }

      pluginLoader(routeInfo.module, routeInfo.options, function(pluginLoadError, pluginFunction) {
        if (pluginLoadError) {
          debug("could not load plugin %s: %s", routeInfo.module, pluginLoadError.message);

          return _next(Error.http(501, "Could not load plugin " + routeInfo.module, {
            code: pluginLoadError.code,
            plugin: routeInfo.module,
            error: pluginLoadError.message
          }));
        }

        pluginFunction.apply(null, _.compact([_err, _req, _res, _next]));
      });
    }
  }

  // Recurse through the options object and expand any special string
  // values like regex:* and env:*.
  function expandOptionValues(obj, env) {
    for (var key in obj) {
      // If the option key is is a string starting with 'env:' then
      // it indicates an environment variable.
      var optionValue = obj[key];
      if (_.isString(optionValue)) {
        if (optionValue.slice(0, 4) === 'env:') {
          var envVariable = optionValue.slice(4);
          if (_.has(env, envVariable) === false)
            return new Error("Invalid environment variable " + envVariable);

          obj[key] = env[envVariable].value;
        }
        else if (optionValue.slice(0, 6) === 'regex:') {
          try {
            obj[key] = new RegExp(optionValue.slice(6));
          }
          catch (err) {
            return new Error("Invalid RegExp " + optionValue.slice(6));
          }
        }
      }
      else if (_.isObject(optionValue)) {
        var err = expandOptionValues(optionValue, env);
        if (_.isError(err))
          return err;
      }
    }
    return null;
  }
};
