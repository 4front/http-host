var express = require('express');
var path = require('path');
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
    this.server.settings.logger = {
      error: sinon.spy(function(){})
    };

    this.server.use(function(req, res, next) {
      req.ext = {};
      next();
    });

    this.error = Error.http(500, "Error message", {help: "Error help text"});

    this.server.get('/', function(req, res, next) {
      next(self.error);
    });

    this.options = {};
    this.server.use(errorFallback(this.options));
  });

  it('renders default error page', function(done) {
    supertest(this.server)
      .get('/')
      .expect(500)
      .expect('Cache-Control', 'no-cache')
      .expect(/\<html\>/)
      .expect(function(res) {
        assert.ok(self.server.settings.logger.error.called);
      })
      .end(done);
  });

  it('renders custom default error page', function(done) {
    this.error = Error.http(404, "Not found", {help: "Page not found"});
    this.options.errorPage = path.resolve(__dirname, "../fixtures/custom-error.ejs");

    supertest(this.server)
      .get('/')
      .expect(404)
      .expect('Cache-Control', 'no-cache')
      .expect(/\<html\>/)
      .end(done);
  });

  it('handles missing error page', function(done) {
    this.options.errorPage = path.resolve(__dirname, "../fixtures/non-existent.ejs");

    supertest(this.server)
      .get('/')
      .expect(500)
      .expect('Cache-Control', 'no-cache')
      .expect(/\<html\>/)
      .end(done);
  });

  it('handles malformed ejs', function(done) {
    this.options.errorPage = path.resolve(__dirname, "../fixtures/malformed.ejs");

    supertest(this.server)
      .get('/')
      .expect(500)
      .expect('Cache-Control', 'no-cache')
      .expect(/\<html\>/)
      .end(done);
  });
});
