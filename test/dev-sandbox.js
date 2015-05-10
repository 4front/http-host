
var assert = require('assert');
var sinon = require('sinon');
var memoryCache = require('memory-cache-stream');
var devSandbox = require('../lib/middleware/dev-sandbox');
var querystring = require('querystring');
var express = require('express');
var request = require('supertest');
var urljoin = require('url-join');
var _ = require('lodash');
var debug = require('debug');
var cookieParser = require('cookie-parser');
var shortid = require('shortid');
var jwt = require('jwt-simple');
var testUtil = require('./test-util');

require('dash-assert');
require('simple-errors');

describe('devSandbox()', function(){
  var hostname = 'appname.platformhost.com';
  var self;

  beforeEach(function(){
    self = this;

    this.userId = shortid.generate();
    this.virtualApp = {
      name: 'test-app',
      appId: '2awoifj48'
    };

    this.extendedRequest = {
      clientConfig: {},
      virtualEnv: 'dev',
      pagePath: 'index.html',
      user: {
        userId: this.userId
      },
      virtualApp: this.virtualApp
    };

    this.server = express();
    this.server.settings.jwtTokenSecret = 'token_secret';

    this.devOptions = {
      port: 3000,
      liveReload: '1',
      token: jwt.encode({
        iss: this.userId,
        exp: Date.now() + 10000
      }, this.server.settings.jwtTokenSecret)
    };

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.server.use(cookieParser());

    this.server.settings.cache = memoryCache();
    this.server.settings.cache.set(
      this.userId + '/' + this.extendedRequest.virtualApp.appId + '/_manifest',
      JSON.stringify({router:[]}));

    this.server.use(devSandbox({
      showBanner: true,
      port: 3000,
      liveReload: true
    }));

    this.server.use(function(req, res, next) {
      if (req.ext.sendJsonExtendedRequest === true) {
        return res.json(req.ext);
      }
      else {
        // Simulate what the html-page middleware does.
        res.set('Content-Type', 'text/html');

        var dataRead = false;
        req.ext.pagePath = 'index.html';
        req.ext.loadPageMiddleware(req, res, function(err) {
          if (_.isError(err))
            return next(err);

          req.ext.pageStream.pipe(res);
        });
      }
    });

    this.server.use(testUtil.errorHandler);
  });

  describe('when request includes file extension', function() {
    it("should redirect to localhost", function(done) {
      request(this.server)
        .get('/js/app.js')
        .set('Host', hostname)
        .expect(302)
        .expect("location", "http://localhost:3000/js/app.js")
        .end(done);
    });
  });

  describe('when dev environment and no cookies and no devparams', function() {
    it('should return error', function(done) {
      request(this.server)
        .get('/')
        .set('Host', hostname)
        .expect(400)
        .expect(/Invalid _dev cookie/, done);
    });
  });

  describe('when dev environment and devparams', function() {
    it('should redirect without devparams and set cookie', function(done) {
      request(this.server)
        .get('/foo?_dev=' + encodeURIComponent(querystring.stringify(this.devOptions)))
        .set('Host', hostname)
        .expect(302)
        .expect('location', '/foo')
        .expect(function(res) {
          var setCookieHeader = res.headers['set-cookie'];
          assert.equal(1, setCookieHeader.length);
          var setCookie = querystring.parse(setCookieHeader[0]);
          assert.deepEqual(cookieParser.JSONCookie(setCookie._dev.split(';')[0]), self.devOptions);
        })
        .end(done);
    });
  });

  describe('when developer index.html page not in cache', function() {
    it('should return an error', function(done) {
      request(this.server)
        .get('/')
        .set('Cookie', '_dev=' + encodeURIComponent('j:' + JSON.stringify(self.devOptions)) + '; _sandboxPage=1')
        .set('Host', hostname)
        .expect(404)
        .expect('Error-Code', 'pageNotFound')
        .end(done);
    });
  });

  describe('when dev environment and _dev cookie', function() {
    it('should return html', function(done) {
      // Put some html into the cache with the correct key
      var html = '<html></html>';
      this.server.settings.cache.set(urljoin(this.userId,
        this.extendedRequest.virtualApp.appId,
        self.extendedRequest.pagePath), html);

      request(this.server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', '_dev=' + encodeURIComponent('j:' + JSON.stringify(this.devOptions)) + '; _sandboxPage=1')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.text, html);
        })
        .end(done);
    });

    it('jwt is expired returns 400', function(done) {
      this.devOptions.token = jwt.encode({
        iss: this.userId,
        exp: Date.now() - 10000
      }, this.server.settings.jwtTokenSecret);

      request(this.server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', '_dev=' + encodeURIComponent('j:' + JSON.stringify(this.devOptions)) + '; _sandboxPage=1')
        .expect(401)
        .end(done);
    });
  });

  describe('additional blocks injected into page', function(done) {
    beforeEach(function() {
      // Put some html into the cache with the correct key
      var html = '<html><head></head><body></body></html>';

      var cacheKey = urljoin(this.userId,
        this.extendedRequest.virtualApp.appId,
        self.extendedRequest.pagePath);

      this.server.settings.cache.set(cacheKey, html);
      this.extendedRequest.sendJsonExtendedRequest = true;
    });

    it('should inject simulator banner', function(done) {
      request(this.server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', '_dev=' + encodeURIComponent('j:' + JSON.stringify(this.devOptions)))
        .expect(200)
        .expect(function(res) {
          assert.ok(res.body.htmlOptions.inject.head.indexOf('<style>body::after{background-image:url') > -1);
        })
        .end(done);
    });

    it('should have __config__ variable', function(done) {
      request(this.server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', '_dev=' + encodeURIComponent('j:' + JSON.stringify(this.devOptions)))
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.clientConfig.sandbox, true);
          assert.equal(res.body.buildType, 'debug');
          assert.equal(res.body.versionAssetPath, '//localhost:3000');
        })
        .end(done);
    });

    it('should render livereload', function(done) {
      request(this.server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', '_dev=' + encodeURIComponent('j:' + JSON.stringify(this.devOptions)))
        .expect(200)
        .expect(function(res) {
          assert.isTrue(res.body.htmlOptions.liveReload);
        })
        .end(done);
    });
  });

  describe('manifest', function() {
    it('manifest missing from cache', function(done) {
      this.server.settings.cache.del(this.userId + '/' + this.virtualApp.appId + '/_manifest');

      request(this.server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', '_dev=' + encodeURIComponent('j:' + JSON.stringify(this.devOptions)))
        .expect(400)
        .expect('Error-Code', 'invalidJsonManifest')
        .end(done);
    });
  });
});
