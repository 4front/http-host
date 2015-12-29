var assert = require('assert');
var async = require('async');
var sinon = require('sinon');
var express = require('express');
var shortid = require('shortid');
var supertest = require('supertest');
var urljoin = require('url-join');
var testUtil = require('./test-util');
var sbuff = require('simple-bufferstream');
var webPage = require('../lib/plugins/webpage');
var compression = require('compression');
var EventEmitter = testUtil.EventEmitter;

require('dash-assert');

var self;
describe('webPage', function() {
  beforeEach(function() {
    self = this;

    this.pageContent = '<html><head><title>test page</title></head><body><div></div></body></html>';

    this.server = express();
    this.server.disable('etag');

    this.server.settings.deployedAssetsPath = 'assethost.com/deployments';
    this.server.settings.storage = {
      readFileStream: sinon.spy(function() {
        var emitter = new EventEmitter();
        process.nextTick(function() {
          emitter.emit('stream', sbuff(self.pageContent));
        });
        return emitter;
      })
    };

    this.extendedRequest = {
      virtualApp: {
        appId: shortid.generate(),
        name: 'test-app'
      },
      virtualEnv: 'production',
      virtualAppVersion: {
        versionId: shortid.generate(),
        name: 'v1'
      }
    };

    this.server.use(compression());

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.options = {};

    this.server.get('/*', webPage(this.options));

    this.server.all('*', function(req, res, next) {
      next(Error.http(404, 'Page not found', {code: 'pageNotFound'}));
    });

    this.server.use(testUtil.errorHandler);
  });

  describe('html page request', function() {
    it('uses url path as webPagePath.html', function(done) {
      supertest(this.server)
        .get('/docs/getting-started?fake=1')
        .expect(200)
        .expect('Content-Encoding', 'gzip')
        .expect('Virtual-App-Page', 'docs/getting-started.html')
        .expect(function(res) {
          assert.ok(self.server.settings.storage.readFileStream.calledWith(
            urljoin(self.extendedRequest.virtualApp.appId,
              self.extendedRequest.virtualAppVersion.versionId,
              'docs/getting-started.html')));
        })
        .end(done);
    });

    it('uses default page for root request', function(done) {
      supertest(this.server)
        .get('/')
        .expect(200)
        .expect('Virtual-App-Page', 'index.html')
        .expect(function(res) {
          assert.ok(self.server.settings.storage.readFileStream.calledWith(
            urljoin(self.extendedRequest.virtualApp.appId,
              self.extendedRequest.virtualAppVersion.versionId,
              'index.html')));
        })
        .end(done);
    });

    it('uses default page when trailing slash', function(done) {
      supertest(this.server)
        .get('/docs/')
        .expect(200)
        .expect('Virtual-App-Page', 'docs/index.html')
        .expect(function(res) {
          assert.ok(self.server.settings.storage.readFileStream.calledWith(
            urljoin(self.extendedRequest.virtualApp.appId,
              self.extendedRequest.virtualAppVersion.versionId,
              'docs/index.html')));
        })
        .end(done);
    });
  });

  it('returns 400 if no virtualApp context', function(done) {
    this.extendedRequest.virtualApp = null;

    supertest(this.server)
      .get('/')
      .expect(400)
      .end(done);
  });

  it('returns html', function(done) {
    supertest(this.server)
      .get('/')
      .expect(200)
      .expect('Content-Type', /^text\/html/)
      .expect('Virtual-App-Version', this.extendedRequest.virtualAppVersion.versionId)
      .expect(/\<title\>test page\<\/title\>/)
      .end(done);
  });

  it('returns 404 status code', function(done) {
    this.server.settings.storage.readFileStream = function() {
      var emitter = new EventEmitter();
      process.nextTick(function() {
        emitter.emit('missing');
      });
      return emitter;
    };

    supertest(this.server)
      .get('/')
      .expect(404)
      .expect('Error-Code', 'pageNotFound')
      .end(done);
  });

  it('defaults to no-cache header', function(done) {
    supertest(this.server)
      .get('/')
      .expect(200)
      .expect('Cache-Control', 'no-cache')
      .end(done);
  });

  it('recognizes Cache-Control option', function(done) {
    this.options.cacheControl = 'max-age=60';

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect('Cache-Control', 'max-age=60')
      .end(done);
  });

  it('sets virtual app version header', function(done) {
    self = this;

    this.extendedRequest.virtualAppVersion = {
      versionId: '345345'
    };

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect('Virtual-App-Version', this.extendedRequest.virtualAppVersion.versionId)
      .end(done);
  });

  it('redirects to index.html when original path not found', function(done) {
    this.server.settings.storage.readFileStream = function() {
      var emitter = new EventEmitter();
      process.nextTick(function() {
        emitter.emit('missing');
      });
      return emitter;
    };

    this.server.settings.storage.fileExists = sinon.spy(function(pagePath, cb) {
      cb(null, true);
    });

    supertest(this.server)
      .get('/blog')
      .expect(302)
      .expect(function(res) {
        assert.equal(res.headers.location, '/blog/');
        assert.isTrue(self.server.settings.storage.fileExists.calledWith(
          self.extendedRequest.virtualApp.appId + '/' +
          self.extendedRequest.virtualAppVersion.versionId +
          '/blog/index.html'));
      })
      .end(done);
  });

  describe('client config object', function() {
    it('sets object properties', function(done) {
      var version = this.extendedRequest.virtualAppVersion = {
        versionId: '345345',
        name: 'version1'
      };

      supertest(this.server)
        .get('/')
        .expect(function(res) {
          var clientConfig = parseClientConfig(res.text);
          assert.equal(clientConfig.buildType, 'release');
          assert.equal(clientConfig.webPagePath, 'index.html');

          assert.equal(clientConfig.staticAssetPath, '//' + urljoin(
            self.server.settings.deployedAssetsPath,
            self.extendedRequest.virtualApp.appId,
            version.versionId));
        })
        .end(done);
    });
  });

  describe('asset URLs', function() {
    beforeEach(function() {
      self.pageContent = '<html><head></head><body><script src="js/main.js"></script></html>';

      this.options.htmlprep = true;
      this.extendedRequest.virtualAppVersion = {
        versionId: '123'
      };
    });

    it('rewrites asset URLs for CDN', function(done) {
      var appId = self.extendedRequest.virtualApp.appId;

      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          var scriptUrl = '//' + urljoin(self.server.settings.deployedAssetsPath, appId, '/123/js/main.js');
          assert.ok(res.text.indexOf(scriptUrl) !== -1);
        })
        .end(done);
    });

    it('rewrites asset URLs for relative', function(done) {
      self.server.settings.deployedAssetsPath = '/static';

      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          var scriptUrl = '/static/' + self.extendedRequest.virtualApp.appId + '/123/js/main.js';
          assert.ok(res.text.indexOf(scriptUrl) !== -1);
        })
        .end(done);
    });

    it('rewrites asset url for relative paths', function(done) {
      self.pageContent = '<html><img src="../img/photo.jpg"></html>';

      supertest(this.server).get('/blog/summer-post')
        .expect(200)
        .expect(function(res) {
          var expectedPath = urljoin(self.server.settings.deployedAssetsPath,
            self.extendedRequest.virtualApp.appId, '123/blog/../img/photo.jpg');
          assert.equal(res.text, '<html><img src="//' + expectedPath + '"/></html>');
        })
        .end(done);
    });
  });

  describe('pushState', function() {
    beforeEach(function() {
      this.options.pushState = true;
    });

    it('requests for deep paths return index.html', function(done) {
      supertest(this.server)
        .get('/some/deep/path')
        .expect(200)
        .expect('content-type', /^text\/html/)
        .expect('virtual-app-page', 'index.html')
        .end(done);
    });
  });

  describe('canonical redirects', function() {
    beforeEach(function() {
      this.options.canonicalRedirects = true;
    });

    it('detects html extension', function(done) {
      supertest(this.server)
        .get('/about.html')
        .expect(301)
        .expect(/Redirecting to \/about$/)
        .end(done);
    });

    it('detects uppercase letters', function(done) {
      supertest(this.server)
        .get('/path/ABOUT')
        .expect(301)
        .expect(/Redirecting to \/path\/about$/)
        .end(done);
    });
  });

  it('merges html blocks', function(done) {
    var customScript = "<script src='custom-head.js'></script>";
    this.extendedRequest.htmlOptions = {
      inject: {
        head: customScript
      }
    };

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        var customHeadIndex = res.text.indexOf(customScript);
        var clientConfigIndex = res.text.indexOf('__4front__=');

        assert.notEqual(customHeadIndex, -1);
        assert.notEqual(clientConfigIndex, -1);
        assert.ok(clientConfigIndex < customHeadIndex);
      })
      .end(done);
  });

  it('supports a custom global config variable', function(done) {
    this.server.settings.clientConfigVar = '_global';
    supertest(this.server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        assert.notEqual(res.text.indexOf('_global=__4front__='), -1);
      })
      .end(done);
  });

  it('extends htmlOptions from req.ext.htmlOptions', function(done) {
    this.extendedRequest.htmlOptions = {
      liveReload: true
    };

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        assert.ok(res.text.indexOf('/livereload') > -1);
      })
      .end(done);
  });

  it('it takes a pass on non-html files', function(done) {
    supertest(this.server)
      .get('/image.png')
      .expect(404)
      .end(done);
  });

  it('ETag varies when clientConfig changes', function(done) {
    var initialETag;
    async.series([
      function(cb) {
        supertest(self.server)
          .get('/')
          .expect(200)
          .expect('content-type', /^text\/html/)
          .expect(function(res) {
            assert.isTrue(self.server.settings.storage.readFileStream.called);
            assert.ok(res.headers.etag);
            initialETag = res.headers.etag;
          })
          .end(cb);
      },
      function(cb) {
        self.server.settings.storage.readFileStream.reset();
        supertest(self.server)
          .get('/')
          .set('If-None-Match', initialETag)
          .expect(304)
          .expect(function(res) {
            assert.isFalse(self.server.settings.storage.readFileStream.called);
          })
          .end(cb);
      },
      function(cb) {
        self.server.settings.storage.readFileStream.reset();
        // Change the versionId which should result in a different etag.
        self.extendedRequest.virtualAppVersion.versionId = shortid.generate();

        supertest(self.server)
          .get('/')
          .set('If-None-Match', initialETag)
          .expect(200)
          .expect(function(res) {
            assert.isTrue(self.server.settings.storage.readFileStream.called);
            assert.ok(res.headers.etag);
            assert.isFalse(res.headers.etag === initialETag);
          })
          .end(cb);
      }
    ], done);
  });

  it('does not gzip if client does not accept', function(done) {
    supertest(this.server)
      .get('/docs/getting-started')
      .set('Accept-Encoding', 'none')
      .expect(200)
      .expect(function(res) {
        assert.isEmpty(res.headers['content-encoding']);
      })
      .end(done);
  });
});

function parseClientConfig(text) {
  return JSON.parse(text.match(/__4front__=(.*);/)[1]);
}
