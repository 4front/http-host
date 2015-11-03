var assert = require('assert');
var sinon = require('sinon');
var mime = require('mime');
var async = require('async');
var express = require('express');
var supertest = require('supertest');
var shortid = require('shortid');
var streamTestUtils = require('./stream-test-utils');
var staticAsset = require('../lib/middleware/static-asset');

require('dash-assert');

describe('staticAsset', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();
    this.maxAge = 100000;
    this.responseText = 'OK';

    this.deployer = this.server.settings.deployer = {
      serve: sinon.spy(function(appId, versionId, filePath, res) {
        if (!res.getHeader('cache-control')) {
          res.setHeader('Cache-Control', 'max-age=' + self.maxAge);
        }

        res.setHeader('Content-Type', mime.lookup(filePath));

        streamTestUtils.buffer(self.responseText).pipe(res);
      })
    };

    this.appId = shortid.generate();
    this.versionId = shortid.generate();

    this.server.get('/deployments/:appId/:versionId/*', staticAsset());

    this.extendedRequest = {
      virtualEnv: 'production',
      virtualApp: {appId: self.appId},
      virtualAppVersion: {versionId: self.versionId}
    };

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.server.get('/*', staticAsset());

    this.server.use(function(req, res, next) {
      res.status(404).send('not found');
    });
  });

  it('serves static asset with max-age', function(done) {
    var filePath = 'data/ok.text';
    supertest(this.server)
      .get('/deployments/' + this.appId + '/' + this.versionId + '/' + filePath)
      .expect(200)
      .expect('Content-Type', 'text/plain')
      .expect('Cache-Control', 'max-age=' + self.maxAge)
      .expect(self.responseText)
      .expect(function(res) {
        assert.isFalse(res.headers.etag || false);
        assert.isTrue(self.deployer.serve.calledWith(self.appId, self.versionId, filePath));
      })
      .end(done);
  });

  it('serves static asset with etag', function(done) {
    var filePath = 'folder/data.txt';
    var initialETag;

    async.series([
      function(cb) {
        supertest(self.server)
          .get('/' + filePath)
          .expect(200)
          .expect('Content-Type', 'text/plain')
          .expect('ETag', self.versionId)
          .expect('Cache-Control', 'no-cache')
          .expect(self.responseText)
          .expect(function(res) {
            initialETag = res.headers.etag;
            assert.isTrue(self.deployer.serve.calledWith(self.appId, self.versionId, filePath));
          })
          .end(cb);
      },
      function(cb) {
        self.deployer.serve.reset();
        supertest(self.server)
          .get('/' + filePath)
          .set('If-None-Match', initialETag)
          .expect(304)
          .expect(function(res) {
            assert.isFalse(self.deployer.serve.called);
          })
          .end(cb);
      },
      function(cb) {
        self.deployer.serve.reset();
        var newVersionId = shortid.generate();
        self.extendedRequest.virtualAppVersion.versionId = newVersionId;
        supertest(self.server)
          .get('/' + filePath)
          .set('If-None-Match', initialETag)
          .expect(200)
          .expect('Content-Type', 'text/plain')
          .expect('ETag', newVersionId)
          .expect('Cache-Control', 'no-cache')
          .expect(self.responseText)
          .expect(function(res) {
            assert.isTrue(self.deployer.serve.calledWith(self.appId, newVersionId, filePath));
          })
          .end(cb);
      }
    ], done);
  });

  it('skips middleware for non static asset requests', function(done) {
    supertest(this.server)
      .get('/blog')
      .expect(404)
      .expect(function(res) {
        assert.isFalse(self.deployer.serve.called);
      })
      .end(done);
  });

  it('skips middleware for .html requests', function(done) {
    supertest(this.server)
      .get('/blog.html')
      .expect(404)
      .expect(function(res) {
        assert.isFalse(self.deployer.serve.called);
      })
      .end(done);
  });

  it('redirects request to localhost for dev sandbox', function(done) {
    this.extendedRequest.virtualEnv = 'dev';
    this.extendedRequest.devOptions = { port: 9999 };

    supertest(this.server)
      .get('/images/photo.png')
      .expect(302)
      .expect(function(res) {
        assert.isFalse(self.deployer.serve.called);
        assert.equal(res.headers.location, 'http://localhost:9999/images/photo.png');
      })
      .end(done);
  });
});
