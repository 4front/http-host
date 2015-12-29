var _ = require('lodash');
var express = require('express');
var pathToRegexp = require('path-to-regexp');
var debug = require('debug')('4front:http-host:redirect');
require('simple-errors');

module.exports = function(options) {
  var router = express.Router();

  _.each(options, function(rule, path) {
    router.get(path, function(req, res, next) {
      var statusCode;
      var destPath;

      if (_.isString(rule)) {
        statusCode = 301;
        destPath = rule;
      } else if (_.isArray(rule) && validateRedirectArray(rule)) {
        statusCode = rule[0];
        destPath = rule[1];
      } else {
        return next(Error.create('Invalid redirect rule %s', JSON.stringify(rule), {log: false}));
      }

      var destRegexp = pathToRegexp.compile(destPath);

      var destUrl;
      try {
        destUrl = destRegexp(req.params);
      } catch (err) {
        return next(Error.create('Invalid redirect pattern %s', rule, {log: false}));
      }

      destUrl = decodeURIComponent(destUrl);

      res.redirect(statusCode, destUrl);
    });
  });

  return router;
};

function validateRedirectArray(rule) {
  return rule.length === 2 &&
    _.contains([301, 302], rule[0]) &&
    _.isString(rule[1]);
}
