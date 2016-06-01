var assert = require('assert');
var supertest = require('supertest');
var express = require('express');
var overrideHeaders = require('../lib/middleware/override-headers');

require('dash-assert');

describe('override headers', function() {
  beforeEach(function() {
    this.app = express();

    this.app.use(overrideHeaders());
    this.app.use(function(req, res, next) {
      res.json({
        accept: req.acceptsEncodings(['gzip', 'deflate', 'base64', 'identity']),
        headers: req.headers,
        gzip: req.acceptsEncodings(['gzip']) === 'gzip',
        base64: req.acceptsEncodings(['base64']) === 'base64',
        encoding: req.get('accept-encoding')
      });
    });
  });

  it('uses the override value', function(done) {
    supertest(this.app).get('/')
      .set('Accept-Encoding', 'gzip')
      .set('X-Override-Accept-Encoding', 'base64')
      .expect(200)
      .expect(function(res) {
        assert.equal(res.body.headers['accept-encoding'], 'base64');
        assert.equal(res.body.accept, 'base64');
        assert.isFalse(res.body.gzip);
        assert.isTrue(res.body.base64);
        assert.equal(res.body.encoding, 'base64');
      })
      .end(done);
  });
});
