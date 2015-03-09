var _ = require('lodash');

module.exports = function(options) {
  return function(name, pluginOptions, callback) {
    var plugin;
    try {
      plugin = require(options.pluginDir + '/' + name);
    }
    catch (err) {
      return callback(new Error('Cannot load plugin ' + name + '. Are you sure it is installed?'));
    }

    // All plugins are functions with a single argument
    if (_.isFunction(plugin) === false || plugin.length !== 1)
      return callback(new Error('Invalid plugin ' + name + '. Plugins must export a function with a single argument.'));

    var pluginFunction;
    try {
      pluginFunction = plugin(pluginOptions);
    }
    catch (err) {
      callback(new Error('Could not invoke plugin ' + name + ':\n' + err.stack));
    }

    // Plugins should return a middleware function with an arrity of 3 or 4.
    if (_.isFunction(pluginFunction) === false || (pluginFunction.length < 3 || pluginFunction.length > 4))
      callback(new Error('Invalid plugin ' + name + '. Plugins must return a middleware function with an arrity of 3 or 4.'));

    callback(null, pluginFunction);
  };
};