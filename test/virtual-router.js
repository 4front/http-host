/* eslint no-console: 0 */

var express = require('express');
var supertest = require('supertest');
var _ = require('lodash');
var async = require('async');
var virtualRouter = require('../lib/middleware/virtual-router');
var assert = require('assert');
var testUtil = require('./test-util');

require('dash-assert');

// TODO: Need to support 4 arrity middleware
describe('virtualRouter', function() {
  var virtualRouterOptions;
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();

    this.virtualApp = {
      name: 'test-app'
    };

    this.env = {};
    this.virtualEnv = 'production';
    this.manifest = {};

    this.server.use(function(req, res, next) {
      req.ext = {
        virtualApp: self.virtualApp,
        virtualAppVersion: {
          manifest: self.manifest
        },
        virtualEnv: self.virtualEnv,
        env: self.env,
        plugins: []
      };
      next();
    });

    virtualRouterOptions = _.extend({autoIncludeWebpagePlugin: false},
      require('./fixtures/plugin-loader-settings'));

    this.server.use(function(req, res, next) {
      virtualRouter(virtualRouterOptions)(req, res, next);
    });

    this.server.use(function(req, res, next) {
      res.json(req.ext);
    });

    this.server.use(testUtil.errorHandler);
  });

  it('invokes two plugins', function(done) {
    this.manifest.router = [
      {
        module: 'passthrough',
        options: {
          value: 1
        }
      },
      {
        module: 'passthrough',
        path: '/',
        method: 'get',
        options: {
          value: 2
        }
      },
      {
        module: 'echo'
      }
    ];

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(res.body.ext.plugins, [1, 2]);
      })
      .end(done);
  });

  it('only plugins with matching route execute', function(done) {
    this.manifest.router = [
      {
        module: 'passthrough',
        options: {
          value: 1
        },
        path: '/foo',
        method: 'get'
      },
      {
        module: 'passthrough',
        options: {
          value: 2
        },
        path: '/bar'
      },
      {
        module: 'echo'
      }
    ];

    supertest(this.server)
      .get('/foo')
      .expect(200)
      .expect(function(res) {
        assert.ok(_.isEqual(res.body.ext.plugins, [1]));
      })
      .end(done);
  });

  it('missing middleware function returns 500 response', function(done) {
    this.manifest.router = [
      {
        module: 'invalid'
      }
    ];

    supertest(this.server)
      .get('/')
      .expect(500)
      .expect(function(res) {
        assert.equal(res.body.code, 'pluginRequireError');
      })
      .end(done);
  });

  it('returns 500 response for invalid method', function(done) {
    this.manifest.router = [
      {
        module: 'passthrough',
        path: '/',
        method: 'blah'
      }
    ];

    supertest(this.server)
      .get('/')
      .expect(500)
      .expect(function(res) {
        assert.equal(res.body.code, 'invalidVirtualRouteMethod');
      })
      .end(done);
  });

  it('plugin chain stops when next not invoked', function(done) {
    this.manifest.router = [
      {
        path: '/text',
        module: 'sendtext',
        options: {
          text: 'hello!'
        }
      },
      {
        module: 'next-error',
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

  it('passes error to error handler middleware', function(done) {
    var errorMessage = 'forced error';
    this.manifest.router = [
      {
        module: 'next-error',
        options: {
          error: errorMessage
        }
      },
      {
        module: 'err-handler',
        errorHandler: true
      }
    ];

    supertest(this.server)
      .get('/options')
      .expect(400)
      .expect('Error-Handler', 'err-handler')
      .expect(errorMessage)
      .end(done);
  });

  it('uses default router if no manifest', function(done) {
    virtualRouterOptions.autoIncludeWebpagePlugin = true;

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect('Content-Type', /text\/html/)
      .expect('<html><head></head></html>')
      .end(done);
  });

  it('auto includes webpage plugin', function(done) {
    this.manifest.router = [
      {
        module: 'passthrough',
        options: {
          value: 'foo'
        },
        path: '/'
      }
    ];

    virtualRouterOptions.autoIncludeWebpagePlugin = true;

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect('Content-Type', /text\/html/)
      .expect('<html><head></head></html>')
      .end(done);
  });

  it('returns 404 if no standard route', function(done) {
    virtualRouterOptions.autoIncludeWebpagePlugin = false;
    this.manifest.router = [
      {
        module: 'sendtext',
        path: '/hello'
      },
      {
        module: 'err-handler',
        errorHandler: true
      }
    ];

    supertest(this.server)
      .get('/')
      .expect(404)
      .expect('Error-Handler', 'err-handler')
      .end(done);
  });

  it('skips plugins based on the virtualEnv', function(done) {
    this.manifest.router = [
      {
        environments: ['production'],
        path: '/',
        module: 'sendtext',
        options: {
          text: 'production'
        }
      },
      {
        environments: ['test'],
        path: '/',
        module: 'sendtext',
        options: {
          text: 'test'
        }
      }
    ];

    async.series([
      function(cb) {
        supertest(self.server)
          .get('/')
          .expect(200)
          .expect('production')
          .end(cb);
      },
      function(cb) {
        self.virtualEnv = 'test';
        supertest(self.server)
          .get('/')
          .expect(200)
          .expect('test')
          .end(cb);
      }
    ], done);
  });

  it('top level options passed to plugins', function(done) {
    this.manifest = {
      clientConfigVar: 'customGlobal',
      router: [
        {
          module: 'echo'
        }
      ]
    };

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        assert.equal(res.body.options.clientConfigVar, 'customGlobal');
      })
      .end(done);
  });
});
