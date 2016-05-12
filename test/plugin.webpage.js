var assert = require('assert');
var _ = require('lodash');
var async = require('async');
var sinon = require('sinon');
var express = require('express');
var shortid = require('shortid');
var supertest = require('supertest');
var urljoin = require('url-join');
var onHeaders = require('on-headers');
var memoryCache = require('memory-cache-stream');
var streamTestUtils = require('./stream-test-utils');
var testUtil = require('./test-util');
var webPage = require('../lib/plugins/webpage');
var debug = require('debug')('4front:test');

require('dash-assert');

var self;
describe('webPage', function() {
  beforeEach(function() {
    self = this;

    this.pageContent = '<html><head><title>test page</title></head><body><div></div></body></html>';

    this.server = express();

    this.server.settings.deployedAssetsPath = 'assethost.com/deployments';
    this.contentCache = this.server.settings.contentCache = memoryCache();

    this.storage = this.server.settings.storage = {
      readFileStream: sinon.spy(function() {
        return streamTestUtils.buffer(self.pageContent);
      })
    };

    this.appId = shortid.generate();
    this.versionId = shortid.generate();

    this.extendedRequest = {
      virtualApp: {
        appId: this.appId,
        name: 'test-app'
      },
      virtualEnv: 'production',
      virtualAppVersion: {
        versionId: this.versionId,
        name: 'v1'
      },
      contentCacheEnabled: true
    };

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      onHeaders(res, function() {
        debug('headers about to be set');
      });
      next();
    });

    this.options = {};

    this.server.get('/*', function(req, res, next) {
      webPage(self.options)(req, res, next);
    });

    this.server.all('*', function(req, res, next) {
      next(Error.http(404, 'Page not found', {code: 'pageNotFound'}));
    });

    this.server.use(testUtil.errorHandler);
  });

  it('skips plugin for non-html extension', function(done) {
    supertest(this.server)
      .get('/hello.txt')
      .expect(404)
      .expect(function(res) {
        assert.isFalse(self.server.settings.storage.readFileStream.called);
      })
      .end(done);
  });

  describe('html page request', function() {
    it('uses url path as webPagePath.html', function(done) {
      supertest(this.server)
        .get('/docs/getting-started?fake=1')
        .expect(200)
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
        .get('/?foo=1&blah=5')
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

  describe('missing alternate redirects', function() {
    beforeEach(function() {
      self = this;
      this.existingFiles = [];
      this.server.settings.storage.readFileStream = function() {
        return streamTestUtils.emitter('missing');
      };

      this.server.settings.storage.fileExists = sinon.spy(function(filePath, cb) {
        cb(null, _.includes(self.existingFiles, filePath));
      });
    });

    it('trailing slash version when original non-trailing slash missing', function(done) {
      this.existingFiles.push(this.appId + '/' + this.versionId + '/blog/index.html');

      supertest(this.server)
        .get('/blog')
        .expect(302)
        .expect('Cache-Control', 'no-cache')
        .expect(function(res) {
          assert.equal(res.headers.location, '/blog/');
          assert.isTrue(self.server.settings.storage.fileExists.calledWith(
            self.appId + '/' + self.versionId + '/blog/index.html'));
        })
        .end(done);
    });

    it('non-trailing slash version when trailing slash requested', function(done) {
      this.existingFiles.push(this.appId + '/' + this.versionId + '/blog.html');

      supertest(this.server)
        .get('/blog/')
        .expect(302)
        .expect(function(res) {
          assert.equal(res.headers.location, '/blog');
          assert.isTrue(self.server.settings.storage.fileExists.calledWith(
            self.appId + '/' + self.versionId + '/blog.html'));
        })
        .end(done);
    });

    it('to lowercase version when uppercase letters present', function(done) {
      this.existingFiles.push(this.appId + '/' + this.versionId + '/path/about.html');

      supertest(this.server)
        .get('/Path/About?foo=1')
        .expect(301)
        .expect(function(res) {
          assert.equal(res.headers.location, '/path/about?foo=1');
          assert.isTrue(self.server.settings.storage.fileExists.calledWith(
            self.appId + '/' + self.versionId + '/path/about.html'));
        })
        .end(done);
    });

    it('returns 404 if no alternates found', function(done) {
      supertest(this.server)
        .get('/')
        .expect(404)
        .expect('Error-Code', 'pageNotFound')
        .end(done);
    });
  });

  describe('fallback pages', function() {
    beforeEach(function() {
      self = this;
      this.existingFiles = [];

      _.assign(this.storage, {
        getMetadata: function(filePath, cb) {
          cb(null, {});
        },
        fileExists: sinon.spy(function(filePath, cb) {
          cb(null, _.includes(self.existingFiles, filePath));
        }),
        readFileStream: sinon.spy(function(filePath) {
          if (_.endsWith(filePath, 'index.xml')) {
            return streamTestUtils.buffer('<xml/>');
          } else if (_.endsWith(filePath, 'index.json')) {
            return streamTestUtils.buffer('{}');
          }
          return streamTestUtils.emitter('missing');
        })
      });
    });

    it('renders fallback index.xml page', function(done) {
      this.existingFiles.push(this.appId + '/' + this.versionId + '/index.xml');
      supertest(this.server)
        .get('/')
        .expect(200)
        .expect('Content-Type', 'application/xml')
        .expect(function(res) {
          assert.equal(self.storage.readFileStream.callCount, 2);
          assert.isTrue(self.storage.readFileStream.calledWith(
            self.appId + '/' + self.versionId + '/index.html'));
          assert.isTrue(self.storage.readFileStream.calledWith(
            self.appId + '/' + self.versionId + '/index.xml'));
          assert.isTrue(self.storage.fileExists.calledWith(
            self.appId + '/' + self.versionId + '/index.xml'));
        })
        .end(done);
    });

    it('renders fallback index.json page', function(done) {
      this.existingFiles.push(this.appId + '/' + this.versionId + '/blog/index.json');
      supertest(this.server)
        .get('/blog/')
        .expect(200)
        .expect('Content-Type', 'application/json')
        .expect(function(res) {
          assert.isTrue(self.storage.fileExists.calledWith(
            self.appId + '/' + self.versionId + '/blog/index.xml'));
          assert.isTrue(self.storage.fileExists.calledWith(
            self.appId + '/' + self.versionId + '/blog/index.json'));
          assert.equal(self.storage.readFileStream.callCount, 2);
          assert.isTrue(self.storage.readFileStream.calledWith(
            self.appId + '/' + self.versionId + '/blog/index.html'));
          assert.isFalse(self.storage.readFileStream.calledWith(
            self.appId + '/' + self.versionId + '/blog/index.xml'));
          assert.isTrue(self.storage.readFileStream.calledWith(
            self.appId + '/' + self.versionId + '/blog/index.json'));
        })
        .end(done);
    });
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
    });

    it('rewrites asset URLs for CDN', function(done) {
      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          var scriptUrl = '//' + urljoin(self.server.settings.deployedAssetsPath,
            self.appId, self.versionId, '/js/main.js');

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
          var scriptUrl = '/static/' + self.appId + '/' + self.versionId + '/js/main.js';
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
            self.appId, self.versionId, 'img/photo.jpg');
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

  describe('redirects', function() {
    it('redirect request with html extension to extensionless', function(done) {
      supertest(this.server)
        .get('/about.html')
        .expect(301)
        .expect(function(res) {
          assert.equal('/about', res.headers.location);
        })
        .end(done);
    });

    it('redirects index.html to bare trailing slash', function(done) {
      supertest(this.server)
        .get('/about/index.html')
        .expect(301)
        .expect(function(res) {
          assert.equal('/about/', res.headers.location);
        })
        .end(done);
    });

    it('redirect /index to bare trailing slash', function(done) {
      supertest(this.server)
        .get('/about/index?name=bill')
        .expect(301)
        .expect(function(res) {
          assert.equal('/about/?name=bill', res.headers.location);
        })
        .end(done);
    });

    it('does not redirect .html if canonicalRedirects is false', function(done) {
      this.options.canonicalRedirects = false;
      supertest(this.server)
        .get('/about/index.html')
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.server.settings.storage.readFileStream.calledWith(sinon.match(/\/about\/index\.html$/)));
        })
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
        assert.notEqual(res.text.indexOf('__4front__=_global'), -1);
      })
      .end(done);
  });

  it('allows omitting the client config var', function(done) {
    self.pageContent = '<html><head></head></html>';
    this.options.omitClientConfigVar = true;

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        assert.equal(res.text.indexOf('<script'), -1);
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

  describe('caching', function() {
    beforeEach(function() {
      self.server.settings.enableContentCache = function() { return true;};
    });

    it('caches get requests', function(done) {
      var contentCacheKey;
      var htmlResponse;

      async.series([
        function(cb) {
          supertest(self.server)
            .get('/')
            .expect(200)
            .expect('X-Server-Cache', 'MISS')
            .expect('content-type', /^text\/html/)
            .expect(function(res) {
              assert.isTrue(self.server.settings.storage.readFileStream.called);
              assert.ok(res.headers.etag);
              contentCacheKey = res.headers.etag.slice(1, -1);
              htmlResponse = res.text;
            })
            .end(cb);
        },
        function(cb) {
          self.contentCache.get(contentCacheKey, function(err, content) {
            if (err) return cb(err);
            assert.equal(content, htmlResponse);
            cb();
          });
        },
        function(cb) {
          // Make another request. This time the response should come
          // from the cache and the storage should have have been touched.
          self.server.settings.storage.readFileStream.reset();
          supertest(self.server)
            .get('/')
            .expect(200)
            .expect('ETag', '"' + contentCacheKey + '"')
            .expect('X-Server-Cache', 'HIT')
            .expect(htmlResponse)
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
            .expect(200)
            .expect('X-Server-Cache', 'MISS')
            .expect(function(res) {
              assert.isTrue(self.server.settings.storage.readFileStream.called);
              assert.ok(res.headers.etag);
              assert.notEqual(res.headers.etag, '"' + contentCacheKey + '"');
              assert.notEqual(res.text, htmlResponse);
              contentCacheKey = res.headers.etag.slice(1, -1);
              htmlResponse = res.text;
            })
            .end(cb);
        },
        function(cb) {
          // Check one last time that the html response is in the cache
          // under the new cache key.
          self.contentCache.get(contentCacheKey, function(err, content) {
            if (err) return cb(err);
            assert.equal(content, htmlResponse);
            cb();
          });
        }
      ], done);
    });
  });

  it('does not cache missing pages', function(done) {
    self.contentCache.flushall();
    this.storage.readFileStream = sinon.spy(function() {
      return streamTestUtils.emitter('missing');
    });

    this.storage.fileExists = sinon.spy(function(filePath, cb) {
      cb(null, false);
    });

    supertest(self.server)
      .get('/missing')
      .expect(404)
      .expect('X-Server-Cache', 'MISS')
      .expect(function(res) {
        assert.isTrue(self.storage.readFileStream.calledWith(sinon.match(/missing\.html/)));
        assert.equal(self.contentCache.keys().length, 0);
      })
      .end(done);
  });
});

function parseClientConfig(text) {
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
}
