/* eslint no-console: 0 */

var express = require('express');
var supertest = require('supertest');
var _ = require('lodash');
var streamTestUtils = require('./stream-test-utils');
var virtualRouter = require('../lib/middleware/virtual-router');
var assert = require('assert');
var path = require('path');

// TODO: Need to support 4 arrity middleware
describe('virtualRouter', function() {
  var virtualRouterOptions;

  beforeEach(function() {
    var self = this;
    this.server = express();

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

    virtualRouterOptions = {
      builtInPluginsDir: [
        path.join(__dirname, './fixtures/plugins'),
        path.join(__dirname, '../lib/plugins')
      ],
      autoIncludeWebpagePlugin: false
    };

    this.server.use(function(req, res, next) {
      virtualRouter(virtualRouterOptions)(req, res, next);
    });

    this.server.use(function(req, res, next) {
      res.json(req.ext);
    });

    this.server.use(function(err, req, res, next) {
      res.statusCode = err.status || 500;
      if (res.statusCode >= 500 && res.statusCode !== 506) {
        console.log(err.stack || err.message || err.toString());
      }

      res.json(err);
    });
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

  it('missing middleware function returns 506 response', function(done) {
    this.manifest.router = [
      {
        module: 'invalid'
      }
    ];

    supertest(this.server)
      .get('/')
      .expect(506)
      .expect(function(res) {
        assert.equal(res.body.code, 'pluginLoadError');
      })
      .end(done);
  });

  it('returns 506 response for invalid method', function(done) {
    this.manifest.router = [
      {
        module: 'passthrough',
        path: '/',
        method: 'blah'
      }
    ];

    supertest(this.server)
      .get('/')
      .expect(506)
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
    var contents = '<html></html>';

    virtualRouterOptions.autoIncludeWebpagePlugin = true;

    this.server.settings.storage = {
      readFileStream: function() {
        return streamTestUtils.buffer(contents);
      }
    };

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect('Content-Type', /text\/html/)
      .expect(function(res) {
        assert.equal(contents, res.text);
      })
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

    var contents = '<html></html>';
    virtualRouterOptions.autoIncludeWebpagePlugin = true;

    this.server.settings.storage = {
      readFileStream: function() {
        return streamTestUtils.buffer(contents);
      }
    };

    supertest(this.server)
      .get('/')
      .expect(200)
      .expect('Content-Type', /text\/html/)
      .expect(function(res) {
        assert.equal(contents, res.text);
      })
      .end(done);
  });

  it('returns 404 if no standard route', function(done) {
    this.server.settings.deployer = {
      serve: function(appId, versionId, filePath, res, next) {
        next();
      }
    };

    this.server.settings.storage = {
      readFileStream: function() {
        return streamTestUtils.emitter('missing');
      }
    };

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
});
