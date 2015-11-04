var assert = require('assert');
var sinon = require('sinon');
var urljoin = require('url-join');
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

    this.storage = this.server.settings.storage = {
      createReadStream: sinon.spy(function() {
        return streamTestUtils.buffer(self.responseText);
      })
    };

    this.server.settings.staticAssetMaxAge = 500000;
    this.appId = shortid.generate();
    this.versionId = shortid.generate();

    this.server.get('/deployments/:appId/:versionId/*', staticAsset(this.server.settings));

    this.extendedRequest = {
      virtualEnv: 'production',
      virtualApp: {appId: self.appId},
      virtualAppVersion: {versionId: self.versionId}
    };

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.server.get('/*', staticAsset(this.server.settings));

    this.server.use(function(req, res, next) {
      res.status(404).send('not found');
    });

    this.server.use(function(err, req, res, next) {
      res.status(500).end();
    });
  });

  it('serves static asset with max-age', function(done) {
    var filePath = 'data/ok.text';
    supertest(this.server)
      .get('/deployments/' + this.appId + '/' + this.versionId + '/' + filePath)
      .expect(200)
      .expect('Content-Type', 'text/plain')
      .expect('Cache-Control', 'max-age=' + self.server.settings.staticAssetMaxAge)
      .expect(function(res) {
        assert.equal(res.text, self.responseText);
        assert.isFalse(res.headers.etag || false);
        assert.isTrue(self.storage.createReadStream.calledWith(urljoin(self.appId, self.versionId, filePath)));
      })
      .end(done);
  });

  it('returns 404 for files missing in storage', function(done) {
    this.storage.createReadStream = function() {
      return streamTestUtils.emitter('missing');
    };

    async.series([
      function(cb) {
        supertest(self.server)
          .get('/deployments/' + self.appId + '/' + self.versionId + '/missing.txt')
          .expect(404)
          .end(cb);
      },
      function(cb) {
        supertest(self.server)
          .get('/missing.txt')
          .expect(404)
          .end(cb);
      }
    ], done);
  });

  it('returns 500 when storage throws error', function(done) {
    this.storage.createReadStream = function() {
      return streamTestUtils.emitter('readError', new Error('some error'));
    };

    async.series([
      function(cb) {
        supertest(self.server)
          .get('/deployments/' + self.appId + '/' + self.versionId + '/file.txt')
          .expect(500)
          .end(cb);
      },
      function(cb) {
        supertest(self.server)
          .get('/file.txt')
          .expect(500)
          .end(cb);
      }
    ], done);
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
            assert.isTrue(self.storage.createReadStream.calledWith(urljoin(self.appId, self.versionId, filePath)));
          })
          .end(cb);
      },
      function(cb) {
        self.storage.createReadStream.reset();
        supertest(self.server)
          .get('/' + filePath)
          .set('If-None-Match', initialETag)
          .expect(304)
          .expect(function(res) {
            assert.isFalse(self.storage.createReadStream.called);
          })
          .end(cb);
      },
      function(cb) {
        self.storage.createReadStream.reset();
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
            assert.isTrue(self.storage.createReadStream.calledWith(urljoin(self.appId, newVersionId, filePath)));
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
        assert.isFalse(self.storage.createReadStream.called);
      })
      .end(done);
  });

  it('skips middleware for .html requests', function(done) {
    supertest(this.server)
      .get('/blog.html')
      .expect(404)
      .expect(function(res) {
        assert.isFalse(self.storage.createReadStream.called);
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
        assert.isFalse(self.storage.createReadStream.called);
        assert.equal(res.headers.location, 'http://localhost:9999/images/photo.png');
      })
      .end(done);
  });

  it('redirects images without appId and versionId fingerprint', function(done) {
    var filePath = '/images/photo.png';
    supertest(this.server)
      .get(filePath)
      .expect(302)
      .expect(function(res) {
        assert.isFalse(self.storage.createReadStream.called);
        assert.equal(res.headers.location, urljoin(self.server.settings.deployedAssetsPath, self.appId, self.versionId, filePath));
      })
      .end(done);
  });
});
