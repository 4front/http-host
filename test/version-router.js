var assert = require('assert');
var router = require('../lib/version-router');

describe('versionRouter', function() {
  it('honors fixed version', function() {
    var rules = [
      {versionId: '1', rule: '*'},
      {versionId: '2', rule: 'random', args: 0.5},
    ];

    assert.equal(router(rules), '1');
  });

  it('throws exception for missing rule', function() {
    var rules = [
      {version: '1', rule: 'invalid'}
    ];

    assert.throws(function() {
      router(rules);
    });
  });
});
