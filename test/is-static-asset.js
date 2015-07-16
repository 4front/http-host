var assert = require('assert');
var isStaticAsset = require('../lib/is-static-asset');
require('dash-assert');

describe('isStaticAsset', function() {
  it('anyExceptHtml', function() {
    assert.isTrue(isStaticAsset.anyExceptHtml({path: '/js/main.js'}));
    assert.isTrue(isStaticAsset.anyExceptHtml({path: '/img/logo.png'}));
    assert.isTrue(isStaticAsset.anyExceptHtml({path: '/img/logo.jpg'}));
    assert.isFalse(isStaticAsset.anyExceptHtml({path: '/templates/home.html'}));
    assert.isFalse(isStaticAsset.anyExceptHtml({path: '/'}));
    assert.isFalse(isStaticAsset.anyExceptHtml({path: '/blog'}));
  });

  it('html', function() {
    assert.isTrue(isStaticAsset.html({path: '/templates/home.html'}));
    assert.isFalse(isStaticAsset.html({path: '/js/main.js'}));
  });

  it('htmlXhr', function() {
    assert.isFalse(isStaticAsset.htmlXhr({path: '/templates/home.html'}));
    assert.isTrue(isStaticAsset.htmlXhr({path: '/templates/home.html', xhr: true}));
  });

  it('htmlNotXhr', function() {
    assert.isTrue(isStaticAsset.htmlNotXhr({path: '/templates/home.html'}));
    assert.isFalse(isStaticAsset.htmlNotXhr({path: '/templates/home.html', xhr: true}));
  });
});
