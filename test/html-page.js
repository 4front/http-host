var assert = require('assert');
var sinon = require('sinon');
var express = require('express');
var shortid = require('shortid');
var stream = require('stream');
var supertest = require('supertest');
var urljoin = require('url-join');
var sbuff = require('simple-bufferstream');
var testUtil = require('./test-util');
var htmlPage = require('../lib/middleware/html-page');

var self;
describe('htmlPage', function() {

  beforeEach(function() {
    self = this;

    this.html = '<html><head><title>test page</title></head><body><div></div></body></html>';

    this.server = express();

    this.server.settings.staticAssetPath = 'http://assethost.com/deployments';
    this.server.settings.deployments = {
      readFileStream: sinon.spy(function(appId, versionId, pagePath) {
        return sbuff(self.html);
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
      },
      isAuthenticated: false
    };

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.options = {};

    this.server.get('/*', htmlPage(this.options));

    this.server.use(testUtil.errorHandler);
  });

  it('uses url path as pagePath.html', function(done) {
    supertest(this.server)
      .get('/docs/getting-started?fake=1')
      .expect(200)
      .expect('Virtual-App-Page', 'docs/getting-started.html')
      .expect(function(res) {
        assert.ok(self.server.settings.deployments.readFileStream.calledWith(
          self.extendedRequest.virtualApp.appId,
          self.extendedRequest.virtualAppVersion.versionId,
          'docs/getting-started.html'));
      })
      .end(done);
  });

  describe('authentication', function() {
    it('un-authenticated user redirected', function(done) {
      this.extendedRequest.isAuthenticated = false;
      this.options.auth = true;
      this.options.noAuthUrl = '/not-authorized';

      supertest(this.server)
        .get('/foo')
        .expect(302)
        .expect(/\/not-authorized/)
        .end(done);
    });

    it('un-authenticted with no authRedirect returns 401', function(done) {
      this.extendedRequest.isAuthenticated = false;
      this.options.auth = true;

      supertest(this.server)
        .get('/foo')
        .expect(401)
        .end(done);
    });

    it('redirects to root when path is not root', function(done) {
      this.extendedRequest.isAuthenticated = false;
      this.options.auth = true;
      this.options.noAuthPage = 'login.html';
      this.options.returnUrlCookie = 'return_url';

      supertest(this.server)
        .get('/foo?plan=1')
        .expect(302)
        .expect("Moved Temporarily. Redirecting to /")
        .expect('set-cookie', "return_url=" + encodeURIComponent('/foo?plan=1') + "; Path=/; HttpOnly")
        .end(done);
    });

    it('rewrites to login.html when path is root', function(done) {
      this.extendedRequest.isAuthenticated = false;
      this.options.auth = true;
      this.options.noAuthPage = 'login.html';

      supertest(this.server)
        .get('/')
        .expect(200)
        .expect('Virtual-App-Page', 'login.html')
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
    this.server.settings.deployments.readFileStream = function(appId, versionId, pagePath) {
      return createErrorStream()
        .on('error', function() {
          // Emit custom missing event
          this.emit('missing');
        });
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
    var self = this;

    this.extendedRequest.virtualAppVersion = {
      versionId: '345345'
    };

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect('Virtual-App-Version', this.extendedRequest.virtualAppVersion.versionId)
      .end(done);
  });

  describe('client config object', function() {
    it('sets object properties', function(done) {
      var version = this.extendedRequest.virtualAppVersion = {
        versionId: '345345',
        name: 'version1'
      };
      // var version = this.extendedRequest.virtualAppVersion;
      var virtualApp = this.extendedRequest.virtualApp;

      supertest(this.server)
        .get('/')
        .expect(function(res) {
          var clientConfig = parseClientConfig(res.text);
          assert.equal(clientConfig.buildType, 'release');
          assert.equal(clientConfig.pagePath, 'index.html');

          assert.equal(clientConfig.staticAssetPath, urljoin(
            self.server.settings.staticAssetPath,
            self.extendedRequest.virtualApp.appId,
            version.versionId));
        })
        .end(done);
    });
  });

  describe('asset URLs', function() {
    beforeEach(function() {
      self.html = '<html><head></head><body><script src="js/main.js"></script></html>';

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
          var scriptUrl = urljoin(self.server.settings.staticAssetPath, appId, '/123/js/main.js');
          assert.ok(res.text.indexOf(scriptUrl) !== -1);
        })
        .end(done);
    });

    it('rewrites asset URLs for relative', function(done) {
      self.server.settings.staticAssetPath = '/static';

      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          var scriptUrl = '/static/' + self.extendedRequest.virtualApp.appId + '/123/js/main.js';
          assert.ok(res.text.indexOf(scriptUrl) !== -1);
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

    it('detects trailing slash', function(done) {
      supertest(this.server)
        .get('/aBOUt/')
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
    this.extendedRequest.htmlOptions = {
      inject: {
        head: "<script src='custom-head.js'></script>"
      }
    };

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        var customHeadIndex = res.text.indexOf(self.extendedRequest.htmlOptions.inject.head);
        var clientConfigIndex = res.text.indexOf('__4front__=');

        assert.ok(customHeadIndex !== -1);
        assert.ok(clientConfigIndex !== -1);
        assert.ok(clientConfigIndex < customHeadIndex);
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
});

// Readable stream that emits an error
function createErrorStream() {
  var rs = stream.Readable();
  rs._read = function () {
    rs.emit('error', 'read error');
    rs.push(null);
  };
  return rs;
}

function parseClientConfig(text) {
  return JSON.parse(text.match('__4front__=(.*);')[1]);
}
