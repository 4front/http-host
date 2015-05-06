
var assert = require('assert');
var memoryCache = require('memory-cache-stream');
var devSandboxPage = require('../lib/middleware/dev-sandbox-page');
var querystring = require('querystring');
var loremIpsum = require('lorem-ipsum');
var express = require('express');
var supertest = require('supertest');
var _ = require('lodash');
var async = require('async');
var shortid = require('shortid');
var crypto = require('crypto');
var cookieParser = require('cookie-parser');
var parseUrl = require('url').parse;
var formatUrl = require('url').format;
var querystring = require('querystring');
var debug = require('debug')('4front-apphost:dev-sandbox-page');

require('simple-errors');

describe('devSandbox()', function(){
  var hostname = 'appname.platformhost.com';
  var self;

  beforeEach(function(){
    self = this;

    this.user = {
      userId: shortid.generate()
    };

    this.virtualApp = {
      name: 'test-app',
      appId: shortid.generate(),
      url: 'https://myapp.apphost.com'
    };

    this.extendedRequest = {
      clientConfig: {},
      virtualEnv: 'dev',
      htmlPagePath: 'index.html',
      user: this.user,
      virtualApp: this.virtualApp
    };

    this.server = express();

    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      next();
    });

    this.server.use(cookieParser());
    this.server.settings.cache = this.cache = memoryCache();

    this.server.use(devSandboxPage({
      port: 3000
    }));

    this.server.use(function(req, res, next) {
      // Pipe the page to the response
      req.ext.htmlPageStream.pipe(res);
    });

    this.server.use(function(err, req, res, next) {
      res.statusCode = err.status || 500;
      if (res.statusCode === 500)
        console.log(err.stack);

      res.end(err.message);
    });
  });

  it('loads page', function(done) {
    var html = "<html>somepage</html>";
    this.extendedRequest.htmlPagePath = 'somepage.html';

    async.series([
      function(cb) {
        // Make the original request for the page
        supertest(self.server)
          .get('/somepage')
          .expect(302)
          .expect('set-cookie', /_sandboxPage\=1/)
          .expect(function(res) {
            var redirectUrl = parseUrl(res.headers.location);

            var redirectQuery = querystring.parse(redirectUrl.query);
            var returnUrl = parseUrl(redirectQuery.return);
            assert.equal(returnUrl.pathname, '/somepage');

            redirectUrl.search = null;
            assert.equal(formatUrl(redirectUrl), 'http://localhost:3000/sandbox/somepage.html');
          })
          .end(cb);
      },
      function(cb) {
        // Have the localhost update the server with the contents of the file.
        var cacheKey = self.user.userId + '/' + self.virtualApp.appId + '/' + self.extendedRequest.htmlPagePath;
        self.cache.set(cacheKey, html);
        self.cache.set(cacheKey + '/mtime', new Date().getTime().toString());
        cb();
      },
      function(cb) {
        supertest(self.server)
          .get('/')
          .set('Cookie', '_sandboxPage=1')
          .expect(200)
          .expect(function(res) {
            assert.equal(res.text, html);
          })
          .end(cb);
      }
    ], done);
  });

  it('does not update page if lastModified is the same', function(done) {
    var html = loremIpsum();

    this.extendedRequest.htmlPagePath = '/blog/page-one.html';
    var cacheKey = self.user.userId + '/' + self.virtualApp.appId + '/blog/page-one.html';

    // Prime the cache with the page contents and hash
    this.cache.set(cacheKey, html);

    var lastModified = new Date().getTime().toString();

    this.cache.set(cacheKey + '/mtime', lastModified);

    async.series([
      function(cb) {
        supertest(self.server)
          .get('/blog/page-one?test=1')
          .expect(302)
          .expect('set-cookie', /_sandboxPage\=1/)
          .expect(function(res) {
            var redirectUrl = parseUrl(res.headers.location);
            var redirectQuerystring = querystring.parse(redirectUrl.query);
            redirectUrl.search = null;

            assert.equal(formatUrl(redirectUrl), 'http://localhost:3000/sandbox/blog/page-one.html');
            assert.equal(parseUrl(redirectQuerystring.return).path, '/blog/page-one?test=1');
            assert.equal(redirectQuerystring.mtime, lastModified);
          })
          .end(cb);
      },
      function(cb) {
        supertest(self.server)
          .get('/')
          .set('Cookie', '_sandboxPage=1')
          .expect(200)
          .expect(function(res) {
            assert.equal(res.text, html);
          })
          .end(cb);
      }
    ], done);
  });

  // function getHash(str) {
  //   var shasum = crypto.createHash('sha1');
  //   shasum.update(str);
  //   return shasum.digest('hex');
  // }
});
