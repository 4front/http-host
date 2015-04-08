var express = require('express');
var supertest = require('supertest');
var assert = require('assert');
var sinon = require('sinon');
var sbuff = require('simple-bufferstream');
var customErrors = require('../lib/middleware/custom-errors');

require('simple-errors');

describe('customErrors', function() {
  var self;

  beforeEach(function() {
    self = this;

    this.server = express();

    this.server.settings.assetStorage = {
      createReadStream: sinon.spy(function(appId, versionId, pageName) {
        return sbuff("<html>custom error</html>");
      })
    };

    this.server.use(function(req, res, next) {
      req.ext = {
        virtualEnv: 'production',
        virtualApp: {
          appId: '123',
          name: 'test-app'
        },
        virtualAppVersion: {
          versionId: '456',
          name: 'v1'
        }
      };

      next();
    });

    this.options = {
      errors: {
        500: "500.html",
        400: "400.html",
        401: "401.html"
      }
    };

    this.error = null;

    this.server.get('/', function(req, res, next) {
      next(self.error);
    });

    this.server.use(customErrors(this.options));

    // Fallback error handler
    this.server.use(function(err, req, res, next) {
      res.status(err.status).send("fallback handler");
    });
  });

  it('uses custom error page', function(done) {
    this.error = Error.http(500, "Test error", {code: "testError"});

    supertest(this.server)
      .get('/')
      .expect(500)
      .expect('Content-Type', /text\html/)
      .expect("<html>custom error</html>")
      .end(done);
  });
});
