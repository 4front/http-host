var sinon = require('sinon');
var fs = require('fs');
var path = require('path');
var express = require('express');
var supertest = require('supertest');
var shortid = require('shortid');
var testUtil = require('./test-util');
var staticAsset = require('../lib/middleware/static-asset');
var httpHeaders = require('../lib/plugins/http-headers');

require('dash-assert');

describe('httpHeaders', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();

    this.storage = this.server.settings.storage = {
      readFileStream: sinon.spy(function() {
        return fs.createReadStream(path.join(__dirname, './fixtures/bg.jpg'));
      })
    };

    this.appId = shortid.generate();
    this.versionId = shortid.generate();

    this.extendedRequest = {
      virtualEnv: 'production',
      virtualApp: {appId: self.appId},
      virtualAppVersion: {versionId: self.versionId}
    };

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.headers = {};
    this.server.use(function(req, res, next) {
      httpHeaders(self.headers)(req, res, next);
    });

    this.server.get('/*', staticAsset());

    this.server.use(function(req, res, next) {
      res.status(404).send('not found');
    });

    this.server.use(testUtil.errorHandler);
  });

  it('allows specifying cache-control', function(done) {
    var cacheControl = 'public, max-age=1000';
    this.headers['cache-control'] = cacheControl;
    supertest(this.server)
      .get('/images/bg.jpg')
      .expect(200)
      .expect('Cache-Control', cacheControl)
      .end(done);
  });

  it('allows specifying custom header', function(done) {
    this.headers['x-custom-header'] = 'abcd';
    supertest(this.server)
      .get('/images/bg.jpg')
      .expect(200)
      .expect('x-custom-header', 'abcd')
      .end(done);
  });
});
