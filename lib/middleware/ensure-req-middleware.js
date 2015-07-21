// Middleware that ensures other middleware has already executed. If it hasn't
// already executed, then do so.
// TODO: This could be extracted to a standalone middleware module

var async = require('async');
var session = require('express-session');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var _ = require('lodash');
var debug = require('debug')('4front:apphost:ensure-req-middleware');

require('simple-errors');

module.exports = function(middleware, options) {
  options = _.merge({
    session: {
      cookie: {
        path: '/',
        httpOnly: true
      },
      resave: false,
      saveUninitialized: true
    },
    bodyParser: {
      json: {},
      urlencoded: {
        extended: false
      }
    },
    cookieParser: {}
  }, options);

  return function(req, res, next) {
    var asyncTasks = [];

    for (var i=0; i<middleware.length; i++) {
      switch (middleware[i]) {
        case "session":
          // Check if the session object already exists.
          if (_.isObject(req.session) === false) {
            asyncTasks.push(function(cb) {
              debug("running session middleware");
              session(options.session)(req, res, cb);
            });
          }
          break;
        case "body:json":
          if (_.isObject(req.body) === false && req.is("json")) {
            asyncTasks.push(function(cb) {
              debug("ensuring json body");
              bodyParser.json()(req, res, cb);
            });
          }
          break;
        case "body:urlencoded":
          if (_.isObject(req.body) === false && req.is("urlencoded")) {
            asyncTasks.push(function(cb) {
              debug("ensuring urlencoded body");
              bodyParser.urlencoded({extended: false})(req, res, cb);
            });
          }
          break;
        case "cookies":
          if (_.isObject(req.cookies) === false) {
            asyncTasks.push(function(cb) {
              debug("ensuring cookies");
              cookieParser()(req, res, cb);
            });
          }
          break;
        default:
          return next(Error.http(400, "Invalid middleware name", {code: "invalidMiddlewareName"}))
          break;
      }
    }

    async.series(asyncTasks, next);
  };
}
