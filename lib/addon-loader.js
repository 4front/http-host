var _ = require('lodash');
var path = require('path');
var parameterNames = require('get-parameter-names');

require('simple-errors');

module.exports = function(settings) {
  _.defaults(settings, {
    builtInAddonsDir: "./addons"
  });

  var addonCache = {};

  return function(addonName, options, callback) {
    var addon = addonCache[addonName];
    if (addon)
      return callback(addonFunction);

    if (!addon) {
      // First look to see if this is a built-in module.
      try {
        addon = require(path.join(settings.builtInAddonsDir, addonName));
      }
      catch (err) {
      }

      if (!addon) {
        try {
          // If this is not a built-in addon, use the
          // standard node_modules based mechanism.
          addon = require(addonName);
        }
        catch (err) {
        }
      }
    }

    if (!addon) {
      return callback(Error.create("Could not load addon " + addonName, {
        code: "addonLoadError"
      }));
    }

    // All addons must be functions with a single argument
    if (_.isFunction(addon) === false || addon.length !== 1) {
      return callback(Error.create('Addons must export a function with a single options argument.', {
        code: "addonInvalidExport"
      }));
    }

    var addonFunction;
    try {
      addonFunction = addon(options);
    }
    catch (err) {
      return callback(Error.create('Error creating addon', {
        code: "addonCreateError"
      }));
    }

    // Addons should return a middleware function with an arrity of 3 or 4.
    if (_.isFunction(addonFunction) === false || validateMiddlewareSignature(addonFunction) === false) {
      return callback(Error.create('Addons must return a middleware function with an arrity of 3 or 4.', {
        code: "addonFunctionSignature"
      }));
    }

    callback(null, addonFunction);
  };

  function validateMiddlewareSignature(func) {
    if (func.length < 3 || func.length > 4)
      return false;

    if (func.length === 3)
      return _.isEqual(parameterNames(func), ['req', 'res', 'next']);
    else
      return _.isEqual(parameterNames(func), ['err', 'req', 'res', 'next']);
  }
};
