var _ = require('lodash');
var debug = require('debug')('4front:helper');

// Determine which html page to render.
module.exports.determineHtmlPage = function(req, ensureAuthenticated) {
  // If authentication is required for this app and req.isAuthenticated returns false
  // set the pageName to the public page.
  if (ensureAuthenticated === true) {
    if (req.ext.isAuthenticated === true) {
      debug("user is authenticated, show the private index page");
      return req.ext.virtualApp.privatePage || 'index';
    }
    else {
      debug("user is not authenticated, show the public index page");
      return req.ext.virtualApp.publicPage || 'login';
    }
  }
  else
    return req.ext.virtualApp.indexPage || 'index';
};

module.exports.requiredOptionsError = requiredOptionsError;

module.exports.ensureRequiredOptions = function(options, _keys_) {
  var error = requiredOptionsError.apply(this, arguments);
  if (error)
    throw error;
};

function requiredOptionsError(options, _keys_) {
  var optionKeys = _.toArray(arguments).slice(1);
  for (var i=0; i<optionKeys.length; i++) {
    var key = optionKeys[i];

    if (_.isUndefined(options[key]) || _.isNull(options[key]))
      return new Error("Required option " + key + " missing");
    else if (key.slice(-2) === 'Fn' && _.isFunction(options[key]) === false)
      return new Error("Option " + key + " expected to be a function");
  }
}
