var supertest = require('supertest');
var express = require('express');
var assert = require('assert');
var testUtil = require('./test-util');
var authorized = require('../lib/addons/authorized');

describe('authorized', function() {
  var self, user;

  beforeEach(function() {
    self = this;

    this.server = express();

    this.options = {};
    this.server.use(function(req, res, next) {
      debugger;
      req.ext = {
        user: user
      };

      next();
    });

    this.server.use(authorized(this.options));

    this.server.use(function(req, res, next) {
      res.json(req.ext);
    });

    this.server.use(testUtil.errorHandler);
  });

  describe('missing user', function(done) {
    beforeEach(function() {
      user = null;
    });

    it('loginUrl causes user to be redirected', function(done) {
      this.options.loginUrl = '/login';

      supertest(this.server)
        .get('/protected')
        .expect(302)
        .expect('location', '/login')
        .expect('set-cookie', "returnUrl=" + encodeURIComponent('/protected') + "; Path=/; HttpOnly")
        .end(done);
    });

    it('loginPage option on root path causes webPage to be set', function(done) {
      this.options.loginPage = 'login.html';

      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.webPagePath, self.options.loginPage);
        })
        .end(done);
    });

    it('loginPage option on non-root path causes redirect to root', function(done) {
      this.options.loginPage = 'login.html';

      supertest(this.server)
        .get('/protected')
        .expect(302)
        .expect('location', '/')
        .expect('set-cookie', "returnUrl=" + encodeURIComponent('/protected') + "; Path=/; HttpOnly")
        .end(done);
    });

    it('returns 401 if no loginUrl or loginPage', function(done) {
      supertest(this.server)
        .get('/protected')
        .expect(401)
        .expect('error-code', "cannotAuthorizeMissingUser")
        .end(done);
    });
  });

  describe('group based authorization', function() {
    beforeEach(function() {
      this.options.allowed.groups = ["sysadmins"];

      user = {
        userId: 'abc',
        username: 'test'
      };
    });

    it('returns 403 if user does not have groups', function(done) {
      supertest(this.server)
        .get('/protected')
        .expect(403)
        .expect('error-code', "authFailedNotMemberOfAllowedGroup")
        .end(done);
    });

    it('returns 403 if user has groups but not the right ones', function(done) {
      user.groups = ["developers"];

      supertest(this.server)
        .get('/protected')
        .expect(403)
        .expect('error-code', "authFailedNotMemberOfAllowedGroup")
        .end(done);
    });

    it('user authorized if they belong to allowed group', function(done) {
      user.groups = ["developers", "sysadmins"];

      supertest(this.server)
        .get('/protected')
        .expect(200)
        .end(done);
    });
  });

  describe('role based authorization', function() {
    beforeEach(function() {
      this.options.allowed.roles = ["admin"];

      user = {
        userId: 'abc',
        username: 'test'
      };
    });

    it('returns 403 if user does not have roles', function(done) {
      supertest(this.server)
        .get('/protected')
        .expect(403)
        .expect('error-code', "authFailedDoesNotHaveRequiredRole")
        .end(done);
    });

    it('returns 403 if user has roles but not the right ones', function(done) {
      user.roles = ["reader"];

      supertest(this.server)
        .get('/protected')
        .expect(403)
        .expect('error-code', "authFailedDoesNotHaveRequiredRole")
        .end(done);
    });

    it('user authorized if they have allowed role', function(done) {
      user.roles = ["admin"];

      supertest(this.server)
        .get('/protected')
        .expect(200)
        .end(done);
    });
  });
});
