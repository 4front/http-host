var basicAuth = require('../lib/plugins/basic-auth');
var express = require('express');
// var _ = require('lodash');
var supertest = require('supertest');
var assert = require('assert');

describe('basicAuth()', function() {
  var server, self;

  beforeEach(function() {
    self = this;
    server = express();

    this.options = {
      realm: 'realm',
      username: 'username',
      password: 'password'
    };

    server.use(function(req, res, next) {
      basicAuth(self.options)(req, res, next);
    });

    server.get('/', function(req, res) {
      res.send('OK');
    });
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
});

function authHeader(username, password) {
  return 'Basic ' + new Buffer(username + ':' + password).toString('base64');
}
