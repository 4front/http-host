var express = require('express');
var session = require('express-session');
var supertest = require('supertest');
var assert = require('assert');
var _ = require('lodash');
var mockery = require('mockery');
var util = require('./test-util');
var sinon = require('sinon');
var querystring = require('querystring');

require('dash-assert');

describe('logout()', function(){
  var server, self, parsedBody, parsedCookies, sessionState,
    sessionMock, middleware, options;

  before(function() {
    mockery.enable({
      warnOnUnregistered: false
    });

    sessionMock = sinon.spy(function(options) {
      return function(req, res, next) {
        req.session = sessionState;
        next();
      }
    });

    mockery.registerMock('express-session', sessionMock);
  });

  after(function() {
    mockery.disable();
  });

  beforeEach(function() {
    self = this;
    server = express();
    server.settings.sessionStore = {name: 'test'};

    sessionMock.reset();

    parsedBody = parsedCookies = sessionState = existingSessionState = null;

    server.use(function(req, res, next) {
      req.session = existingSessionState;
      req.body = parsedBody;
      req.cookies = parsedCookies;

      next();
    });

    middleware = [];

    options = {
      session: {
        secret: 'abc',
        cookie: {
          secure: true,
          maxAge: 60 * 60 * 1000
        },
        store: {name: 'test'}
      }
    };

    server.use(function(req, res, next) {
      require('../lib/middleware/ensure-req-middleware')(
        middleware, options)(req, res, next);
    });

    server.all('/', function(req, res, next) {
      res.json(_.pick(req, 'session', 'body', 'cookies'));
    });

    server.use(util.errorHandler);
  });

  it('should parse json body', function(done){
    middleware.push('body:json');
    var body = {name: 'bob'};

    supertest(server)
      .post('/')
      .send(body)
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(res.body.body, body);
      })
      .end(done);
  });

  it('should not parse body if already parsed', function(done) {
    parsedBody = {user: 'tim'};
    middleware.push('body:json');

    supertest(server)
      .post('/')
      .send({user: 'joe'})
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(res.body.body, parsedBody);
      })
      .end(done);
  });

  it('should create session state', function(done) {
    middleware.push('session');
    sessionState = { name: 'grover'};

    supertest(server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        assert.ok(sessionMock.called);

        debugger;
        assert.ok(sessionMock.calledWith(sinon.match({
          cookie: {
            secure: true,
            httpOnly: true,
            path: '/',
            maxAge: options.session.cookie.maxAge
          },
          store: server.settings.sessionStore
        })));

        assert.deepEqual(res.body.session, sessionState);
      })
      .end(done);
  });

  it('does not create session if it already exists', function(done) {
    middleware.push('session');
    existingSessionState = { name: 'grover'};

    supertest(server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        assert.isFalse(sessionMock.called);
        assert.deepEqual(res.body.session, existingSessionState);
      })
      .end(done);
  });

  it('parses cookies', function(done) {
    middleware.push('cookies');

    supertest(server)
      .get('/')
      .set('cookie', 'name=bob;color=blue;')
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(res.body.cookies, {
          name: 'bob',
          color: 'blue'
        });
      })
      .end(done);
  });

  it('does not parse cookies if they already exist', function(done) {
    middleware.push('cookies');
    parsedCookies = {
      name: 'bob'
    };

    supertest(server)
      .get('/')
      .set('cookie', 'name=joe;')
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(res.body.cookies, parsedCookies);
      })
      .end(done);
  });

  it('ensures multiple middleware', function(done) {
    middleware.push('cookies');
    middleware.push('session');
    middleware.push('body:urlencoded');

    var body = {name: 'paul'};
    var cookies = {name: 'joe'};
    sessionState = {name: 'sally'};

    supertest(server)
      .post('/')
      .set('cookie', 'name=joe;')
      .type('form')
      .send(body)
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(res.body.cookies, cookies);
        assert.deepEqual(res.body.body, body);
        assert.deepEqual(res.body.session, sessionState);
      })
      .end(done);
  });

  it('throws error for invalid middleware name', function(done) {
    middleware.push('invalid_middleware');

    supertest(server)
      .get('/')
      .expect(400)
      .expect('Error-Code', 'invalidMiddlewareName')
      .end(done);
  });
});
