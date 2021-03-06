var logout = require('../lib/plugins/logout');
var express = require('express');
var session = require('express-session');
var supertest = require('supertest');
var assert = require('assert');

describe('logout()', function() {
  var server;

  beforeEach(function() {
    server = express();

    server.use(session({
      name: 'session',
      secret: '23423425',
      resave: false,
      saveUninitialized: false
    }));

    server.get('/logout', logout({
      sessionCookieName: 'session',
      redirectUrl: '/?loggedout=true'
    }));
  });

  describe('logout()', function() {
    it('should redirect to index page', function(done) {
      supertest(server)
        .get('/logout')
        .set('Cookie', '4front.sessionid=abcd')
        .expect(302)
        .expect('Location', '/?loggedout=true')
        .expect(function(res) {
          assert.ok(/^4front.sessionid=;/.test(res.headers['set-cookie'][0]));
        })
        .end(done);
    });
  });
});
