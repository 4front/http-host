var logout = require('../lib/middleware/logout');
var express = require('express');
var session = require('express-session');
var supertest = require('supertest');
var assert = require('assert');

describe('logout()', function(){
  var server;

  beforeEach(function(){
    var self = this;

    server = express();

    server.use(session({
      name: 'session', 
      secret: '23423425',
      resave: false,
      saveUninitialized: false
    }));

    server.get('/_p/logout', logout({
      sessionCookieName: 'session'
    }));
  });

  describe('logout()', function(){
    it('should redirect to index page', function(done){
      supertest(server)
        .get('/_p/logout')
        .set('Cookie', 'session=abcd')
        .expect(302)
        .expect(function(res) {
          assert.ok(/^session=;/.test(res.headers['set-cookie'][0]));
        })
        .expect(/\?_logout=1/, done);
    });
  });
});