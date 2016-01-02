var basicAuth = require('../lib/plugins/basic-auth');
var sinon = require('sinon');
var express = require('express');
var shortid = require('shortid');
var async = require('async');
// var _ = require('lodash');
var supertest = require('supertest');
var assert = require('assert');
var streamTestUtils = require('./stream-test-utils');
var testUtil = require('./test-util');

require('dash-assert');

describe('basicAuth()', function() {
  var server;
  var self;

  beforeEach(function() {
    self = this;
    server = express();

    self.failedLogins = 0;
    server.settings.cache = {
      incr: sinon.spy(function(key, callback) {
        self.failedLogins++;
        callback(null, self.failedLogins);
      }),
      expire: sinon.spy(function() {}),
      get: sinon.spy(function(key, callback) {
        callback(null, 0);
      }),
      del: sinon.spy(function() {})
    };

    this.options = {
      realm: 'realm',
      username: 'username',
      password: 'password',
      maxFailedLogins: 3
    };

    self.appId = shortid.generate();
    self.versionId = shortid.generate();

    server.use(function(req, res, next) {
      req.ext = {
        virtualApp: {appId: self.appId},
        virtualAppVersion: {versionId: self.versionId}
      };
      next();
    });

    server.use(function(req, res, next) {
      basicAuth(self.options)(req, res, next);
    });

    server.get('/', function(req, res) {
      res.send('OK');
    });

    server.use(testUtil.errorHandler);
  });

  it('authenticates', function(done) {
    supertest(server)
      .get('/')
      .set('Authorization', authHeader(this.options.username, this.options.password))
      .expect(200)
      .expect(function(res) {
        assert.equal(res.text, 'OK');
      })
      .end(done);
  });

  it('fails for wrong password', function(done) {
    supertest(server)
      .get('/')
      .set('Authorization', authHeader(this.options.username, 'wrong'))
      .expect(401)
      .expect(function(res) {
        assert.equal(res.text, 'Access denied');
        assert.equal(res.headers['www-authenticate'], 'Basic realm="' + self.options.realm + '"');
      })
      .end(done);
  });

  it('after max failures returns error', function(done) {
    async.times(4, function(n, next) {
      supertest(server)
        .get('/')
        .set('Authorization', authHeader(self.options.username, 'wrong'))
        .expect(function(res) {
          assert.equal(server.settings.cache.incr.callCount, 4);
          if (n === 3) {
            assert.equal(403, res.status);
            assert.equal(res.body.code, 'tooManyFailedLoginAttempts');
          } else {
            assert.equal(401, res.status);
            assert.equal(res.headers['www-authenticate'], 'Basic realm="' + self.options.realm + '"');
          }
        })
        .end(next);
    }, function(err) {
      if (err) return done(err);

      assert.equal(server.settings.cache.incr.callCount, 4);
      assert.equal(server.settings.cache.expire.callCount, 1);
      done();
    });
  });

  describe('custom login form', function() {
    beforeEach(function() {
      this.options.loginPage = 'login.html';
      var loginPageContent = '<html><head></head>login page</html>';

      server.settings.storage = {
        readFileStream: sinon.spy(function() {
          return streamTestUtils.buffer(loginPageContent);
        })
      };
    });

    it('works with correct creds', function(done) {
      async.series([
        // First make a request with no credentials
        function(cb) {
          supertest(server).get('/')
            .expect(401)
            .expect('Content-Type', /text\/html/)
            .expect(/login page/)
            .expect(/XMLHttpRequest/)
            .expect(function(res) {
              assert.isTrue(server.settings.storage.readFileStream.calledWith(
                self.appId + '/' + self.versionId + '/login.html'));
              assert.isEmpty(res.headers.etag);
            })
            .end(cb);
        },
        // Now submit the XHR request with invalid credentials
        function(cb) {
          supertest(server).get('/')
            .set('Authorization', authHeader(self.options.username, 'wrong'))
            .set('X-Requested-With', 'XMLHttpRequest')
            .expect(401)
            .expect('Access denied')
            .end(cb);
        },
        // Now pass the correct credentials
        function(cb) {
          supertest(server).get('/')
            .set('Authorization', authHeader(self.options.username, self.options.password))
            .set('X-Requested-With', 'XMLHttpRequest')
            .expect(200)
            .expect('OK')
            .end(cb);
        }
      ], done);
    });

    it('uses browser prompt if login page missing', function(done) {
      server.settings.storage.readFileStream = function() {
        return streamTestUtils.emitter('missing');
      };

      supertest(server).get('/')
        .expect(401)
        .expect('www-authenticate', /^Basic/)
        .expect('Access denied')
        .end(done);
    });
  });
});

function authHeader(username, password) {
  return 'Basic ' + new Buffer(username + ':' + password).toString('base64');
}
