var assert = require('assert');
var sinon = require('sinon');
var path = require('path');
var _ = require('lodash');
var debug = require('debug');

require('dash-assert');

describe('addonLoader()', function(){
  var self;

  beforeEach(function(){
    self = this;

    this.addonLoader = require('../lib/addon-loader')({
      builtInAddonsDir: path.join(__dirname, "./fixtures/addons")
    });
  });

  it('load built-in addon', function(done) {
    this.addonLoader("sendtext", {}, function(err, addon) {
      if (err) return done(err);

      assert.ok(_.isFunction(addon));
      done();
    });
  });

  it("returns error loading missing addon", function(done) {
    this.addonLoader("missing-addon", {}, function(err, addon) {
      assert.isDefined(err);
      assert.equal(err.code, "addonLoadError");

      done();
    });
  });

  it("loads installed addon", function(done) {
    var options = {
      resave: true,
      saveUninitialized: false,
      secret: 'secret'
    };

    this.addonLoader("express-session", options, function(err, addon) {
      if (err) return done(err);
      assert.ok(_.isFunction(addon));
      done();
    });
  });

  it('returns error for add-on that does not export a function', function(done) {
    this.addonLoader("invalid-export", {}, function(err, addon) {
      assert.isDefined(err);
      assert.equal(err.code, "addonInvalidExport");

      done();
    });
  });

  it('returns error for add-on that does not return a function with 3 args', function(done) {
    this.addonLoader("invalid-signature", {}, function(err, addon) {
      assert.isDefined(err);
      assert.equal(err.code, "addonFunctionSignature");

      done();
    });
  });

  it('returns error for add-on that does returns func with wrong arg names', function(done) {
    this.addonLoader("wrong-arg-names", {}, function(err, addon) {
      assert.isDefined(err);
      assert.equal(err.code, "addonFunctionSignature");

      done();
    });
  });

  it('returns error for add-on that throws error during creation', function(done) {
    this.addonLoader("throws-error", {}, function(err, addon) {
      assert.isDefined(err);
      assert.equal(err.code, "addonCreateError");

      done();
    });
  });
});
