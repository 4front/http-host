var assert = require('assert');
var supertest = require('supertest');
var express = require('express');
var sinon = require('sinon');

require('dash-assert');

describe('instrument', function() {
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

    this.instrument = require('../lib/instrument');
    this.app.use(this.instrument.init(this.settings));

    // Some fake middleware that registers with profiler
    this.app.use(this.instrument.middleware(function(req, res, next) {
      setTimeout(function() {
        next();
      }, 50);
    }, 'timeout-middleware'));

    this.app.get('/', this.instrument.middleware(function(req, res, next) {
      res.send('ok');
    }, 'index-handler'));
  });

  it('instruments request with timings', function(done) {
    supertest(this.app).get('/?__instrument=1')
      .expect(function(res) {
        var timings = self.settings.logger.info.getCall(0).args[1].timings;
        assert.isObject(timings);
        assert.equal(timings.key, '_root');
        assert.equal(timings.nested.length, 2);
        assert.equal(timings.nested[0].key, 'timeout-middleware');
        assert.equal(timings.nested[1].key, 'index-handler');
      })
      .end(done);
  });
});
