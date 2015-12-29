var _ = require('lodash');
var path = require('path');
var debug = require('debug')('4front:http-host:plugin-loader');
var parameterNames = require('get-parameter-names');

require('simple-errors');

module.exports = function(settings) {
  _.defaults(settings, {
    builtInPluginsDir: ['./plugins']
  });

  // var pluginModuleCache = {};

  return function(pluginName, options, callback) {
    // var pluginModule = pluginModuleCache[pluginName];
    // if (pluginModule) {
    //   return callback(pluginFunction);
    // }

    var pluginModule = requirePlugin(pluginName);

    if (!pluginModule) {
      return callback(Error.create('Could not load plugin module ' + pluginName, {
        log: false,
        code: 'pluginLoadError'
      }));
    }

    // All plugins must be functions with a single argument
    if (_.isFunction(pluginModule) === false || pluginModule.length !== 1) {
      return callback(Error.create('Plugins must export a function with a single options argument.', {
        log: false,
        code: 'pluginInvalidExport'
      }));
    }

    var pluginFunction;
    try {
      pluginFunction = pluginModule(options);
    } catch (err) {
      return callback(Error.create('Error creating plugin', {
        code: 'pluginCreateError'
      }));
    }

    // plugins should return a middleware function with an arrity of 3 or 4.
    if (_.isFunction(pluginFunction) === false || validateSignature(pluginFunction) === false) {
      return callback(Error.create('Plugins must return a middleware function with an arrity of 3 or 4.', {
        code: 'pluginFunctionSignature'
      }));
    }

    callback(null, pluginFunction);
  };

  function requirePlugin(pluginName) {
    // First look to see if this is a built-in module.
    for (var i = 0; i < settings.builtInPluginsDir.length; i++) {
      var pluginPath = path.join(settings.builtInPluginsDir[i], pluginName);
      try {
        return require(pluginPath);
      } catch (err) {
        debug('could not load plugin from %s', pluginPath);
      }
    }

    try {
      // If this is not a built-in plugin, use the
      // standard node_modules based mechanism.
      return require(pluginName);
    } catch (err) {
      debug('could not load plugin from node_modules');
    }
    return null;
  }

  function validateSignature(func) {
    if (func.length < 3 || func.length > 4) {
      return false;
    }

    if (func.length === 3) {
      return _.isEqual(parameterNames(func), ['req', 'res', 'next']);
    }

    return _.isEqual(parameterNames(func), ['err', 'req', 'res', 'next']);
  }
};
