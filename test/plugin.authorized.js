var supertest = require('supertest');
var express = require('express');
var assert = require('assert');
var sinon = require('sinon');
var _ = require('lodash');
var testUtil = require('./test-util');
var authorized = require('../lib/plugins/authorized');

require('dash-assert');

describe('authorized', function() {
  var self, user, authorizedOptions;

  beforeEach(function() {
    self = this;

    this.server = express();

    user = {};

    this.sessionStub = {
      user: user,
      destroy: sinon.spy(function() {})
    };

    this.extendedRequest = {};
    this.server.use(function(req, res, next) {
      req.ext = self.extendedRequest;
      req.session = self.sessionStub;

      next();
    });

    authorizedOptions = {
      routes: [
        {
          path: "/protected/admin/*",
          allowed: {
            roles: ["admin"]
          }
        },
        {
          path: "/protected/*",
          allowed: {
            groups: ["Full-Time Employees"]
          }
        }
      ]
    };

    this.server.use(function(req, res, next) {
      authorized(authorizedOptions)(req, res, next);
    });

    this.server.use(function(req, res, next) {
      req.ext.authorized = true;
      res.json(req.ext);
    });

    this.server.use(testUtil.errorHandler);
  });

  it('should redirect non logged-in user to loginUrl', function(done) {
    this.sessionStub.user = null;
    authorizedOptions.loginUrl = '/login';

    supertest(this.server)
      .get('/protected/secret')
      .expect(302)
      .expect('location', '/login')
      .expect('set-cookie', "returnUrl=" + encodeURIComponent('/protected/secret') + "; Path=/; HttpOnly")
      .end(done);
  });

  describe("single page app", function() {
    beforeEach(function() {
      this.sessionStub.user = null;
      authorizedOptions.loginPage = 'login.html';

      // Require auth on the app root
      authorizedOptions.routes.push({
        path: "/",
      });
    });

    it('loginPage option on root path causes webPage to be set', function(done) {
      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.webPagePath, authorizedOptions.loginPage);
        })
        .end(done);
    });

    it('loginPage option on non-root path causes redirect to root', function(done) {
      supertest(this.server)
        .get('/protected/foo')
        .expect(302)
        .expect('location', '/')
        .expect('set-cookie', "returnUrl=" + encodeURIComponent('/protected/foo') + "; Path=/; HttpOnly")
        .end(done);
    });
  });

  it('returns 401 if no loginUrl or loginPage', function(done) {
    this.sessionStub.user = null;

    supertest(this.server)
      .get('/protected/foo')
      .expect(401)
      .expect('error-code', "noLoggedInUser")
      .end(done);
  });

  it('null user allowed to access route that has no authorization rule', function(done) {
    this.sessionStub.user = null;

    supertest(this.server)
      .get('/public')
      .expect(200, done);
  });

  it('user appended to request even for routes without authorization rule', function(done) {
    supertest(this.server)
      .get('/public')
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(res.body.user, _.omit(user, 'roles', 'groups'));
      })
      .end(done);
  });

  it('allows user for request not covered by authorized path', function(done) {
    user = null;

    supertest(this.server)
      .get('/public')
      .expect(200, done);
  });

  describe('group based authorization', function() {
    it('returns 403 if user does not have groups', function(done) {
      supertest(this.server)
        .get('/protected/wherever')
        .expect(403)
        .expect('error-code', "authFailedNotMemberOfAllowedGroup")
        .expect(function(res) {
          assert.isTrue(self.sessionStub.destroy.called);
        })
        .end(done);
    });

    it('does not destroy session when virtualEnv is dev', function(done) {
      self.extendedRequest.virtualEnv = 'dev';

      supertest(this.server)
        .get('/protected/wherever')
        .expect(403)
        .expect(function(res) {
          assert.isFalse(self.sessionStub.destroy.called);
        })
        .end(done);
    });

    it('returns 403 if user has groups but not the right ones', function(done) {
      user.groups = ["Testers"];

      supertest(this.server)
        .get('/protected/')
        .expect(403)
        .expect('error-code', "authFailedNotMemberOfAllowedGroup")
        .end(done);
    });

    it('user authorized if they belong to allowed group', function(done) {
      user.groups = ["Full-Time Employees"];

      supertest(this.server)
        .get('/protected/')
        .expect(200)
        .expect(function(res) {
          assert.deepEqual(res.body.user, user);
        })
        .end(done);
    });
  });

  describe('role based authorization', function() {
    it('returns 403 if user does not have roles', function(done) {
      supertest(this.server)
        .get('/protected/admin/users')
        .expect(403)
        .expect('error-code', "authFailedDoesNotHaveRequiredRole")
        .end(done);
    });

    it('returns 403 if user has roles but not the right ones', function(done) {
      user.roles = ["reader"];

      supertest(this.server)
        .get('/protected/admin/users')
        .expect(403)
        .expect('error-code', "authFailedDoesNotHaveRequiredRole")
        .end(done);
    });

    it('user authorized if they have allowed role', function(done) {
      user.roles = ["admin"];

      supertest(this.server)
        .get('/protected/admin/users')
        .expect(200)
        .end(done);
    });
  });
});
