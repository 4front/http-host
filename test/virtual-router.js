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

    this.server.use(function(req, res, next) {
      req.ext = {
        virtualApp: self.virtualApp,
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
    this.virtualApp.router = [
      {
        module: 'plugin::passthrough',
        options: {
          value: 1
        }
      },
      {
        module: 'plugin::passthrough',
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
    this.virtualApp.router = [
      {
        module: 'plugin::passthrough',
        options: {
          value: 1
        },
        path: '/foo',
        method: 'get'
      },
      {
        module: 'plugin::passthrough',
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
    this.virtualApp.router = [
      {
        module: 'plugins::invalid'
      }
    ];

    supertest(this.server)
      .get('/')
      .expect(501)
      .expect(/Could not load the route module plugins::invalid/)
      .end(done);
  });

  it('returns 501 response for invalid method', function(done) {
    this.virtualApp.router = [
      {
        module: 'plugin::passthrough',
        path: '/',
        method: 'blah'
      }
    ];

    supertest(this.server)
      .get('/')
      .expect(501)
      .expect(/Invalid method blah for virtual route plugin::passthrough/)
      .end(done);
  });

  it('plugin chain stops when next not invoked', function(done) {
    this.virtualApp.router = [
      {
        path: '/text',
        module: 'plugin::sendtext',
        options: {
          text: 'hello!'
        }
      },
      {
        module: 'plugin::error',
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
});
