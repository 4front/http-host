
var assert = require('assert');
var memoryCache = require('memory-cache-stream');
var devSandbox = require('../lib/middleware/dev-sandbox');
var querystring = require('querystring');
var express = require('express');
var request = require('supertest');
var _ = require('lodash');
var debug = require('debug');
var cookieParser = require('cookie-parser');
var cheerio = require('cheerio');
var testUtil = require('./test-util');

require('simple-errors');

describe('devSandbox()', function(){
  var hostname = 'appname.platformhost.com';
  var self;

  beforeEach(function(){
    self = this;

    this.extendedRequest = {
      clientConfig: {},
      virtualEnv: 'dev',
      pagePath: 'index.html',
      virtualApp: {
        name: 'test-app',
        appId: '2awoifj48'
      }
    };

    this.server = express();

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.server.use(cookieParser());

    this.server.settings.cache = memoryCache();
    this.server.settings.cache.set('foo', 'bar');

    this.server.use(devSandbox({
      showBanner: true,
      port: 3000,
      liveReload: true,
      liveReloadPort: 35728
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

          req.ext.htmlPageStream.pipe(res);
        });
      }
    });

    this.server.use(testUtil.errorHandler);
  });

  afterEach(function() {
    this.server.settings.cache.flushall();
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
        .expect(/No user parameter found/, done);
    });
  });

  describe('when dev environment and devparams', function() {
    it('should redirect without devparams and set cookie', function(done) {
      var devOptions = {port:'3000', user:'43534534'};
      request(this.server)
        .get('/foo?_dev=' + encodeURIComponent(querystring.stringify(devOptions)))
        .set('Host', hostname)
        .expect(302)
        .expect('location', '/foo')
        .expect(function(res) {
          var setCookieHeader = res.headers['set-cookie'];
          assert.equal(1, setCookieHeader.length);
          var setCookieMatch = setCookieHeader[0].match(/_dev=(j[A-Z0-9%]+)/i);

          assert.equal(setCookieMatch.length, 2);
          assert.ok(_.isEqual(cookieParser.JSONCookie(decodeURIComponent(setCookieMatch[1])), devOptions));
        })
        .end(done);
    });
  });

  describe('when developer index.html page not in cache', function() {
    it('should return an error', function(done) {
      request(this.server)
        .get('/')
        .set('Cookie', '_dev=' + encodeURIComponent('j:{"user":"4534435"}') + '; _sandboxPage=1')
        .set('Host', hostname)
        .expect(404)
        .expect('Error-Code', 'pageNotFound')
        .end(done);
    });
  });

  describe('when dev environment and _dev cookie', function() {
    it('should return html', function(done) {
      var devOptions = {user: '34534345'};

      // Put some html into the cache with the correct key
      var html = '<html></html>';
      this.server.settings.cache.set(devOptions.user + '/' + this.extendedRequest.virtualApp.appId + '/' + self.extendedRequest.pagePath, html);

      request(this.server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', '_dev=' + encodeURIComponent('j:' + JSON.stringify(devOptions)) + '; _sandboxPage=1')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.text, html);
        })
        .end(done);
    });
  });

  describe('additional blocks injected into page', function(done) {
    beforeEach(function() {
      // Put some html into the cache with the correct key
      var html = '<html><head></head><body></body></html>';
      this.userId = '123';

      var cacheKey = this.userId + '/' + this.extendedRequest.virtualApp.appId
        + '/' + self.extendedRequest.pagePath;

      this.server.settings.cache.set(cacheKey, html);
      this.extendedRequest.sendJsonExtendedRequest = true;
    });

    it('should inject simulator banner', function(done) {
      request(this.server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', '_dev=' + encodeURIComponent('j:{"user":"123"}'))
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
        .set('Cookie', '_dev=' + encodeURIComponent('j:{"user":"123"}'))
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.clientConfig.simulator, true);
          assert.equal(res.body.buildType, 'debug');
          assert.equal(res.body.versionAssetPath, '//localhost:3000');
        })
        .end(done);
    });

    it('should render livereload', function(done) {
      request(this.server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', '_dev=' + encodeURIComponent('j:{"user":"123"}'))
        .expect(200)
        .expect(function(res) {
          assert.ok(res.body.htmlOptions.liveReload);
        })
        .end(done);
    });
  });
});
