
var assert = require('assert');
var trafficControl = require('../lib/middleware/traffic-control');
var querystring = require('querystring');
var express = require('express');
var request = require('supertest');
var _ = require('lodash');
var debug = require('debug');

describe('trafficControl()', function(){
  var server;

  beforeEach(function(){
    var self = this;

    server = express();
    self.trafficControlRules = [];

    server.use(function(req, res, next) {
      req.ext = {
        trafficControlRules: self.trafficControlRules
      };
      next();
    });

    server.use(require('cookie-parser')());

    this.trafficControlOptions = {
      versionRepository: {
        mostRecentVersionInfo: function(virtualEnv, callback) {
          callback(null, {versionId:'latest'});
        },
        getVersionInfo: function(versionId, callback) {
          callback(null, {versionId: versionId, name: versionId});
        }
      }
    };

    server.use(trafficControl(self.trafficControlOptions));

    server.use(function(req, res, next) {
      res.json(_.pick(req.ext, 'virtualAppVersion'));
    });

    server.use(function(err, req, res, next) {
      if (!err.status) err.status = 500;
      res.status(err.status);
      if (err.status === 500)
        console.log(err.stack);
      
      res.end(err.stack);
    });
  });

  describe('passing _version querystring', function(){
    it('should set cookie and redirect', function(done){
      request(server)
        .get('/?_version=abc')
        .set('Host', 'testapp.platform.com')
        .expect(302)
        .expect(function(res) {
          var setCookieHeader = res.headers['set-cookie'];

          assert.equal(res.headers['set-cookie'][0], '_version=abc; Path=/; HttpOnly');
          assert.ok(/testapp.platform.com/.test(res.text));
        })
        .end(done);
    });
  });

  describe('when _version cookie', function() {
    it('should use that version', function(done) {
      request(server)
        .get('/')
        .set('Cookie', '_version=1.1.1')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualAppVersion.versionId, '1.1.1');
        })
        .end(done);
    });
  });

  describe('when traffic control rules', function() {
    it('sends request to single version', function(done) {
      this.trafficControlRules.push({traffic: 1, versionId:'1'});

      request(server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualAppVersion.versionId, '1');
        })
        .end(done);
    });

    it('returns error if traffic control version is not valid', function(done) {
      this.trafficControlOptions.versionRepository.getVersionInfo = function(versionId, callback) {
        callback(null, null);
      };

      this.trafficControlRules.push({traffic: 1, versionId:'1'});

      request(server)
        .get('/')
        .expect(404)
        .expect(/Version 1 from trafficControlRules is not valid/)
        .end(done);
    });
  });

  describe('version in cookie does not exist', function() {
    it('falls back to traffic control rules', function(done) {
      this.trafficControlRules.push({versionId: '1', traffic: 1});

      this.trafficControlOptions.versionRepository.getVersionInfo = function(versionId, callback) {
        if (versionId == '2')
          callback(null, null);
        else
          callback(null, {versionId: versionId});
      };
      
      request(server)
        .get('/')
        .set('Cookie', '_version=2')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualAppVersion.versionId, '1');
        })
        .end(done);
    });

    it('reverts to most recent version', function(done) {
      this.trafficControlOptions.versionRepository.getVersionInfo = function(versionId, callback) {
        callback(null, null);
      };
      
      request(server)
        .get('/')
        .set('Cookie', '_version=1.1.1')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body.virtualAppVersion.versionId, 'latest');
        })
        .end(done);
    });
  });
});