var assert = require('assert');
var fs = require('fs');
var async = require('async');
var supertest = require('supertest');
var express = require('express');
var sinon = require('sinon');
var _ = require('lodash');
var streamTestUtils = require('./stream-test-utils');
var shortid = require('shortid');
var redis = require('redis');
var testUtil = require('./test-util');

require('redis-streams')(redis);
require('dash-assert');

describe('integration', function() {
  var self;
  var customHeaderPrefix = 'x-4front-';
  var cacheControlHeader = 'public, max-age=31536000, no-cache';

  beforeEach(function() {
    self = this;
    this.server = express();
    _.assign(this.server.settings, {
      customHttpHeaderPrefix: customHeaderPrefix,
      cacheControl: cacheControlHeader,
      deployedAssetsPath: '//cdn.com/',
      virtualHost: 'sharedhost.com',
      defaultVirtualEnvironment: 'production',
      enableContentCache: function() { return true; },
      contentCache: redis.createClient({return_buffers: true}),
      cache: redis.createClient(),
      metrics: testUtil.debugMetrics()
    });

    this.appId = shortid.generate();
    this.versionId = shortid.generate();

    this.database = this.server.settings.database = {
      getVersion: sinon.spy(function(appId, versionId, callback) {
        callback(null, {
          versionId: self.versionId,
          appId: self.appId,
          name: self.versionId,
          manifest: {} // webpage plugin will get created automatically
        });
      }),
      getDomain: sinon.spy(function(domainName, callback) {
        callback(null, {
          domainName: domainName
        });
      })
    };

    this.virtualAppRegistry = this.server.settings.virtualAppRegistry = {
      getByDomain: sinon.spy(function(domainName, subDomain, callback) {
        callback(null, {
          appId: self.appId,
          environments: ['production'],
          trafficRules: {
            production: [
              {rule: '*', versionId: self.versionId}
            ]
          }
        });
      })
    };

    this.storage = this.server.settings.storage = {
      fileExists: sinon.spy(function(filePath, callback) {
        callback(null, true);
      })
    };

    this.server.use(function(req, res, next) {
      require('../lib/http-host')(self.server.settings)(req, res, next);
    });

    this.customDomain = 'custom-domain-' + Date.now() + '.com';
  });

  it('serves a webpage on custom domain', function(done) {
    var htmlContent = '<html><head>@@' + this.versionId + '@@</head></html>';
    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.buffer(htmlContent);
    });

    var cacheKey;
    async.series([
      function(cb) {
        supertest(self.server)
          .get('/')
          .set('Host', 'www.' + self.customDomain)
          .expect(200)
          .expect(new RegExp('@@' + self.versionId + '@@'))
          .expect('Content-Encoding', 'gzip')
          .expect('Cache-Control', cacheControlHeader)
          .expect('ETag', /".*"/)
          .expect(customHeaderPrefix + 'app-id', self.appId)
          .expect(customHeaderPrefix + 'version-id', self.versionId)
          .expect('content-cache', /^miss/)
          .expect(function(res) {
            cacheKey = res.get('content-cache').split(' ')[1];
            assert.isTrue(self.virtualAppRegistry.getByDomain.calledWith(self.customDomain, 'www'));
            assert.isTrue(self.database.getVersion.calledWith(self.appId, self.versionId));
            var storagePath = self.appId + '/' + self.versionId + '/index.html';
            assert.isTrue(self.storage.fileExists.calledWith(storagePath));
            assert.isTrue(self.storage.readFileStream.calledWith(storagePath));
          })
          .end(cb);
      },
      function(cb) {
        setTimeout(cb, 10);
      },
      function(cb) {
        // Subsequent request should be served from the server cache
        self.storage.fileExists.reset();
        self.storage.readFileStream.reset();
        supertest(self.server)
          .get('/')
          .set('Host', 'www.' + self.customDomain)
          .expect(200)
          .expect(new RegExp('@@' + self.versionId + '@@'))
          .expect('Content-Encoding', 'gzip')
          .expect('Cache-Control', cacheControlHeader)
          .expect('ETag', '"' + cacheKey + '"')
          .expect(customHeaderPrefix + 'app-id', self.appId)
          .expect(customHeaderPrefix + 'version-id', self.versionId)
          .expect('content-cache', 'hit ' + cacheKey)
          .expect(function(res) {
            assert.isFalse(self.storage.fileExists.called);
            assert.isFalse(self.storage.readFileStream.called);
          })
          .end(cb);
      }
    ], done);
  });

  it('serves a static image', function(done) {
    this.storage.readFileStream = sinon.spy(function() {
      return fs.createReadStream(__dirname + '/fixtures/test.jpg');
    });

    var cacheKey;
    async.series([
      function(cb) {
        supertest(self.server)
          .get('/test.jpg')
          .set('Host', 'www.' + self.customDomain)
          .expect(200)
          .expect('Content-Type', 'image/jpeg')
          .expect('Cache-Control', cacheControlHeader)
          .expect(customHeaderPrefix + 'app-id', self.appId)
          .expect(customHeaderPrefix + 'version-id', self.versionId)
          .expect('content-cache', /^miss/)
          .expect(function(res) {
            cacheKey = res.get('content-cache').split(' ')[1];
            assert.isTrue(self.virtualAppRegistry.getByDomain.calledWith(self.customDomain, 'www'));
            assert.isTrue(self.database.getVersion.calledWith(self.appId, self.versionId));
            var storagePath = self.appId + '/' + self.versionId + '/test.jpg';
            assert.isTrue(self.storage.readFileStream.calledWith(storagePath));
          })
          .end(cb);
      },
      function(cb) {
        setTimeout(cb, 10);
      },
      function(cb) {
        // Subsequent request should be served from the server cache
        self.storage.fileExists.reset();
        self.storage.readFileStream.reset();

        supertest(self.server)
          .get('/test.jpg')
          .set('Host', 'www.' + self.customDomain)
          .expect(200)
          .expect('Content-Type', 'image/jpeg')
          .expect('Cache-Control', cacheControlHeader)
          .expect(customHeaderPrefix + 'app-id', self.appId)
          .expect(customHeaderPrefix + 'version-id', self.versionId)
          .expect('content-cache', 'hit ' + cacheKey)
          .expect(function(res) {
            assert.isFalse(self.storage.readFileStream.called);
          })
          .end(cb);
      }
    ], done);
  });
});
