var express = require('express');
var async = require('async');
var debug = require('debug')('4front:apphost:virtual-router');
var _ = require('lodash');
var path = require('path');
var helper = require('../helper');

require('simple-errors');

var VALID_METHODS = ['get', 'put', 'all', 'delete', 'post'];

module.exports = function(options) {
  return function(req, res, next) {
    debug('executing');

    if (!req.ext.virtualAppVersion)
      return next();

    if (_.isObject(req.ext.virtualAppVersion.manifest) === false)
      return next();

    var routerConfig = req.ext.virtualAppVersion.manifest.router;
    if (_.isArray(routerConfig) === false)
      return next();

    var router = express.Router();

    for (var i=0; i<routerConfig.length; i++) {
      var routeInfo = routerConfig[i];

      if (routeInfo.path && _.isString(routeInfo.method) === true) {
        routeInfo.method = routeInfo.method.toLowerCase();
        if (_.contains(VALID_METHODS, routeInfo.method) === false) {
          return next(Error.http(501, "Invalid method " + routeInfo.method + " for virtual route " + routeInfo.module));
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
    return function(req, res, next) {
      // TODO: expand environment variables in options
      // Also allow other plugins to be passed as options??
      var moduleRequirePath;
      if (routeInfo.module.slice(0, 7) === 'plugin:') {
        moduleRequirePath = path.join(req.app.settings.pluginsDir, routeInfo.module.slice(7));
      }
      else {
        // If the module is not a plugin, then require it with a local
        // path.
        moduleRequirePath = './' + routeInfo.module;
      }

      var module;
      try {
        debug('requiring middleware %s', moduleRequirePath);
        module = require(moduleRequirePath);
      }
      catch (err) {
        return next(Error.http(501, "Could not load the route module " + routeInfo.module));
      }

      if (_.isObject(routeInfo.options)) {
        var err = substituteEnv(routeInfo.options, req.ext.env);
        if (_.isError(err))
          return next(Error.http(400, err));
      }

      module(routeInfo.options || {})(req, res, next);
    };
  }

  function substituteEnv(obj, env) {
    for (var key in obj) {
      if (_.isString(obj[key])) {
        var match = obj[key].match(/^\$\{([A-Z_0-9\-]+)\}$/);
        if (match) {
          if (_.has(env, match[1]) === false)
            return new Error("Invalid environment variable " + match[1]);

          obj[key] = env[match[1]];
        }
      }
      else if (_.isObject(obj[key])) {
        var err = substituteEnv(obj[key], env);
        if (_.isError(err))
          return err;
      }
    }
    return null;
  }
};
