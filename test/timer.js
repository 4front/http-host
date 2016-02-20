var supertest = require('supertest');
var express = require('express');

var timer = require('../lib/timer')({
  logger: console
});

describe('timer', function() {
  beforeEach(function() {
  });

  it('emits middleware timings', function(done) {
    var app = express();

    app.use(function(req, res, next) {
      req.ext = {};
      next();
    });

    app.use(timer.init);

    app.use(timer.instrument(function(req, res, next) {
      setTimeout(next, 50);
    }, 'firstmiddleware'));

    app.use(timer.instrument(function(req, res, next) {
      setTimeout(next, 100);
    }, 'secondmiddleware'));

    app.get('/', timer.instrument(function(req, res, next) {
      setTimeout(function() {
        res.send('done');
      }, 100);
    }, 'index route'));

    supertest(app).get('/')
      .expect(200)
      .end(done);
  });
});
