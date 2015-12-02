var clientSettings = require('../lib/plugins/client-settings');
var express = require('express');
var supertest = require('supertest');
var assert = require('assert');

describe('logout()', function() {
  var server;
  var clientConfigOptions;

  beforeEach(function() {
    server = express();

    server.use(function(req, res, next) {
      req.ext = {clientConfig: {}};
      next();
    });

    server.use(function(req, res, next) {
      clientSettings(clientConfigOptions)(req, res, next);
    });

    server.get('/', function(req, res, next) {
      res.json(req.ext.clientConfig);
    });
  });

  it('should redirect to index page', function(done) {
    clientConfigOptions = {
      option1: 'foo',
      option2: { name: 'joe'}
    };

    supertest(server)
      .get('/')
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(res.body.settings, clientConfigOptions);
      })
      .end(done);
  });
});
