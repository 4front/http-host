var _ = require('lodash');
var crypto = require('crypto');
var debug = require('debug')('4front:helper');

// Determine which html page to render.
module.exports.determineHtmlPage = function(req, ensureAuthenticated) {
  // If authentication is required for this app and req.isAuthenticated returns false
  // set the pageName to the public page.
  if (ensureAuthenticated === true) {
    if (req.ext.isAuthenticated === true) {
      debug('user is authenticated, show the private index page');
      return req.ext.virtualApp.privatePage || 'index';
    }
    debug('user is not authenticated, show the public index page');
    return req.ext.virtualApp.publicPage || 'login';
  }
  return req.ext.virtualApp.indexPage || 'index';
};

module.exports.requiredOptionsError = requiredOptionsError;

module.exports.ensureRequiredOptions = function(options) {
  var error = requiredOptionsError.apply(this, arguments);
  if (error) throw error;
};

module.exports.hashString = function(str) {
  var shasum = crypto.createHash('sha1');
  shasum.update(str);
  return shasum.digest('hex');
};

module.exports.stripQuerystring = function(url) {
  // Strip the querystring off since it doesn't impact the response output.
  var queryIndex = url.indexOf('?');
  if (queryIndex !== -1) {
    url = url.substr(0, queryIndex);
  }
  return url;
};

// Copy the querystring from originalUrl to newUrl
module.exports.copyQuerystring = function(originalUrl, newUrl) {
  var queryIndex = originalUrl.indexOf('?');
  if (queryIndex !== -1) {
    newUrl += originalUrl.substr(queryIndex);
  }
  return newUrl;
};

function requiredOptionsError(options) {
  var optionKeys = _.toArray(arguments).slice(1);
  for (var i = 0; i < optionKeys.length; i++) {
    var key = optionKeys[i];

    if (_.isUndefined(options[key]) || _.isNull(options[key])) {
      return new Error('Required option ' + key + ' missing');
    } else if (key.slice(-2) === 'Fn' && _.isFunction(options[key]) === false) {
      return new Error('Option ' + key + ' expected to be a function');
    }
  }
}
