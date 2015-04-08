var express = require('express');
var supertest = require('supertest');
var _ = require('lodash');
var assert = require('assert');
var sinon = require('sinon');
var errorFallback = require('../lib/middleware/error-fallback');

require('simple-errors');

describe('errorFallback', function() {
  var self;
  
  beforeEach(function() {
    self = this;

    this.server = express();

    this.server.use(function(req, res, next) {
      req.ext = {};
      next();
    });

    this.error = Error.http(500, "Error message", {help: "Error help text"});

    this.server.get('/', function(req, res, next) {
      next(self.error);
    });

    this.server.use(errorFallback());
  });

  it('renders default error page', function(done) {
    supertest(this.server)
      .get('/')
      .expect(500)
      .expect(function(res) {
        console.log(res.text);
      })
      .end(done);
  });
});
