var assert = require('assert');
var sinon = require('sinon');
var fs = require('fs');
var path = require('path');
var express = require('express');
var supertest = require('supertest');
var shortid = require('shortid');
var favicon = require('../lib/middleware/favicon');

require('dash-assert');

describe('favicon', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();
    this.server.set('trust proxy', true);

    this.server.settings.faviconPath = path.join(__dirname, './fixtures/favicon.ico');
    this.deployer = this.server.settings.deployer = {};

    this.appId = shortid.generate();
    this.versionId = shortid.generate();

    this.extendedRequest = {
      virtualApp: {
        appId: self.appId
      },
      virtualAppVersion: {
        versionId: self.versionId
      }
    };

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.server.use(favicon(this.server.settings));
  });

  it('renders the default favicon in dev mode', function(done) {
    this.extendedRequest.virtualEnv = 'dev';

    supertest(this.server)
      .get('/favicon.ico?default=1')
      .expect('Content-Type', 'image/x-icon')
      .expect(200)
      .end(done);
  });

  it('renders custom favicon', function(done) {
    this.deployer.serve = sinon.spy(function(appId, versionId, filePath, res) {
      res.set('Content-Type', 'image/x-icon');
      fs.createReadStream(path.join(__dirname, './fixtures/favicon.ico')).pipe(res);
    });

    supertest(this.server)
      .get('/favicon.ico')
      .expect('Content-Type', 'image/x-icon')
      .expect(200)
      .expect(function() {
        assert.isTrue(self.deployer.serve.calledWith(
          self.extendedRequest.virtualApp.appId,
          self.extendedRequest.virtualAppVersion.versionId,
          'favicon.ico'));
      })
      .end(done);
  });

  it('falls back to default favicon', function(done) {
    this.deployer.serve = sinon.spy(function(appId, versionId, filePath, res, next) {
      next(new Error('Error serving custom favicon'));
    });

    supertest(this.server)
      .get('/favicon.ico')
      .expect('Content-Type', 'image/x-icon')
      .expect(200)
      .expect(function() {
        assert.isTrue(self.deployer.serve.calledWith(
          self.extendedRequest.virtualApp.appId,
          self.extendedRequest.virtualAppVersion.versionId,
          'favicon.ico'));
      })
      .end(done);
  });
});
