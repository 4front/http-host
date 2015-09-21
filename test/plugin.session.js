var logout = require('../lib/plugins/logout');
var express = require('express');
var session = require('../lib/plugins/session');
var supertest = require('supertest');
var assert = require('assert');
var _ = require('lodash');
var MemoryStore = require('express-session').MemoryStore;

require('dash-assert');

describe('session()', function() {
  var server, sessionOptions, user;

  beforeEach(function() {
    var self = this;

    server = express();
    server.enable('trust proxy');
    server.settings.sessionSecret = '123';
    server.settings.sessionStore = new MemoryStore();

    user = {userId: 5};
    sessionOptions = {};
    server.use(function(req, res, next) {
      req.ext = {
        virtualApp: {
          requireSsl: true
        }
      };

      session(sessionOptions)(req, res, next);
    });

    server.use(function(req, res, next) {
      req.session.user = user;
      next();
    });

    server.get('/', function(req, res, next) {
      res.json(_.pick(req, 'session', 'sessionID'));
    });
  });

  it('set session cookie with expires', function(done) {
    sessionOptions.timeoutMinutes = 60;

    supertest(server)
      .get('/')
      .set('x-forwarded-proto', 'https')
      .expect(200)
      .expect(function(res) {
        var setCookie = res.headers['set-cookie'][0];
        assert.ok(/^4front\.sessionid=[a-z0-9%\.]+/.test(setCookie));
        assert.ok(/Expires=.* GMT;/.test(setCookie))

        assert.isString(res.body.sessionID);
        assert.deepEqual(res.body.session.user, user);

        assert.isMatch(res.body.session.cookie, {
          path: '/',
          httpOnly: true,
          secure: true,
          originalMaxAge: 60 * 60000
        });
      })
      .end(done);
  });

  it('set session cookie without expires', function(done) {
    supertest(server)
      .get('/')
      .set('x-forwarded-proto', 'https')
      .expect(200)
      .expect(function(res) {
        var setCookie = res.headers['set-cookie'][0];
        assert.isTrue(/^4front\.sessionid=[a-z0-9%\.]+/.test(setCookie));
        assert.isFalse(/Expires=/i.test(setCookie));
        assert.isTrue(res.body.session.cookie.secure);
        assert.isTrue(res.body.session.cookie.httpOnly);
      })
      .end(done);
  });
});
