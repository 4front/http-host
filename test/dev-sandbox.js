
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

describe('devSandbox()', function(){
  var hostname = 'appname.platformhost.com';

  var server, self;

  beforeEach(function(){
    self = this;

    this.extendedRequest = {
      clientConfig: {},
      virtualEnv: 'dev',
      pageName: 'index.html',
      virtualApp: {
        name: 'test-app',
        appId: '2awoifj48'
      }
    };

    server = express();

    server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    server.use(cookieParser());

    this.cache = memoryCache();
    this.cache.set('foo', 'bar');

    server.use(devSandbox({
      cache: this.cache,
      showBanner: true,
      port: 3000,
      liveReload: true
    }));

    server.use(function(req, res, next) {
      if (req.ext.sendJsonExtendedRequest === true) {
        return res.json(req.ext);
      }
      else {
        // Simulate what the html-page middleware does.
        res.set('Content-Type', 'text/html');

        var pageMissing;
        req.ext.assetStorage.createReadStream(req.ext.virtualApp.appId, req.ext.virtualEnv, req.ext.pageName)
          .on('missing', function(err) {
            pageMissing = true;
            return next(Error.http(404, err.message));
          })
          .on('data', function(chunk) {
            if (!pageMissing)
              res.write(chunk);
          })
          .on('end', function() {
            res.end();
          });
      }
    });

    server.use(function(err, req, res, next) {
      res.statusCode = err.status || 500;
      if (res.statusCode === 500)
        console.log(err.stack);

      res.end(err.message);
    });
  });

  afterEach(function() {
    this.cache.flushall();
  });

  describe('when request includes file extension', function() {
    it("should redirect to localhost", function(done) {
      request(server)
        .get('/js/app.js')
        .set('Host', hostname)
        .expect(302)
        .expect("location", "http://localhost:3000/js/app.js")
        .end(done);
    });
  });

  describe('when dev environment and no cookies and no devparams', function() {
    it('should return error', function(done) {
      request(server)
        .get('/')
        .set('Host', hostname)
        .expect(400)
        .expect(/No user parameter found/, done);
    });
  });

  describe('when dev environment and devparams', function() {
    it('should redirect without devparams and set cookie', function(done) {
      var devOptions = {port:'3000', user:'43534534'};
      request(server)
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
      request(server)
        .get('/')
        .set('Cookie', '_dev=' + encodeURIComponent('j:{"user":"4534435"}'))
        .set('Host', hostname)
        .expect(404)
        .expect(/Page index.html not found in sandbox cache/, done);
    });
  });

  describe('when dev environment and _dev cookie', function() {
    it('should return html', function(done) {
      var devOptions = {user: '34534345'};

      // Put some html into the cache with the correct key
      var html = '<html></html>';
      this.cache.set(this.extendedRequest.virtualApp.appId + ':' + devOptions.user + ':' + self.extendedRequest.pageName, html);

      request(server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', '_dev=' + encodeURIComponent('j:' + JSON.stringify(devOptions)))
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

      var cacheKey = [
        this.extendedRequest.virtualApp.appId, 
        this.userId,
        self.extendedRequest.pageName
      ].join(':');

      this.cache.set(cacheKey, html);
      this.extendedRequest.sendJsonExtendedRequest = true;
    });

    it('should inject simulator banner', function(done) {
      request(server)
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
      request(server)
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

    // it('should include req.clientConfig in __config__ global var', function(done) {
    //   this.extendedRequest.clientConfig = {
    //     setting1: 1,
    //     setting2: "5"
    //   };

    //   request(server)
    //     .get('/')
    //     .set('Host', hostname)
    //     .set('Cookie', '_dev=' + encodeURIComponent('j:{"user":"123"}'))
    //     .expect(200)
    //     .expect(function(res) {
    //       debugger;
    //       var clientConfig = extractConfigVar(res.text);
    //       assert.equal(clientConfig.setting1, 1);
    //       assert.equal(clientConfig.setting2, "5");
    //     })
    //     .end(done);
    // });
  });
});