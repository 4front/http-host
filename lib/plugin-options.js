var _ = require('lodash');
var expandVar = require('expand-var');
require('simple-errors');

// Recurse through the options object and expand any special string
// values like regex:* and env:*.
module.exports = function(settings) {
  return function(options, locals) {
    var clonedOptions = _.cloneDeep(options);
    expandOptions(clonedOptions, locals);
    return clonedOptions;
  };

  function expandOptions(options, locals) {
    var env = {};
    _.each(locals.env, function(envVar, key) {
      env[key] = envVar.value;
    });

    _.each(options, function(optionValue, key) {
      // If the option key is is a string starting with 'env:' then
      // it indicates an environment variable.
      if (_.isString(optionValue)) {
        if (optionValue.slice(0, 4) === 'env:') {
          var envVariable = optionValue.slice(4);
          if (_.has(env, envVariable) === false) {
            throw Error.create('Invalid environment variable ' + envVariable, {
              code: 'invalidEnvironmentVariable',
              environmentVariable: envVariable,
              log: false
            });
          }

          options[key] = env[envVariable];
        } else if (optionValue.slice(0, 5) === 'user:') {
          if (_.isObject(locals.user) === false) {
            throw Error.create('There is no user object in session state', {
              help: 'Make sure you\'ve declared the session plugin along with an auth plugin such as ldap-auth in the package.json manifest',
              code: 'missingSessionUser',
              log: false
            });
          }

          var userProperty = optionValue.slice(5);

          if (_.has(locals.user, userProperty) === false) {
            throw Error.create('Invalid user property ' + userProperty + ' declared.', {
              help: 'Ensure that the user object returned by the auth plugin defines this attribute.',
              code: 'invalidUserProperty',
              log: false
            });
          }

          options[key] = maybeDecrypt(locals.user[userProperty]);
        } else if (optionValue.slice(0, 6) === 'regex:') {
          var pattern = optionValue.slice(6);
          try {
            options[key] = new RegExp(pattern);
          } catch (err) {
            throw Error.create('Invalid RegExp ' + pattern, {
              code: 'invalidRegexOption',
              pattern: pattern,
              log: false
            });
          }
        } else {
          // Support unix style embedded variables using the expandVars library.
          // These can be in the form $KEY or ${KEY}.
          options[key] = expandVar(options[key], env);
        }
      } else if (_.isObject(optionValue)) {
        expandOptions(optionValue, locals);
      }
    });
  }

  // If the value is in the form {__encrypted: 'encrypted_string'} then
  // decrypt the nested value and return that.
  function maybeDecrypt(value) {
    if (_.isObject(value) && _.isString(value.__encrypted)) {
      return settings.crypto.decrypt(value.__encrypted);
    }
    return value;
  }
};
