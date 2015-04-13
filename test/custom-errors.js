var express = require('express');
var supertest = require('supertest');
var _ = require('lodash');
var assert = require('assert');
var sinon = require('sinon');
var sbuff = require('simple-bufferstream');
var testUtil = require('./test-util');
var customErrors = require('../lib/middleware/custom-errors');

require('simple-errors');

describe('customErrors', function() {
  var self;

  beforeEach(function() {
    self = this;

    this.server = express();

    this.server.settings.deployments = {
      readFileStream: sinon.spy(function(appId, versionId, pageName) {
        return sbuff("<html>custom error</html>");
      })
    };

    this.server.settings.logger = {
      error: sinon.spy(function(){})
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

      if (_.isFunction(self.updateRequest))
        self.updateRequest(req);

      next();
    });

    this.options = {
      errors: {
        500: "500.html",
        400: "400.html",
        401: "401.html"
      }
    };

    this.error = Error.http(500, "Test error", {code: "testError"});;

    this.server.get('/', function(req, res, next) {
      next(self.error);
    });

    this.server.use(customErrors(this.options));

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
      .expect('Error-Code', 'testError')
      .expect("<html>custom error</html>")
      .expect(function(res) {
        assert.ok(self.server.settings.deployments.readFileStream.calledWith(
          self.virtualApp.appId, self.virtualAppVersion.versionId, '500.html'));
      })
      .end(done);
  });

  it('bypasses custom error if bypassCustomErrorPage', function(done) {
    this.error = Error.http(404, "Test error", {bypassCustomErrorPage: true});

    supertest(this.server)
      .get('/')
      .expect(404)
      .expect('Error-Handler', 'fallback')
      .expect("Test error")
      .end(done);
  });

  it('advances to fallback if virtualApp missing', function(done) {
    this.updateRequest = function(req) {
      req.ext.virtualApp = null;
    };
    // this.extendedRequest.virtualApp = null;

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
    this.server.settings.deployments.readFileStream = function() {
      return testUtil.createMissingStream();
    };

    supertest(this.server)
      .get('/')
      .expect(500)
      .expect('Error-Handler', 'fallback')
      .end(done);
  });

  it('uses override createReadStream option', function(done) {
    var readStream = sinon.spy(function(pageName, callback) {
      callback(null, sbuff("<html>special</html>"))
    });

    this.updateRequest = function(req) {
      req.ext.createReadStream = readStream;
    };

    supertest(this.server)
      .get('/')
      .expect(500)
      .expect("<html>special</html>")
      .expect(function() {
        assert.ok(readStream.calledWith('500.html'));
      })
      .end(done);
  });
});
