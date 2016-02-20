var express = require('express');
var debug = require('debug')('4front:http-host:virtual-router');
var _ = require('lodash');
var timer = require('express-middleware-timer');

require('simple-errors');

var VALID_METHODS = ['get', 'put', 'all', 'delete', 'post'];

var BUILT_IN_PLUGINS = ['basic-auth', 'authorized',
  'basic-auth2', 'client-settings', 'custom-errors', 'logout',
  'redirect', 'session', 'webpage'];

// Names of the top-level manifest properties that should
// be passed along to every plugin.
var TOP_LEVEL_PLUGIN_OPTS = ['clientConfigVar'];

var catchAll404 = function(req, res, next) {
  next(Error.http(404, 'Page not found'));
};

module.exports = function(settings) {
  _.defaults(settings || {}, {
    autoIncludeWebpagePlugin: true,
    builtInPlugins: BUILT_IN_PLUGINS,
    builtInPluginsPath: './plugins/'
  });

  var pluginOptions = require('../plugin-options')(settings);
  var pluginLoader = require('../plugin-loader')(settings);
  var staticAssetMiddleware = require('./static-asset')(settings);

  return function(req, res, next) {
    debug('executing');

    if (!req.ext.virtualAppVersion) return next();

    if (_.isObject(req.ext.virtualAppVersion.manifest) === false) {
      req.ext.virtualAppVersion.manifest = {};
    }

    var routerConfig = req.ext.virtualAppVersion.manifest.router;

    // If there is no router configured in the manifest, default
    // to just using the webpage module.
    if (_.isArray(routerConfig) === false) {
      routerConfig = [];
    }

    // If there is no instance of the webpage module declared in the router,
    // append it to the end of the array with the default options.
    if (settings.autoIncludeWebpagePlugin && _.any(routerConfig, {module: 'webpage'}) === false) {
      routerConfig.push({
        method: 'GET',
        module: 'webpage'
      });
    }

    // Insert the static-asset and ignore-request middleware immediately
    // before the webpage. The ignore-request must come after any possible
    // custom middleware that needs to handle requests that would otherwise
    // be caught by ignore-request. For example the redirect plugin might want
    // to redirect .php requests.
    var webPageIndex = _.findIndex(routerConfig, {module: 'webpage'});
    routerConfig.splice(webPageIndex, 0, {
      name: 'static-asset',
      method: 'GET',
      module: staticAssetMiddleware
    }, {
      name: 'ignore-request',
      module: require('./ignore-request')(settings)
    });

    var routeCategories;
    try {
      routeCategories = categorizeRoutes(routerConfig);
    } catch (err) {
      return next(err);
    }

    var router = express.Router();

    // Append the standard routes first
    appendRoutes(req, router, routeCategories.standard);

    // Put catchAll404 between the standard routes
    // and error routes so that a 404 http error is available
    // for custom error middleware.
    router.all('*', catchAll404);

    // Append the error handlers last
    appendRoutes(req, router, routeCategories.errors);

    router(req, res, next);
  };

  function routeValidForEnv(req, routeInfo) {
    if (!_.isArray(routeInfo.environments)) return true;

    // If this route specifies a list of environments, ensure that the current environment
    // appears in the list.
    return _.any(routeInfo.environments, function(env) {
      if (env === req.ext.virtualEnv) return true;
      if (env.slice(-1) === '*' && env.slice(1, -1) === req.ext.virtualEnv) return true;
      return false;
    });
  }

  function appendRoutes(req, router, routerConfig) {
    for (var i = 0; i < routerConfig.length; i++) {
      var routeInfo = routerConfig[i];

      // If this route is not valid for the current environment, skip it.
      if (!routeValidForEnv(req, routeInfo)) continue;

      var middlewareFn;
      // routeInfo.module is already a function in the case of static-asset.
      if (_.isFunction(routeInfo.module)) {
        middlewareFn = routeInfo.module;
      } else {
        routeInfo.name = routeInfo.module;
        debug('append module %s to virtual router', routeInfo.module);
        // Lazy instantiate the middleware in a wrapper function
        // so we know the route was a match.
        middlewareFn = timer.instrument(lazyMiddlewareWrapper(routeInfo));
      }

      if (_.isString(routeInfo.path)) {
        routeInfo.path = [routeInfo.path];
      }

      if (_.isArray(routeInfo.path)) {
        for (var pathIndex = 0; pathIndex < routeInfo.path.length; pathIndex++) {
          if (routeInfo.method) {
            debug('router.' + routeInfo.method + '("' + routeInfo.path[pathIndex] + '", ' + routeInfo.name + ')');
            router[routeInfo.method](routeInfo.path[pathIndex], middlewareFn);
          } else {
            debug('router.use(\'' + routeInfo.path[pathIndex] + '\', ' + routeInfo.name + ')');
            router.use(routeInfo.path[pathIndex], middlewareFn);
          }
        }
      } else {
        debug('router.use(' + routeInfo.name + ')');
        router.use(middlewareFn);
      }
    }
  }

  // Examine the order of plugins in the router and ensure
  // that error handlers come last.
  function categorizeRoutes(routerConfig) {
    var routes = {standard: [], errors: []};

    for (var i = 0; i < routerConfig.length; i++) {
      var routeInfo = routerConfig[i];
      if (routeInfo.path && _.isString(routeInfo.method) === true) {
        routeInfo.method = routeInfo.method.toLowerCase();
        if (_.contains(VALID_METHODS, routeInfo.method) === false) {
          throw Error.http(500, 'Invalid method ' + routeInfo.method + ' for virtual route ' + routeInfo.path, {
            code: 'invalidVirtualRouteMethod',
            log: false
          });
        }
      }

      if (routeInfo.module === 'custom-errors') {
        routeInfo.errorHandler = true;
      }

      if (routeInfo.errorHandler === true) {
        routes.errors.push(routeInfo);
      } else {
        routes.standard.push(routeInfo);
      }
    }

    return routes;
  }

  function lazyMiddlewareWrapper(routeInfo) {
    // Check if this middleware is a 4-arity error handling function
    if (routeInfo.errorHandler === true) {
      return function(err, req, res, next) {
        realMiddleware(err, req, res, next);
      };
    }

    return function(req, res, next) {
      realMiddleware(null, req, res, next);
    };

    function realMiddleware(_err, _req, _res, _next) {
      debug('load plugin %s', routeInfo.module);

      var expandedOptions;
      try {
        expandedOptions = pluginOptions(routeInfo.options, _req.ext);
      } catch (err) {
        debug('error expanding options for plugin ' + routeInfo.module);
        return _next(Error.http(500, err.message, err.data));
      }

      // Merge the top level options and the plugin specific options. Allow options
      // declared at the plugin level to override the top level options if there
      // is a naming collision.
      var topLevelOptions = _.pick(_req.ext.virtualAppVersion.manifest, TOP_LEVEL_PLUGIN_OPTS);
      var mergedOptions = _.extend(topLevelOptions, expandedOptions);

      // TODO: Allow overriding options with special debug querystring parameters.

      pluginLoader(routeInfo.module, mergedOptions, function(pluginErr, pluginFunction) {
        if (pluginErr) {
          debug('could not load plugin %s: %s', routeInfo.module, pluginErr.message);
          return _next(pluginErr);
        }

        pluginFunction.apply(null, _.compact([_err, _req, _res, _next]));
      });
    }
  }
};
