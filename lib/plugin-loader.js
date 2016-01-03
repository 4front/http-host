var _ = require('lodash');
var debug = require('debug')('4front:http-host:plugin-loader');
var parameterNames = require('get-parameter-names');

require('simple-errors');

module.exports = function(settings) {
  return function(pluginName, options, callback) {
    var pluginModule;
    try {
      pluginModule = requirePlugin(pluginName);
    } catch (err) {
      return callback(Error.create('Could not require plugin', {
        log: false,
        plugin: pluginName,
        code: 'pluginRequireError',
        error: err.stack
      }));
    }

    // All plugins must be functions with a single argument
    if (_.isFunction(pluginModule) === false || pluginModule.length !== 1) {
      debug('invalid plugin export %s', pluginName);
      return callback(Error.create('Plugins must export a function with a single options argument.', {
        log: false,
        plugin: pluginName,
        code: 'pluginInvalidExport'
      }));
    }

    var pluginFunction;
    try {
      pluginFunction = pluginModule(options);
    } catch (err) {
      debug('error creating plugin %s', pluginName);
      return callback(Error.create(err.stack, {
        code: 'pluginCreateError'
      }, err));
    }

    // plugins should return a middleware function with an arrity of 3 or 4.
    if (_.isFunction(pluginFunction) === false || validateSignature(pluginFunction) === false) {
      debug('invalid function signature for plugin %s', pluginName);
      return callback(Error.create('Plugins must return a middleware function with an arrity of 3 or 4.', {
        code: 'pluginFunctionSignature'
      }));
    }

    callback(null, pluginFunction);
  };

  function requirePlugin(pluginName) {
    if (_.contains(settings.builtInPlugins, pluginName)) {
      var pluginPath = settings.builtInPluginsPath + pluginName;
      debug('require built-in plugin %s', pluginPath);
      return require(pluginPath);
    }

    // If this is not a built-in plugin, use the
    // standard node_modules based mechanism.
    debug('require node_modules plugin %s', pluginName);
    return require(pluginName);
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
