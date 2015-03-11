var assert = require('assert');
var express = require('express');
var shortid = require('shortid');
var stream = require('stream');
var supertest = require('supertest');
var htmlPage = require('../lib/middleware/html-page');

var self;
describe('htmlPage', function() {

  beforeEach(function() {
    self = this;

    this.html = '<html><head><title>test page</title></head><body><div></div></body></html>';

    this.server = express();
    this.server.settings.assetStorage = {
      createReadStream: function(appId, versionId, pageName) {
        return createReadStream(self.html);
      }
    };

    this.extendedRequest = {
      virtualApp: {
        appId: shortid.generate(), 
        name: 'test-app'   
      },
      virtualEnv: 'production',
      isAuthenticated: false
    };

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.options = {};

    this.server.get('/*', htmlPage(this.options));

    this.server.use(function(err, req, res, next) {
      res.statusCode = err.status || 500;
      if (res.statusCode >= 500)
        console.log(err.stack);

      res.send(err.message);
    });
  });

  it('uses url path as pageName.html', function(done) {
    supertest(this.server)
      .get('/docs/getting-started?fake=1')
      .expect(200)
      .expect('Virtual-App-Page', 'docs/getting-started.html')
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

    it('returns noauth page', function(done) {
      this.extendedRequest.isAuthenticated = false;
      this.options.auth = true;
      this.options.noAuthPage = 'login.html';

      supertest(this.server)
        .get('/foo')
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
      .expect('Virtual-App-Version', 'latest')
      .expect(/\<title\>test page\<\/title\>/)
      .end(done);
  });

  it('returns 404 status code', function(done) {
    this.server.settings.assetStorage = {
      createReadStream: function(appId, versionId, pageName) {
        return createErrorStream()
          .on('error', function() {
            // Emit custom missing event
            this.emit('missing');
          });
      }
    };

    supertest(this.server)
      .get('/')
      .expect(404)
      .expect('Content-Type', /^text\/html/)
      .expect('Virtual-App-Version', 'latest')
      .expect(/Page index\.html not found/)
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
          assert.equal(clientConfig.pageName, 'index.html');
          assert.equal(clientConfig.versionId, version.versionId);
          assert.equal(clientConfig.versionName, version.name);

          assert.equal(clientConfig.assetPath, self.options.assetPath + '/' + version.versionId);
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
      self.options.assetPath = '//mycdn.com/';

      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          var scriptUrl = '//mycdn.com/' + appId + '/123/js/main.js';
          assert.ok(res.text.indexOf(scriptUrl) !== -1);
        })
        .end(done);
    });

    it('rewrites asset URLs for relative', function(done) {
      self.options.assetPath = '/static/';

      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          var scriptUrl = '/static/123/js/main.js';
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
        var clientConfigIndex = res.text.indexOf('__config__=');

        assert.ok(customHeadIndex !== -1);
        assert.ok(clientConfigIndex !== -1);
        assert.ok(clientConfigIndex < customHeadIndex);
      })
      .end(done);
  });

  it('extends htmlOptions from req.ext.htmlOptions', function(done) {
    this.extendedRequest.htmlOptions = {
      liveReload: true,
      liveReloadPort: 35728
    };

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        assert.ok(res.text.indexOf('//localhost:35728/livereload.js') > -1);
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

function createReadStream(str) {
  var rs = stream.Readable();
  rs._read = function () {
    rs.push(str);
    rs.push(null);
  };
  return rs;
}

function parseClientConfig(text) {
  return JSON.parse(text.match('__config__=(.*);')[1]);
}