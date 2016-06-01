var assert = require('assert');
var sinon = require('sinon');
var zlib = require('zlib');
var compression = require('compression');
var _ = require('lodash');
var urljoin = require('url-join');
var async = require('async');
var express = require('express');
var supertest = require('supertest');
var shortid = require('shortid');
var testUtil = require('./test-util');
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
    this.metadata = {};

    this.storage = this.server.settings.storage = {
      readFileStream: sinon.spy(function() {
        var stream = streamTestUtils.buffer(self.responseText, {
          metadata: self.metadata
        });

        return stream;
      }),
      getMetadata: sinon.spy(function(filePath, callback) {
        callback(null, self.metadata);
      })
    };

    _.extend(this.server.settings, {
      staticAssetMaxAge: 500000,
      deployedAssetsPath: '/deployments',
      baseUrlPlaceholder: 'https://__baseurl__'
    });

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

    this.server.use(compression());
    this.server.get(this.server.settings.deployedAssetsPath + '/:appId/:versionId/*', staticAsset(this.server.settings));
    this.server.get('/*', function(req, res, next) {
      staticAsset(self.server.settings)(req, res, next);
    });

    this.server.use(function(req, res, next) {
      res.status(404).send('not found');
    });

    this.server.use(testUtil.errorHandler);
  });

  describe('skips plugin', function() {
    it('for .html extenstions', function(done) {
      supertest(this.server)
        .get('/index.html')
        .expect(404)
        .expect(function(res) {
          assert.isFalse(self.storage.readFileStream.called);
        })
        .end(done);
    });

    it('for extension-less', function(done) {
      supertest(this.server)
        .get('/about')
        .expect(404)
        .expect(function(res) {
          assert.isFalse(self.storage.readFileStream.called);
        })
        .end(done);
    });
  });

  it('serves static asset with max-age', function(done) {
    var filePath = 'data/ok.txt';
    var url = urljoin(this.server.settings.deployedAssetsPath, this.appId,
      this.versionId, filePath);
    supertest(this.server)
      .get(url)
      .expect(200)
      .expect('Content-Type', /text\/plain/)
      .expect('Cache-Control', 'max-age=' + self.server.settings.staticAssetMaxAge)
      .expect(function(res) {
        assert.equal(res.text, self.responseText);
        assert.isTrue(self.storage.readFileStream.calledWith(
          urljoin(self.appId, self.versionId, filePath)));
      })
      .end(done);
  });

  describe('returns 404 for missing files', function() {
    beforeEach(function() {
      this.storage.readFileStream = function() {
        return streamTestUtils.emitter('missing');
      };
    });

    it('for static asset', function(done) {
      supertest(this.server)
        .get('/deployments/' + this.appId + '/' + this.versionId + '/missing.txt')
        .expect(404)
        .end(done);
    });

    it('for root file', function(done) {
      supertest(this.server)
        .get('/missing.txt')
        .expect(404)
        .end(done);
    });
  });

  it('returns 500 when storage throws error', function(done) {
    this.storage.readFileStream = function() {
      return streamTestUtils.emitter('readError', Error.create('some error', {log: false}));
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

  it('sets content-type for any non html file type', function(done) {
    this.metadata.contentType = 'application/vnd.android.package-archive';

    supertest(this.server)
      .get('/android.apk')
      .expect(200)
      .expect('Content-Type', this.metadata.contentType)
      .end(done);
  });

  it('skips middleware for non static asset requests', function(done) {
    supertest(this.server)
      .get('/blog')
      .expect(404)
      .expect(function(res) {
        assert.isFalse(self.storage.readFileStream.called);
      })
      .end(done);
  });

  it('redirects request to localhost for dev sandbox', function(done) {
    this.extendedRequest.virtualEnv = 'local';
    this.extendedRequest.devOptions = {port: 9999};

    supertest(this.server)
      .get('/images/photo.png')
      .expect(302)
      .expect(function(res) {
        assert.isFalse(self.storage.readFileStream.called);
        assert.equal(res.headers.location, 'http://localhost:9999/images/photo.png');
      })
      .end(done);
  });

  it('serves media files', function(done) {
    var filePath = '/images/photo.png';
    supertest(this.server)
      .get(filePath)
      .expect(200)
      .expect('Content-Type', 'image/png')
      .expect(function(res) {
        assert.isTrue(self.storage.readFileStream.calledWith(urljoin(
          self.appId, self.versionId, 'images/photo.png')));
      })
      .end(done);
  });

  it('returns gzipped json file', function(done) {
    var contents = '{"hello": "world"}';

    this.metadata = {contentEncoding: 'gzip'};
    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.buffer(zlib.gzipSync(contents), {
        metadata: self.metadata
      });
    });

    supertest(this.server)
      .get('/hello.json')
      .expect('Content-Type', 'application/json')
      .expect('Content-Encoding', 'gzip')
      .expect(200)
      .expect(function(res) {
        assert.isTrue(self.storage.readFileStream.calledWith(self.appId + '/' + self.versionId + '/hello.json'));
        assert.equal(res.text, contents);
      })
      .end(done);
  });

  it('gzips un-compressed file from storage if client accepts', function(done) {
    var text = 'hello!';

    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.buffer(text, {metadata: {}});
    });

    supertest(this.server)
      .get('/hello.txt')
      .set('Accept-Encoding', 'gzip')
      .expect('Content-Type', /^text\/plain/)
      .expect('Content-Encoding', 'gzip')
      .expect('Vary', 'Accept-Encoding')
      .expect(200)
      .expect(function(res) {
        assert.equal(res.text, text);
      })
      .end(done);
  });

  it('gunzips encoded content when accepts header missing gzip', function(done) {
    var spec = {swagger: 'spec'};

    this.metadata = {contentEncoding: 'gzip'};
    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.buffer(zlib.gzipSync(JSON.stringify(spec)), {
        metadata: self.metadata
      });
    });

    supertest(this.server)
      .get('/swagger.json')
      .set('Accept-Encoding', 'none')
      .expect(200)
      .expect('Vary', 'Accept-Encoding')
      .expect('Content-Type', /application\/json/)
      .expect(function(res) {
        assert.isTrue(self.storage.getMetadata.called);
        assert.isTrue(self.storage.getMetadata.calledWith(self.appId + '/' + self.versionId + '/swagger.json'));
        assert.deepEqual(res.body, spec);
        assert.isTrue(_.isEmpty(res.headers['content-encoding']));
      })
      .end(done);
  });

  it('returns 404 for package.json', function(done) {
    supertest(this.server)
      .get('/package.json')
      .expect(404)
      .end(done);
  });

  it('updates __baseurl__ in xml files like sitemaps and rss feeds', function(done) {
    var contents = '<sitemap>' +
      '\n\t<url>' +
      '\n\t\t<loc>https://__baseurl__/about/us</loc></sitemap>' +
      '\n\t</url>' +
      '\n</sitemap>';

    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.buffer(contents);
    });

    supertest(this.server)
      .get('/sitemap.xml')
      .expect('Content-Type', 'application/xml')
      .expect(200)
      .expect(function(res) {
        var expected = '<sitemap>' +
          '\n\t<url>' +
          '\n\t\t<loc>http://127.0.0.1/about/us</loc></sitemap>' +
          '\n\t</url>' +
          '\n</sitemap>';

        assert.equal(res.text.trim(), expected);
      })
      .end(done);
  });

  it('handles double slashes in baseurl', function(done) {
    var contents = '<xml>https://__baseurl__//foo</xml>';

    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.buffer(contents);
    });

    supertest(this.server)
      .get('/sitemap.xml')
      .expect('Content-Type', 'application/xml')
      .expect(200)
      .expect(function(res) {
        var expected = '<xml>http://127.0.0.1/foo</xml>';
        assert.equal(res.text.trim(), expected);
      })
      .end(done);
  });

  it('updates __baseurl__ in json files', function(done) {
    var contents = JSON.stringify({
      url: 'https://__baseurl__/descriptor.json'
    });

    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.buffer(contents);
    });

    supertest(this.server)
      .get('/descriptor.json')
      .expect('Content-Type', 'application/json')
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(JSON.parse(res.text.trim()),
        {url: 'http://127.0.0.1/descriptor.json'});
      })
      .end(done);
  });

  it('returns base64 encoded response', function(done) {
    var contents = '<html></html>';

    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.buffer(contents);
    });

    supertest(this.server)
      .get('/file.txt')
      .set('Accept-Encoding', 'base64')
      .expect(200)
      .expect('Content-Encoding', 'base64')
      .expect(function(res) {
        assert.equal(new Buffer(res.text, 'base64'), contents);
      })
      .end(done);
  });
});
