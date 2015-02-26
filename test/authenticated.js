var assert = require('assert');
var express = require('express');
var supertest = require('supertest');
var sinon = require('sinon');
var authenticated = require('../lib/middleware/authenticated');
var _ = require('lodash');

describe('authenticated()', function() {
  var server;

  beforeEach(function() {
    server = express();

    this.user = null;
    
    var self = this;
    this.user = {
      userId: '23524'
    };

    server.use(function(req, res, next) {
      req.ext = {};
      req.session = {
        user: self.user
      };

      next();
    });

    server.use(authenticated());

    server.use(function(req, res, next) {
      res.json(_.pick(req, 'ext', 'user', 'clientConfig'));
    });

    server.use(function(err, req, res, next) {
      if (err.status === 401)
        return res.status(401).send(err.message);
      else
        next();
    });
  });


  it('isAuthenticated false when no user in session', function(done) {
    this.user = null;

    supertest(server)
      .get('/')
      .expect(function(res) {
        debugger;
        assert.equal(res.body.ext.isAuthenticated, false);
        assert.ok(_.isUndefined(res.body.user));
      })
      .end(done);
  });

  it('isAuthenticated true when user in session', function(done) {
    supertest(server)
      .get('/')
      .expect(function(res) {
        assert(res.body.ext.isAuthenticated, true);
        assert.ok(res.body.user);
      })
      .end(done);
  });

  it('sets user to req.user', function(done) {
    var self = this;
    supertest(server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        assert.ok(_.isEqual(res.body.user, self.user));
      })
      .end(done);
  });
});
