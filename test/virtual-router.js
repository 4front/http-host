var express = require('express');
var supertest = require('supertest');
var _ = require('lodash');
var virtualRouter = require('../lib/middleware/virtual-router');
var assert = require('assert');
var path = require('path');
var querystring = require('querystring');

// TODO: Need to support 4 arrity middleware
describe('virtualRouter', function() {
  before(function() {
    var self = this;
    this.server = express();

    this.server.settings.pluginsDir = path.join(__dirname, './fixtures/plugins');

    this.virtualApp = {
      name: 'test-app'
    };

    this.env = {};

    this.manifest = {};
    this.server.use(function(req, res, next) {
      req.ext = {
        virtualApp: self.virtualApp,
        virtualAppVersion: {
          manifest: self.manifest
        },
        env: self.env,
        plugins: []
      };
      next();
    });

    this.server.use(virtualRouter());

    this.server.use(function(req, res, next) {
      res.json(req.ext);
    });

    this.server.use(function(err, req, res, next) {
      res.statusCode = err.status || 500;
      if (res.statusCode === 500 || res.statusCode > 501)
        console.log(err.stack);

      res.send(err.message);
    });
  });

  it('invokes two plugins', function(done) {
    this.manifest.router = [
      {
        module: 'plugin:passthrough',
        options: {
          value: 1
        }
      },
      {
        module: 'plugin:passthrough',
        path: '/',
        method: 'get',
        options: {
          value: 2
        }
      }
    ];

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        assert.ok(_.isEqual(res.body.plugins, [1, 2]));
      })
      .end(done);
  });

  it('only plugins with matching route execute', function(done) {
    this.manifest.router = [
      {
        module: 'plugin:passthrough',
        options: {
          value: 1
        },
        path: '/foo',
        method: 'get'
      },
      {
        module: 'plugin:passthrough',
        options: {
          value: 2
        },
        path: '/bar'
      }
    ];

    supertest(this.server)
      .get('/foo')
      .expect(200)
      .expect(function(res) {
        assert.ok(_.isEqual(res.body.plugins, [1]));
      })
      .end(done);
  });

  it('missing middleware function returns 501 response', function(done) {
    this.manifest.router = [
      {
        module: 'plugins:invalid'
      }
    ];

    supertest(this.server)
      .get('/')
      .expect(501)
      .expect(/Could not load the route module plugins:invalid/)
      .end(done);
  });

  it('returns 501 response for invalid method', function(done) {
    this.manifest.router = [
      {
        module: 'plugin:passthrough',
        path: '/',
        method: 'blah'
      }
    ];

    supertest(this.server)
      .get('/')
      .expect(501)
      .expect(/Invalid method blah for virtual route plugin:passthrough/)
      .end(done);
  });

  it('plugin chain stops when next not invoked', function(done) {
    this.manifest.router = [
      {
        path: '/text',
        module: 'plugin:sendtext',
        options: {
          text: 'hello!'
        }
      },
      {
        module: 'plugin:error',
        path: '/',
        options: {
          message: 'error message'
        }
      }
    ];

    supertest(this.server)
      .get('/text')
      .expect(200)
      .expect('Content-Type', /^text\/plain/)
      .expect('hello!')
      .end(done);
  });

  describe('environment variable substitution', function() {
    beforeEach(function() {
      this.env.KEY1 = "key1_value";
      this.env.KEY2 = "key2_value";
    });

    it('substitutes values correctly', function(done) {
      this.manifest.router = [
        {
          module: 'plugin:echo-options',
          options: {
            option1: "${KEY1}",
            another: 'foo',
            more: {
              option2: "${KEY2}"
            }
          },
          path: '/options'
        }
      ];

      supertest(this.server)
        .get('/options')
        .expect(200)
        .expect(function(res) {
          assert.deepEqual(res.body, {
            option1: "key1_value",
            another: 'foo',
            more: {
              option2: "key2_value"
            }
          });
        })
        .end(done);
    });

    it('throws error for missing environment variable', function(done) {
      this.manifest.router = [
        {
          module: 'plugin:echo-options',
          options: {
            option1: "${MISSING}",
          },
          path: '/options'
        }
      ];

      supertest(this.server)
        .get('/options')
        .expect(400)
        .expect(/Invalid environment variable MISSING/)
        .end(done);
    });
  });
});
