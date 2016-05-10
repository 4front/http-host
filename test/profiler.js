var assert = require('assert');
var supertest = require('supertest');
var express = require('express');
var sinon = require('sinon');

require('dash-assert');

describe('profiler', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.app = express();
    this.settings = {
      logger: {
        info: sinon.spy(function() {})
      }
    };

    this.app.use(function(req, res, next) {
      req.ext = {};
      next();
    });

    this.app.use(require('../lib/middleware/profiler')(this.settings));

    // Some fake middleware that registers with profiler
    this.app.use(function(req, res, next) {
      req.ext.profiler.start('timeout-middleware');
      setTimeout(function() {
        req.ext.profiler.finish('timeout-middleware');
        next();
      }, 50);
    });

    this.app.get('/', function(req, res, next) {
      res.send('ok');
    });
  });

  it('profiles request', function(done) {
    supertest(this.app).get('/?__profile=1')
      .expect(function(res) {
        var profileLogArgs = self.settings.logger.info.getCall(0).args[1];
        assert.isObject(profileLogArgs.profiler);
        var profilerOutput = profileLogArgs.profiler;
        assert.equal(profilerOutput.key, '_root');
        assert.equal(profilerOutput.nested.length, 1);
        assert.equal(profilerOutput.nested[0].key, 'timeout-middleware');
      })
      .end(done);
  });
});
