var _ = require('lodash');
var pathToRegexp = require('path-to-regexp');
var namedRegexp = require('named-regexp').named;
var debug = require('debug')('4front:http-host:redirect');
require('simple-errors');

module.exports = function(options) {
  return function(req, res, next) {
    var statusCode;
    var destPath;
    var destUrl;
    var match;
    var regex;
    var compiled;

    var patterns = _.keys(options);
    for (var i = 0; i < patterns.length; i++) {
      var rule = options[patterns[i]];
      if (_.isString(rule)) {
        statusCode = 301;
        destPath = rule;
      } else if (_.isArray(rule) && validateRedirectArray(rule)) {
        statusCode = rule[0];
        destPath = rule[1];
      } else {
        continue;
      }

      if (_.startsWith(patterns[i], 'regex:')) {
        try {
          regex = namedRegexp(new RegExp(patterns[i].substr(6)));
        } catch (err) {
          return next(Error.create('Invalid redirect regex', {log: false}));
        }

        match = regex.exec(req.originalUrl);
        if (!match) continue;

        compiled = _.template(destPath, /\${([\s\S]+?)}/g);
        destUrl = compiled(match.captures);
        return res.redirect(statusCode, destUrl);
      }

      var keys = [];
      regex = pathToRegexp(patterns[i], keys);
      match = regex.exec(req.originalUrl);

      if (match && match.length === keys.length + 1) {
        var params = buildParamsFromKeys(match, keys);

        try {
          compiled = pathToRegexp.compile(destPath);
          destUrl = decodeURIComponent(compiled(params));
        } catch (err) {
          return next(Error.create('Invalid redirect pattern', {log: false}));
        }
        return res.redirect(statusCode, destUrl);
      }
    }

    next();
  };
};

function buildParamsFromKeys(match, keys) {
  var params = {};
  keys.forEach(function(key, n) {
    params[key.name] = match[n + 1];
  });

  return params;
}

function validateRedirectArray(rule) {
  return rule.length === 2 &&
    _.includes([301, 302], rule[0]) &&
    _.isString(rule[1]);
}
