var _ = require('lodash');

module.exports = function(options) {
  return function(name, addonOptions, callback) {
    var addon;
    try {
      addon = require(options.addonsDir + '/' + name);
    }
    catch (err) {
      return callback(new Error('Cannot load addon ' + name + '. Are you sure it is installed?'));
    }

    // All plugins are functions with a single argument
    if (_.isFunction(plugin) === false || plugin.length !== 1)
      return callback(new Error('Invalid addon ' + name + '. Addons must export a function with a single options argument.'));

    var addonFunction;
    try {
      addonFunction = addon(addonFunction);
    }
    catch (err) {
      callback(new Error('Could not invoke addon ' + name + ':\n' + err.stack));
    }

    // Addons should return a middleware function with an arrity of 3 or 4.
    if (_.isFunction(addonFunction) === false || (addonFunction.length < 3 || addonFunction.length > 4))
      callback(new Error('Invalid plugin ' + name + '. Addons must return a middleware function with an arrity of 3 or 4.'));

    callback(null, addonFunction);
  };
};
