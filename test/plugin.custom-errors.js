var express = require('express');
var urljoin = require('url-join');
var supertest = require('supertest');
var _ = require('lodash');
var assert = require('assert');
var sinon = require('sinon');
var sbuff = require('simple-bufferstream');
var testUtil = require('./test-util');
var customErrors = require('../lib/plugins/custom-errors');

require('dash-assert');
require('simple-errors');

describe('customErrors', function() {
  var self;

  beforeEach(function() {
    self = this;

    this.server = express();
    this.server.settings.customHttpHeaderPrefix = 'x-4front-';
    this.server.settings.storage = {
      readFileStream: sinon.spy(function() {
        return sbuff('<html>custom error</html>');
      })
    };

    this.server.settings.logger = {
      error: sinon.spy(function() {})
    };

    this.virtualApp = {
      appId: '123',
      name: 'test-app'
    };

    this.virtualAppVersion = {
      versionId: '456',
      name: 'v1'
    };

    this.server.use(function(req, res, next) {
      req.ext = {
        virtualEnv: 'production',
        virtualApp: self.virtualApp,
        virtualAppVersion: self.virtualAppVersion
      };

      if (_.isFunction(self.updateRequest)) {
        self.updateRequest(req);
      }

      next();
    });

    this.options = {
      errors: {
        500: '500.html',
        400: '400.html',
        401: '401.html'
      }
    };

    this.error = Error.http(500, 'Test error', {code: 'testError'});

    this.server.get('/', function(req, res, next) {
      next(self.error);
    });

    this.server.use(function(err, req, res, next) {
      customErrors(self.options)(err, req, res, next);
    });

    // Fallback error handler
    this.server.use(function(err, req, res, next) {
      res.set('Error-Handler', 'fallback');
      res.status(err.status).send(err.message);
    });
  });

  it('uses custom error page', function(done) {
    supertest(this.server)
      .get('/')
      .expect(500)
      .expect('Content-Type', /text\/html/)
      .expect('Cache-Control', 'no-cache')
      .expect(this.server.settings.customHttpHeaderPrefix + 'error-code', 'testError')
      .expect('<html>custom error</html>')
      .expect(function(res) {
        assert.ok(self.server.settings.storage.readFileStream.calledWith(
          urljoin(self.virtualApp.appId,
            self.virtualAppVersion.versionId,
            '500.html')));

        assert.isUndefined(res.headers.etag);
        assert.ok(self.server.settings.logger.error.called);
      })
      .end(done);
  });

  it('bypasses custom error if bypassCustomErrorPage', function(done) {
    this.error = Error.http(404, 'Test error', {bypassCustomErrorPage: true});

    supertest(this.server)
      .get('/')
      .expect(404)
      .expect('Error-Handler', 'fallback')
      .expect('Test error')
      .end(done);
  });

  it('advances to fallback if virtualApp missing', function(done) {
    this.updateRequest = function(req) {
      req.ext.virtualApp = null;
    };

    supertest(this.server)
      .get('/')
      .expect(500)
      .expect('Error-Handler', 'fallback')
      .end(done);
  });

  it('advances to fallback if custom error page not specified', function(done) {
    this.options.errors['500'] = null;

    supertest(this.server)
      .get('/')
      .expect(500)
      .expect('Error-Handler', 'fallback')
      .end(done);
  });

  it('advances to fallback if page stream missing', function(done) {
    this.server.settings.storage.readFileStream = function() {
      return testUtil.createMissingStream();
    };

    supertest(this.server)
      .get('/')
      .expect(500)
      .expect('Error-Handler', 'fallback')
      .end(done);
  });

  it('works with string error code options', function(done) {
    this.error = Error.http(400, 'Test error');

    this.options = {
      errors: {
        400: 'errors/400.html'
      }
    };

    supertest(this.server)
      .get('/')
      .expect(400, done);
  });
});
