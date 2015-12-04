/* eslint new-cap: 0 */

var assert = require('assert');
var sinon = require('sinon');
var memoryCache = require('memory-cache-stream');
var devSandbox = require('../lib/middleware/dev-sandbox');
var querystring = require('querystring');
var express = require('express');
var request = require('supertest');
var debug = require('debug');
var cookieParser = require('cookie-parser');
var shortid = require('shortid');
var jwt = require('jwt-simple');
var testUtil = require('./test-util');

require('dash-assert');
require('simple-errors');

describe('devSandbox()', function() {
  var hostname = 'appname--local.platformhost.com';
  var self;

  beforeEach(function() {
    self = this;

    this.userId = shortid.generate();
    this.virtualApp = {
      name: 'test-app',
      appId: '2awoifj48'
    };

    this.extendedRequest = {
      clientConfig: {},
      virtualEnv: 'local',
      webPagePath: 'index.html',
      developerId: this.userId,
      virtualApp: this.virtualApp
    };

    this.server = express();
    this.server.settings.jwtTokenSecret = 'token_secret';

    this.devOptions = {
      port: 3000,
      autoReload: '1',
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
    this.manifest = {
      router: []
    };

    this.server.settings.cache.set(
      this.userId + '/' + this.extendedRequest.virtualApp.appId + '/_manifest',
      JSON.stringify(this.manifest));

    this.server.use(devSandbox({
      showBanner: true,
      port: 3000,
      liveReload: true
    }));

    this.server.use(function(req, res, next) {
      res.json(req.ext);
    });

    this.server.use(testUtil.errorHandler);
  });

  describe('dev login', function() {
    it('successful login', function(done) {
      request(this.server)
        .get('/__login?' + querystring.stringify(this.devOptions))
        .set('Host', hostname)
        .expect(302)
        .expect('location', '/')
        .expect(function(res) {
          // Assert that the dev options are set in the cookie
          var setCookieHeader = res.headers['set-cookie'];
          assert.equal(2, setCookieHeader.length);

          // The first set-cookie should be clearing the _sandboxPage cookie
          assert.isTrue(/_sandboxPage=;/.test(setCookieHeader[0]));

          var setCookie = querystring.parse(setCookieHeader[1]);
          assert.deepEqual(cookieParser.JSONCookie(setCookie._dev.split(';')[0]), self.devOptions);
        })
        .end(done);
    });

    it('returns error when dev token missing', function(done) {
      this.devOptions.token = null;

      request(this.server)
        .get('/__login?' + querystring.stringify(this.devOptions))
        .set('Host', hostname)
        .expect(401)
        .expect('Error-Code', 'missingDevToken')
        .end(done);
    });

    it('returns error when token is invalid', function(done) {
      this.devOptions.token = 'invalid';

      request(this.server)
        .get('/__login?' + querystring.stringify(this.devOptions))
        .set('Host', hostname)
        .expect(401)
        .expect('Error-Code', 'invalidDevToken')
        .end(done);
    });
  });

  describe('authenticate', function() {
    it('jwt is expired returns 400', function(done) {
      this.devOptions.token = jwt.encode({
        iss: this.userId,
        exp: Date.now() - 10000
      }, this.server.settings.jwtTokenSecret);

      request(this.server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', createDevCookie(this.devOptions))
        .expect(401)
        .expect('Error-Code', 'expiredDevToken')
        .end(done);
    });

    it('jwt is expired returns 400', function(done) {
      this.devOptions.token = 'invalid_token';

      request(this.server)
        .get('/')
        .set('Host', hostname)
        .set('Cookie', createDevCookie(this.devOptions))
        .expect(401)
        .expect('Error-Code', 'invalidDevToken')
        .end(done);
    });
  });

  it('returns error for missing manifest', function(done) {
    this.server.settings.cache.del(this.userId + '/' + this.virtualApp.appId + '/_manifest');

    request(this.server)
      .get('/')
      .set('Host', hostname)
      .set('Cookie', createDevCookie(this.devOptions))
      .expect(400)
      .expect('Error-Code', 'invalidJsonManifest')
      .end(done);
  });

  it('sets req.ext properties', function(done) {
    request(this.server)
      .get('/')
      .set('Host', hostname)
      .set('Cookie', createDevCookie(this.devOptions))
      .expect(200)
      .expect(function(res) {
        assert.ok(sinon.match({
          virtualAppVersion: {
            versionId: 'sandbox',
            name: 'sandbox',
            manifest: self.manifest
          },
          versionAssetPath: '//localhost:' + self.devOptions.port,
          buildType: 'debug',
          cacheControl: 'no-cache'
        }, res.body));
      })
      .end(done);
  });

  function createDevCookie(devOptions) {
    return '_dev=' + encodeURIComponent('j:' + JSON.stringify(devOptions));
  }
});
